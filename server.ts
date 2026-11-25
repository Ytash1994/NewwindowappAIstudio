import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  IdempotencyGuard,
  SlidingWindowRateLimiter,
  validateWebhookUrlSafe,
  verifyFirebaseIdToken,
} from "./src/server/security.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const firebaseConfigPath = path.resolve(__dirname, "firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf8")) as {
  projectId: string;
};

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";

const expiryRateLimiter = new SlidingWindowRateLimiter(6, 10 * 60 * 1000);
const alertIdempotency = new IdempotencyGuard(12 * 60 * 60 * 1000);

function sanitizeText(val: unknown, maxLen: number): string {
  return String(val ?? "")
    .replace(/[\u0000-\u001F]/g, "")
    .trim()
    .slice(0, maxLen);
}

function isSimpleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
}

async function startServer() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  // توقيت الخادم الموثوق لحساب مدة التجربة والاشتراك بعيداً عن تلاعب ساعة الجهاز
  app.get("/api/server-time", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const nowMs = Date.now();
    res.json({ nowMs, iso: new Date(nowMs).toISOString() });
  });

  // حالة تهيئة Webhook التنبيهات (للمدير الموثّق فقط — لا يكشف الرابط أو السر إطلاقاً)
  app.get("/api/notifications/status", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const authHeader = req.headers.authorization || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      const verified = await verifyFirebaseIdToken(token, firebaseConfig.projectId);
      if (!verified.emailVerified || !verified.isOwnerAdmin) {
        res.status(403).json({ ok: false, error: "هذه العملية متاحة لمدير المنصة الموثّق فقط." });
        return;
      }
      const rawUrl = (process.env.EXPIRY_WEBHOOK_URL || "").trim();
      const urlCheck = rawUrl ? validateWebhookUrlSafe(rawUrl) : { ok: false as const, reason: "" };
      res.json({
        ok: true,
        webhookConfigured: Boolean(rawUrl && urlCheck.ok),
        secretConfigured: Boolean((process.env.EXPIRY_WEBHOOK_SECRET || "").trim()),
      });
    } catch (err) {
      res.status(401).json({
        ok: false,
        error: err instanceof Error ? err.message : "فشل التحقق من الهوية.",
      });
    }
  });

  // مسار محمي ومصادق لإرسال تنبيهات قرب الانتهاء مع التحقق الفعلي من الاستجابة
  app.post("/api/notifications/expiry", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    let verified: Awaited<ReturnType<typeof verifyFirebaseIdToken>>;
    try {
      const authHeader = req.headers.authorization || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      verified = await verifyFirebaseIdToken(token, firebaseConfig.projectId);
    } catch (err) {
      res.status(401).json({
        ok: false,
        delivered: false,
        status: "failed",
        error: err instanceof Error ? err.message : "فشل التحقق من الهوية.",
      });
      return;
    }

    try {
      if (!verified.emailVerified) {
        res.status(403).json({
          ok: false,
          delivered: false,
          status: "failed",
          error: "يجب توثيق البريد الإلكتروني قبل تنفيذ هذه العملية.",
        });
        return;
      }

      const rate = expiryRateLimiter.check(verified.uid);
      if (!rate.allowed) {
        res.status(429).json({
          ok: false,
          status: "failed",
          error: `تم تجاوز الحد المسموح لطلبات التنبيه، حاول مجدداً بعد ${rate.retryAfterSec} ثانية.`,
        });
        return;
      }

      const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
        string,
        unknown
      >;
      const alertId = sanitizeText(body.alertId, 128).replace(/[^a-zA-Z0-9_\-]/g, "");
      const tenantId = sanitizeText(body.tenantId, 128).replace(/[^a-zA-Z0-9_\-]/g, "");
      const userEmail = sanitizeText(body.userEmail, 200).toLowerCase();
      const adminEmail = sanitizeText(body.adminEmail || "xtashtoush@gmail.com", 200).toLowerCase();
      const workshopName = sanitizeText(body.workshopName || "ورشتي", 120);
      const phone = sanitizeText(body.phone || "", 30);
      const alertType =
        body.alertType === "subscription_expiring" ? "subscription_expiring" : "trial_expiring";
      const hoursLeft = Math.max(0, Math.min(48, Math.round(Number(body.hoursLeft) || 0)));
      const remainingLabel = sanitizeText(body.remainingLabel || "", 80);
      const expiresAtIso = sanitizeText(body.expiresAtIso || "", 40);
      const subject = sanitizeText(body.subject || "", 200);
      const userBody = sanitizeText(body.userBody || "", 2000);
      const adminBody = sanitizeText(body.adminBody || "", 2000);
      const forceResend = Boolean(body.forceResend) && verified.isOwnerAdmin;

      if (!alertId || !tenantId || !isSimpleEmail(userEmail) || !isSimpleEmail(adminEmail)) {
        res.status(400).json({
          ok: false,
          status: "failed",
          error: "بيانات التنبيه غير مكتملة أو غير صالحة.",
        });
        return;
      }

      // التحقق من التفويض: إما المدير الموثّق أو صاحب الحساب نفسه فقط
      if (!verified.isOwnerAdmin && (verified.uid !== tenantId || verified.email !== userEmail)) {
        res.status(403).json({
          ok: false,
          status: "failed",
          error: "غير مصرح لك بإرسال تنبيهات لحساب آخر.",
        });
        return;
      }

      // منع التكرار (Idempotency)
      if (!forceResend && alertIdempotency.has(alertId)) {
        res.json({
          ok: true,
          delivered: true,
          duplicate: true,
          status: "sent",
        });
        return;
      }

      const rawWebhookUrl = (process.env.EXPIRY_WEBHOOK_URL || "").trim();
      if (!rawWebhookUrl) {
        res.json({
          ok: false,
          delivered: false,
          status: "unconfigured",
          error: "لم يتم ضبط EXPIRY_WEBHOOK_URL في متغيرات بيئة الخادم بعد.",
        });
        return;
      }

      const urlCheck = validateWebhookUrlSafe(rawWebhookUrl);
      if (!urlCheck.ok) {
        res.status(400).json({
          ok: false,
          delivered: false,
          status: "failed",
          error: urlCheck.reason,
        });
        return;
      }

      const webhookSecret = (process.env.EXPIRY_WEBHOOK_SECRET || "").trim();
      const outboundPayload: Record<string, unknown> = {
        alertId,
        tenantId,
        adminEmail,
        userEmail,
        workshopName,
        phone,
        alertType,
        hoursLeft,
        remainingLabel,
        expiresAtIso,
        subject,
        userBody,
        adminBody,
      };
      if (webhookSecret) {
        outboundPayload.webhookSecret = webhookSecret;
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json; charset=utf-8",
      };
      if (webhookSecret) {
        headers["X-Webhook-Secret"] = webhookSecret;
      }

      const upstream = await fetch(urlCheck.url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(outboundPayload),
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
      });

      const respText = await upstream.text().catch(() => "");
      let parsedOk = upstream.ok;
      if (upstream.ok && respText) {
        try {
          const parsedJson = JSON.parse(respText) as { ok?: boolean };
          if (parsedJson && parsedJson.ok === false) {
            parsedOk = false;
          }
        } catch {
          // بعض خدمات Webhook تعيد نصاً عادياً عند النجاح 2xx
        }
      }

      if (!parsedOk) {
        res.status(502).json({
          ok: false,
          delivered: false,
          status: "failed",
          httpStatus: upstream.status,
          error: "فشل تسليم البريد عبر خدمة الإشعارات الخارجية.",
        });
        return;
      }

      alertIdempotency.mark(alertId);
      res.json({
        ok: true,
        delivered: true,
        status: "sent",
        httpStatus: upstream.status,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "تعذر تنفيذ طلب التنبيه.";
      const code = msg.includes("صلاحية") || msg.includes("الرمز") || msg.includes("التوقيع") ? 401 : 500;
      res.status(code).json({
        ok: false,
        delivered: false,
        status: "failed",
        error: msg,
      });
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`خادم حاسبة الشبابيك يعمل على المنفذ ${PORT}`);
  });
}

void startServer();
