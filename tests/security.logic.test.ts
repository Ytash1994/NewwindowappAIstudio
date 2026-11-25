/**
 * اختبارات آلية لمنطق الأمان، دورة الاشتراك والتجربة، عزل localStorage لكل مستخدم،
 * وحماية مسار تنبيهات الخادم (SSRF، Rate Limiting، Idempotency) وفحص بنية firestore.rules.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Timestamp } from "firebase/firestore";
import { createDefaultState, KEY, PKEY } from "../src/engine/calc";
import {
  cleanupLegacyGlobalKeys,
  getScopedKey,
  loadScopedProjects,
  readScopedRawState,
  saveScopedAppState,
  saveScopedProjects,
} from "../src/saas/storage";
import type { StorageLike } from "../src/saas/storage";
import { evaluateTenantAccess } from "../src/saas/types";
import type { TenantAccount } from "../src/saas/types";
import {
  IdempotencyGuard,
  SlidingWindowRateLimiter,
  validateWebhookUrlSafe,
} from "../src/server/security";

let passed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

function makeMemoryStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
}

function makeTenant(overrides: Partial<TenantAccount>): TenantAccount {
  return {
    ownerUid: "u1",
    email: "user@workshop.jo",
    displayName: "ورشة 1",
    workshopName: "ورشة 1",
    phone: "0790000001",
    role: "owner",
    subscriptionStatus: "trialing",
    planId: "trial",
    trialDays: 7,
    activeUntil: null,
    adminNote: "",
    projectCount: 0,
    createdAt: Timestamp.fromMillis(1_700_000_000_000),
    updatedAt: Timestamp.fromMillis(1_700_000_000_000),
    ...overrides,
  };
}

const DAY_MS = 86_400_000;

runTest("التجربة المجانية 7 أيام فعالة خلال المدة وتُقفل فوراً بعد انتهائها", () => {
  const start = 1_700_000_000_000;
  const tenant = makeTenant({ createdAt: Timestamp.fromMillis(start), trialDays: 7 });

  const day1 = evaluateTenantAccess(tenant, start + 1 * DAY_MS);
  assert.equal(day1.allowed, true);
  assert.equal(day1.state, "trialing");
  assert.equal(day1.daysLeft, 6);
  assert.equal(day1.isExpiringSoon, false);

  const day6 = evaluateTenantAccess(tenant, start + 6 * DAY_MS);
  assert.equal(day6.allowed, true);
  assert.equal(day6.isExpiringSoon, true);

  const day8 = evaluateTenantAccess(tenant, start + 7 * DAY_MS + 1000);
  assert.equal(day8.allowed, false);
  assert.equal(day8.state, "expired");
});

runTest("حالة pending_payment تبقى مقفلة عند انتهاء التجربة حتى تأكيد المدير", () => {
  const start = 1_700_000_000_000;
  const tenant = makeTenant({
    createdAt: Timestamp.fromMillis(start),
    trialDays: 7,
    subscriptionStatus: "pending_payment",
  });

  // أثناء سريان التجربة: مسموح مع وسم وجود طلب قيد المراجعة
  const stillTrial = evaluateTenantAccess(tenant, start + 3 * DAY_MS);
  assert.equal(stillTrial.allowed, true);
  assert.equal(stillTrial.state, "trialing");
  assert.equal(stillTrial.hasPendingPayment, true);

  // بعد انتهاء الـ 7 أيام: يُقفل الحساب رغم وجود طلب دفع قيد المراجعة
  const expiredPending = evaluateTenantAccess(tenant, start + 8 * DAY_MS);
  assert.equal(expiredPending.allowed, false);
  assert.equal(expiredPending.state, "pending_payment");
  assert.equal(expiredPending.hasPendingPayment, true);
});

runTest("عدم منح صلاحية المدير لبريد Xtashtoush@gmail.com إذا كان البريد غير موثّق", () => {
  const start = 1_700_000_000_000;
  const unverifiedSpoof = makeTenant({
    email: "Xtashtoush@gmail.com",
    role: "admin",
    subscriptionStatus: "expired",
    createdAt: Timestamp.fromMillis(start),
  });

  const denied = evaluateTenantAccess(unverifiedSpoof, start + 10 * DAY_MS, {
    emailVerified: false,
  });
  assert.equal(denied.allowed, false);

  const allowed = evaluateTenantAccess(unverifiedSpoof, start + 10 * DAY_MS, {
    emailVerified: true,
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.state, "owner_free");
});

runTest("الإيقاف الإداري (suspended) يقفل الحساب فوراً حتى لو كان لديه مدة متبقية", () => {
  const now = 1_700_000_000_000;
  const suspended = makeTenant({
    subscriptionStatus: "suspended",
    activeUntil: Timestamp.fromMillis(now + 30 * DAY_MS),
  });
  const ev = evaluateTenantAccess(suspended, now);
  assert.equal(ev.allowed, false);
  assert.equal(ev.state, "suspended");
});

runTest("عزل localStorage حسب uid ومنع تسرب البيانات بين مستخدمين مختلفين", () => {
  const mem = makeMemoryStorage();

  // ترحيل بيانات قديمة لمستخدم A وحذف المفاتيح العالمية
  mem.setItem(KEY, JSON.stringify({ type: "شباك 2.5 نظامي", unit: "m" }));
  mem.setItem(PKEY, JSON.stringify([{ id: "old1", name: "مشروع قديم", updatedAt: "2026-01-01", data: {} }]));

  const rawA = readScopedRawState("uid_A", mem);
  assert.equal(rawA.type, "شباك 2.5 نظامي");
  assert.equal(mem.getItem(KEY), null, "يجب حذف المفتاح العالمي القديم بعد الترحيل");

  const stA = createDefaultState();
  stA.type = "شباك 3 مجاري بدون صندوق";
  saveScopedAppState("uid_A", stA, mem);
  saveScopedProjects("uid_A", [{ id: "pA", name: "ورشة أ", updatedAt: "2026-02-01", data: stA }], mem);

  // تسجيل دخول مستخدم B على نفس الجهاز يجب ألا يرى شيئاً من بيانات A
  const rawB = readScopedRawState("uid_B", mem);
  const projsB = loadScopedProjects("uid_B", mem);
  assert.equal(rawB.type, undefined);
  assert.equal(projsB.length, 0);

  // التحقق من بقاء بيانات A معزولة وسليمة
  assert.equal(loadScopedProjects("uid_A", mem).length, 1);
  assert.ok(mem.getItem(getScopedKey(KEY, "uid_A")));

  cleanupLegacyGlobalKeys(mem);
  assert.equal(mem.getItem(KEY), null);
});

runTest("حماية SSRF على رابط Webhook ومنع HTTP والعناوين الداخلية والخاصة", () => {
  assert.equal(validateWebhookUrlSafe("http://example.com/hook").ok, false);
  assert.equal(validateWebhookUrlSafe("https://localhost:3000/hook").ok, false);
  assert.equal(validateWebhookUrlSafe("https://127.0.0.1/hook").ok, false);
  assert.equal(validateWebhookUrlSafe("https://169.254.169.254/latest/meta-data").ok, false);
  assert.equal(validateWebhookUrlSafe("https://192.168.1.5/hook").ok, false);
  assert.equal(validateWebhookUrlSafe("https://10.0.0.1/hook").ok, false);
  assert.equal(validateWebhookUrlSafe("https://metadata.google.internal/x").ok, false);
  assert.equal(validateWebhookUrlSafe("https://user:pass@script.google.com/macros/s/123/exec").ok, false);

  const okRes = validateWebhookUrlSafe("https://script.google.com/macros/s/AKfycbx123/exec");
  assert.equal(okRes.ok, true);
});

runTest("تقييد معدل الطلبات (Rate Limiting) ومنع التكرار (Idempotency) يعملان بدقة", () => {
  const rl = new SlidingWindowRateLimiter(2, 60_000);
  const t0 = 1_700_000_000_000;
  assert.equal(rl.check("u1", t0).allowed, true);
  assert.equal(rl.check("u1", t0 + 1000).allowed, true);
  assert.equal(rl.check("u1", t0 + 2000).allowed, false);
  assert.equal(rl.check("u1", t0 + 61_000).allowed, true);

  const idem = new IdempotencyGuard(60_000);
  assert.equal(idem.has("exp_u1_1", t0), false);
  idem.mark("exp_u1_1", t0);
  assert.equal(idem.has("exp_u1_1", t0 + 5000), true);
  assert.equal(idem.has("exp_u1_1", t0 + 61_000), false);
});

runTest("التحقق الثابت من بنية firestore.rules وغياب no-cors من الكود", () => {
  const rulesText = fs.readFileSync(path.resolve("firestore.rules"), "utf8");
  assert.ok(rulesText.includes("request.auth.token.email_verified == true"));
  assert.ok(rulesText.includes("request.auth.token.email.lower() == 'xtashtoush@gmail.com'"));
  assert.ok(rulesText.includes("match /config_private/{configId}"));
  assert.ok(rulesText.includes("existing().status == 'pending'"));
  assert.ok(rulesText.includes("planAllowsNewProject"));
  assert.ok(rulesText.includes("allow update: if false;\n      allow delete: if false;"));
  assert.equal(rulesText.includes("expiryWebhookUrl"), true); // فقط لتنظيف الحقل القديم الممنوع في incoming

  const serviceText = fs.readFileSync(path.resolve("src/saas/service.ts"), "utf8");
  assert.equal(serviceText.includes("no-cors"), false, "يجب إزالة mode: no-cors نهائياً");
  assert.ok(serviceText.includes("runTransaction"), "يجب استخدام المعاملات الذرية");
});

console.log(`\nاكتملت جميع اختبارات الأمان والاشتراكات بنجاح (${passed}/${passed}).`);
