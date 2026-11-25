/**
 * اختبارات آلية شاملة لمنطق الأمان، دورة الاشتراك والتجربة، عزل localStorage لكل مستخدم،
 * فرض حدود الباقات على لقطات المشاريع، والتحقق من بنية الإطلاق المجاني بالكامل (Firebase Spark Plan).
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
import { assertSnapshotWithinPlanLimits } from "../src/saas/service";
import { DEFAULT_PLANS, evaluateTenantAccess, resolvePlanLimits } from "../src/saas/types";
import type { TenantAccount } from "../src/saas/types";
import type { AppState } from "../src/types";

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
    extraCustomTypesQuota: 0,
    createdAt: Timestamp.fromMillis(1_700_000_000_000),
    updatedAt: Timestamp.fromMillis(1_700_000_000_000),
    ...overrides,
  };
}

function makeSnapshot(overrides?: Partial<Omit<AppState, "raw">>): Omit<AppState, "raw"> {
  const { raw: _ignored, ...base } = createDefaultState();
  void _ignored;
  return {
    ...base,
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

  const stillTrial = evaluateTenantAccess(tenant, start + 3 * DAY_MS);
  assert.equal(stillTrial.allowed, true);
  assert.equal(stillTrial.state, "trialing");
  assert.equal(stillTrial.hasPendingPayment, true);

  const expiredPending = evaluateTenantAccess(tenant, start + 8 * DAY_MS);
  assert.equal(expiredPending.allowed, false);
  assert.equal(expiredPending.state, "pending_payment");
  assert.equal(expiredPending.hasPendingPayment, true);
});

runTest("حصر صلاحية المدير بالمالك الأساسي الموثّق فقط ورفض انتحال الدور أو البريد غير الموثّق", () => {
  const start = 1_700_000_000_000;
  const unverifiedOwner = makeTenant({
    email: "Xtashtoush@gmail.com",
    role: "admin",
    subscriptionStatus: "expired",
    createdAt: Timestamp.fromMillis(start),
  });

  assert.equal(
    evaluateTenantAccess(unverifiedOwner, start + 10 * DAY_MS, { emailVerified: false }).allowed,
    false
  );

  const verifiedOwner = evaluateTenantAccess(unverifiedOwner, start + 10 * DAY_MS, {
    emailVerified: true,
  });
  assert.equal(verifiedOwner.allowed, true);
  assert.equal(verifiedOwner.state, "owner_free");

  // مستخدم عادي يحاول انتحال role: "admin" لا يُمنح صلاحية مدير
  const fakeAdmin = makeTenant({
    email: "attacker@workshop.jo",
    role: "admin",
    subscriptionStatus: "expired",
    createdAt: Timestamp.fromMillis(start),
  });
  assert.equal(
    evaluateTenantAccess(fakeAdmin, start + 10 * DAY_MS, { emailVerified: true }).allowed,
    false
  );
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

  mem.setItem(KEY, JSON.stringify({ type: "شباك 2.5 نظامي", unit: "m" }));
  mem.setItem(PKEY, JSON.stringify([{ id: "old1", name: "مشروع قديم", updatedAt: "2026-01-01", data: {} }]));

  const rawA = readScopedRawState("uid_A", mem);
  assert.equal(rawA.type, "شباك 2.5 نظامي");
  assert.equal(mem.getItem(KEY), null, "يجب حذف المفتاح العالمي القديم بعد الترحيل");

  const stA = createDefaultState();
  stA.type = "شباك 3 مجاري بدون صندوق";
  saveScopedAppState("uid_A", stA, mem);
  saveScopedProjects("uid_A", [{ id: "pA", name: "ورشة أ", updatedAt: "2026-02-01", data: stA }], mem);

  const rawB = readScopedRawState("uid_B", mem);
  const projsB = loadScopedProjects("uid_B", mem);
  assert.equal(rawB.type, undefined);
  assert.equal(projsB.length, 0);

  assert.equal(loadScopedProjects("uid_A", mem).length, 1);
  assert.ok(mem.getItem(getScopedKey(KEY, "uid_A")));

  cleanupLegacyGlobalKeys(mem);
  assert.equal(mem.getItem(KEY), null);
});

runTest("حدود الباقات الثلاث والتجربة المجانية وحزمة الأنواع الإضافية لآخر باقة فقط", () => {
  const starterPlan = DEFAULT_PLANS.find((p) => p.id === "starter")!;
  const proPlan = DEFAULT_PLANS.find((p) => p.id === "pro")!;
  const businessPlan = DEFAULT_PLANS.find((p) => p.id === "business")!;

  const trialLim = resolvePlanLimits(
    makeTenant({ planId: "trial", subscriptionStatus: "trialing" }),
    null,
    false
  );
  assert.equal(trialLim.maxCustomTypes, 0);
  assert.equal(trialLim.maxCustomFieldsPerType, 2);
  assert.equal(trialLim.allowReorder, true);
  assert.equal(trialLim.canRequestExtraTypesAddon, false);

  const starterLim = resolvePlanLimits(
    makeTenant({ planId: "starter", subscriptionStatus: "active" }),
    starterPlan,
    false
  );
  assert.equal(starterLim.maxCustomTypes, 0);
  assert.equal(starterLim.maxCustomFieldsPerType, 2);
  assert.equal(starterLim.allowReorder, true);
  assert.equal(starterLim.canRequestExtraTypesAddon, false);

  const proLim = resolvePlanLimits(
    makeTenant({ planId: "pro", subscriptionStatus: "active", extraCustomTypesQuota: 5 }),
    proPlan,
    false
  );
  assert.equal(proLim.maxCustomTypes, 2, "الحزمة الإضافية لا تنطبق على الباقة الثانية");
  assert.equal(proLim.maxCustomFieldsPerType, 5);
  assert.equal(proLim.allowReorder, true);
  assert.equal(proLim.canRequestExtraTypesAddon, false);

  const bizLim = resolvePlanLimits(
    makeTenant({ planId: "business", subscriptionStatus: "active", extraCustomTypesQuota: 0 }),
    businessPlan,
    false
  );
  assert.equal(bizLim.maxCustomTypes, 5);
  assert.equal(bizLim.maxCustomFieldsPerType, -1);
  assert.equal(bizLim.allowReorder, true);
  assert.equal(bizLim.canRequestExtraTypesAddon, true);
  assert.equal(bizLim.extraTypesPackSize, 5);
  assert.equal(bizLim.extraTypesPackPriceJod, 10);

  const bizWithAddon = resolvePlanLimits(
    makeTenant({ planId: "business", subscriptionStatus: "active", extraCustomTypesQuota: 5 }),
    businessPlan,
    false
  );
  assert.equal(bizWithAddon.maxCustomTypes, 10);
});

runTest("فرض حدود الأنواع والعلاقات فعلياً عند حفظ لقطة المشروع عبر assertSnapshotWithinPlanLimits", () => {
  const starterPlan = DEFAULT_PLANS.find((p) => p.id === "starter")!;
  const proPlan = DEFAULT_PLANS.find((p) => p.id === "pro")!;
  const businessPlan = DEFAULT_PLANS.find((p) => p.id === "business")!;

  const mkType = (n: number) => ({ name: `نوع_${n}` });
  const mkField = (n: number) => ({
    id: `c_${n}`,
    name: `علاقة_${n}`,
    group: "frame",
  });

  // الباقة الأساسية: تسمح بعلاقتين فقط وتمنع أي نوع مخصص
  const starterTenant = makeTenant({ planId: "starter", subscriptionStatus: "active" });
  assert.doesNotThrow(() =>
    assertSnapshotWithinPlanLimits(
      starterTenant,
      starterPlan,
      makeSnapshot({
        utypes: [],
        custom: { "شباك 3 مجاري نظامي": [mkField(1), mkField(2)] },
      })
    )
  );
  assert.throws(() =>
    assertSnapshotWithinPlanLimits(
      starterTenant,
      starterPlan,
      makeSnapshot({ utypes: [mkType(1)] })
    )
  );
  assert.throws(() =>
    assertSnapshotWithinPlanLimits(
      starterTenant,
      starterPlan,
      makeSnapshot({
        utypes: [],
        custom: { "شباك 3 مجاري نظامي": [mkField(1), mkField(2), mkField(3)] },
      })
    )
  );

  // الباقة الاحترافية: تسمح بنوعين و 5 علاقات لكل نوع وتمنع الثالث والسادسة
  const proTenant = makeTenant({ planId: "pro", subscriptionStatus: "active" });
  assert.doesNotThrow(() =>
    assertSnapshotWithinPlanLimits(
      proTenant,
      proPlan,
      makeSnapshot({
        utypes: [mkType(1), mkType(2)],
        custom: {
          "شباك 3 مجاري نظامي": [mkField(1), mkField(2), mkField(3), mkField(4), mkField(5)],
        },
      })
    )
  );
  assert.throws(() =>
    assertSnapshotWithinPlanLimits(
      proTenant,
      proPlan,
      makeSnapshot({ utypes: [mkType(1), mkType(2), mkType(3)] })
    )
  );
  assert.throws(() =>
    assertSnapshotWithinPlanLimits(
      proTenant,
      proPlan,
      makeSnapshot({
        utypes: [],
        custom: {
          "شباك 3 مجاري نظامي": [mkField(1), mkField(2), mkField(3), mkField(4), mkField(5), mkField(6)],
        },
      })
    )
  );

  // باقة الورش والمصانع: 5 أنواع + علاقات مفتوحة، ومع حزمة +5 تصبح 10 أنواع
  const bizTenant = makeTenant({
    planId: "business",
    subscriptionStatus: "active",
    extraCustomTypesQuota: 0,
  });
  assert.doesNotThrow(() =>
    assertSnapshotWithinPlanLimits(
      bizTenant,
      businessPlan,
      makeSnapshot({
        utypes: [mkType(1), mkType(2), mkType(3), mkType(4), mkType(5)],
        custom: {
          "شباك 3 مجاري نظامي": Array.from({ length: 12 }, (_, i) => mkField(i + 1)),
        },
      })
    )
  );
  assert.throws(() =>
    assertSnapshotWithinPlanLimits(
      bizTenant,
      businessPlan,
      makeSnapshot({ utypes: [mkType(1), mkType(2), mkType(3), mkType(4), mkType(5), mkType(6)] })
    )
  );

  const bizPlus = makeTenant({
    planId: "business",
    subscriptionStatus: "active",
    extraCustomTypesQuota: 5,
  });
  assert.doesNotThrow(() =>
    assertSnapshotWithinPlanLimits(
      bizPlus,
      businessPlan,
      makeSnapshot({
        utypes: Array.from({ length: 10 }, (_, i) => mkType(i + 1)),
      })
    )
  );
});

runTest("التحقق من الالتزام التام بخطة Firebase Spark المجانية (بدون خادم Express أو Blaze أو onSnapshot)", () => {
  // 1. غياب ملفات الخادم Express نهائياً
  assert.equal(fs.existsSync(path.resolve("server.ts")), false, "يجب حذف server.ts");
  assert.equal(
    fs.existsSync(path.resolve("src/server/security.ts")),
    false,
    "يجب حذف src/server/security.ts"
  );

  // 2. وجود إعدادات Firebase Hosting العادي (SPA rewrites -> /index.html)
  const fbJson = JSON.parse(fs.readFileSync(path.resolve("firebase.json"), "utf8"));
  assert.equal(fbJson.hosting.public, "dist");
  assert.equal(fbJson.firestore.rules, "firestore.rules");
  assert.ok(
    Array.isArray(fbJson.hosting.rewrites) &&
      fbJson.hosting.rewrites.some((r: { source: string; destination: string }) => r.source === "**" && r.destination === "/index.html"),
    "يجب توجيه جميع المسارات إلى /index.html"
  );

  // 3. نظافة package.json من خدمات الخادم أو Blaze
  const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const forbidden of [
    "express",
    "@types/express",
    "dotenv",
    "@google/genai",
    "firebase-functions",
    "firebase-admin",
  ]) {
    assert.equal(forbidden in allDeps, false, `الاعتماد ${forbidden} يجب ألا يوجد في خطة Spark`);
  }
  assert.ok(String(pkg.scripts.dev).startsWith("vite"), "يجب تشغيل dev عبر Vite SPA فقط");

  // 4. فحص src/saas/service.ts: صفر onSnapshot، صفر /api/، صفر no-cors، ووجود runTransaction
  const serviceText = fs.readFileSync(path.resolve("src/saas/service.ts"), "utf8");
  assert.equal(serviceText.includes("onSnapshot"), false, "يجب الاستغناء عن onSnapshot لتوفير حصة Spark");
  assert.equal(serviceText.includes("/api/"), false, "لا يجوز الاعتماد على مسارات /api/ خادمية");
  assert.equal(serviceText.includes("no-cors"), false, "يجب إزالة mode: no-cors نهائياً");
  assert.ok(serviceText.includes("runTransaction"), "يجب استخدام المعاملات الذرية");

  // 5. فحص firestore.rules: حصر الإدارة بالمالك الأساسي وفرض حدود الباقات والعلاقات على الخادم
  const rulesText = fs.readFileSync(path.resolve("firestore.rules"), "utf8");
  assert.ok(rulesText.includes("request.auth.token.email_verified == true"));
  assert.ok(rulesText.includes("request.auth.token.email.lower() == 'xtashtoush@gmail.com'"));
  assert.ok(rulesText.includes("function isAdmin() {\n      return isOwnerAdmin();\n    }"));
  assert.ok(rulesText.includes("planAllowsNewProject"));
  assert.ok(rulesText.includes("planAllowsCustomTypes"));
  assert.ok(rulesText.includes("planAllowsCustomFields"));
  assert.ok(rulesText.includes("planAllowsExtraTypesAddon"));
  assert.ok(rulesText.includes("existing().status == 'pending'"));
  assert.ok(rulesText.includes("match /admins/{adminUid} {\n      allow read, write: if false;\n    }"));
  assert.ok(rulesText.includes("match /expiry_alerts/{alertId} {\n      allow read, write: if false;\n    }"));
  assert.ok(rulesText.includes("match /config_private/{configId} {\n      allow read, write: if false;\n    }"));
  assert.ok(rulesText.includes("allow update: if false;\n      allow delete: if false;"));
});

console.log(`\nاكتملت جميع اختبارات الأمان والاشتراكات وخطة Spark بنجاح (${passed}/${passed}).`);
