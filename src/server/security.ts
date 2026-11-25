import crypto from "node:crypto";

export interface VerifiedFirebaseToken {
  uid: string;
  email: string;
  emailVerified: boolean;
  isOwnerAdmin: boolean;
}

const GOOGLE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const OWNER_ADMIN_EMAIL = "xtashtoush@gmail.com";

let cachedCerts: Record<string, string> = {};
let certsExpiresAtMs = 0;

function base64UrlDecode(segment: string): Buffer {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const mod = padded.length % 4;
  const fixed = mod === 0 ? padded : padded + "=".repeat(4 - mod);
  return Buffer.from(fixed, "base64");
}

async function fetchGooglePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (Object.keys(cachedCerts).length > 0 && now < certsExpiresAtMs) {
    return cachedCerts;
  }
  const resp = await fetch(GOOGLE_CERTS_URL, {
    method: "GET",
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    throw new Error(`فشل جلب شهادات التحقق من Google (${resp.status})`);
  }
  const cc = resp.headers.get("cache-control") || "";
  const maxAgeMatch = cc.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) : 3600;
  cachedCerts = (await resp.json()) as Record<string, string>;
  certsExpiresAtMs = now + maxAgeSec * 1000;
  return cachedCerts;
}

/**
 * التحقق التشفيري الكامل من رمز Firebase ID Token (RS256) بدون الحاجة لصلاحيات IAM
 */
export async function verifyFirebaseIdToken(
  idToken: string,
  expectedProjectId: string
): Promise<VerifiedFirebaseToken> {
  if (!idToken || typeof idToken !== "string") {
    throw new Error("رمز التحقق مفقود.");
  }
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("صيغة رمز التحقق غير صالحة.");
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(base64UrlDecode(headerB64).toString("utf8")) as {
    alg?: string;
    kid?: string;
  };
  const payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8")) as {
    iss?: string;
    aud?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
    email_verified?: boolean;
  };

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("خوارزمية توقيع الرمز غير معتمدة.");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== expectedProjectId) {
    throw new Error("الرمز لا يخص هذا المشروع.");
  }
  if (payload.iss !== `https://securetoken.google.com/${expectedProjectId}`) {
    throw new Error("مصدر الرمز غير موثوق.");
  }
  if (!payload.sub || typeof payload.sub !== "string" || payload.sub.length > 128) {
    throw new Error("معرّف المستخدم في الرمز غير صالح.");
  }
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) {
    throw new Error("انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول.");
  }
  if (typeof payload.iat !== "number" || payload.iat > nowSec + 300) {
    throw new Error("توقيت إصدار الرمز غير صالح.");
  }

  const certs = await fetchGooglePublicCerts();
  const certPem = certs[header.kid];
  if (!certPem) {
    throw new Error("شهادة التحقق الخاصة بالرمز غير معروفة.");
  }

  const verified = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${headerB64}.${payloadB64}`),
    crypto.createPublicKey(certPem),
    base64UrlDecode(sigB64)
  );
  if (!verified) {
    throw new Error("توقيع رمز التحقق غير صحيح.");
  }

  const email = String(payload.email || "").trim().toLowerCase();
  const emailVerified = payload.email_verified === true;

  return {
    uid: payload.sub,
    email,
    emailVerified,
    isOwnerAdmin: emailVerified && email === OWNER_ADMIN_EMAIL,
  };
}

/**
 * التحقق من أمان رابط Webhook ومنع هجمات SSRF (يرفض HTTP غير المشفر والعناوين الداخلية والخاصة)
 */
export function validateWebhookUrlSafe(rawUrl: string): { ok: true; url: URL } | { ok: false; reason: string } {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) {
    return { ok: false, reason: "رابط Webhook غير مضبوط." };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "صيغة رابط Webhook غير صالحة." };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "يجب أن يستخدم رابط Webhook بروتوكول HTTPS فقط." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "يُمنع تضمين بيانات اعتماد داخل الرابط." };
  }

  const host = parsed.hostname.toLowerCase();
  const blockedHosts = new Set([
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "[::1]",
    "metadata.google.internal",
    "169.254.169.254",
  ]);
  if (
    blockedHosts.has(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    return { ok: false, reason: "يُمنع توجيه Webhook إلى عناوين داخلية أو محلية." };
  }

  // رفض نطاقات IPv4 الخاصة و Link-Local
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return { ok: false, reason: "يُمنع توجيه Webhook إلى عناوين شبكة خاصة." };
    }
  }

  // رفض IPv6 محلي أو خاص
  if (host.includes(":")) {
    const cleanHost = host.replace(/^\[|\]$/g, "");
    if (
      cleanHost === "::1" ||
      cleanHost.startsWith("fc") ||
      cleanHost.startsWith("fd") ||
      cleanHost.startsWith("fe80")
    ) {
      return { ok: false, reason: "يُمنع توجيه Webhook إلى عناوين IPv6 داخلية." };
    }
  }

  return { ok: true, url: parsed };
}

/** تقييد معدل الطلبات لكل مستخدم بنافذة زمنية منزلقة */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  check(key: string, nowMs = Date.now()): { allowed: boolean; retryAfterSec: number } {
    const cutoff = nowMs - this.windowMs;
    const prev = (this.hits.get(key) || []).filter((ts) => ts > cutoff);
    if (prev.length >= this.maxRequests) {
      const oldest = prev[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldest + this.windowMs - nowMs) / 1000));
      this.hits.set(key, prev);
      return { allowed: false, retryAfterSec };
    }
    prev.push(nowMs);
    this.hits.set(key, prev);
    return { allowed: true, retryAfterSec: 0 };
  }
}

/** منع تكرار إرسال نفس التنبيه (Idempotency) خلال نافذة زمنية */
export class IdempotencyGuard {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  has(key: string, nowMs = Date.now()): boolean {
    const exp = this.seen.get(key);
    if (!exp) return false;
    if (exp <= nowMs) {
      this.seen.delete(key);
      return false;
    }
    return true;
  }

  mark(key: string, nowMs = Date.now()): void {
    this.seen.set(key, nowMs + this.ttlMs);
    if (this.seen.size > 5000) {
      for (const [k, exp] of this.seen.entries()) {
        if (exp <= nowMs) this.seen.delete(k);
      }
    }
  }
}
