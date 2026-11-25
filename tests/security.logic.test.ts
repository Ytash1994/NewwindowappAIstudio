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

runTest("رفض البنى غير الصالحة في snapshot (utypes ليست قائمة أو custom ليست خريطة) حتى على أعلى باقة", () => {
  const starterPlan = DEFAULT_PLANS.find((p) => p.id === "starter")!;
  const businessPlan = DEFAULT_PLANS.find((p) => p.id === "business")!;
  const starterTenant = makeTenant({ planId: "starter", subscriptionStatus: "active" });
  const bizTenant = makeTenant({ planId: "business", subscriptionStatus: "active" });

  // utypes غائبة (undefined) تُعامل كقائمة فارغة ومسموحة
  const withoutUtypes = makeSnapshot();
  delete (withoutUtypes as unknown as Record<string, unknown>).utypes;
  assert.doesNotThrow(() => assertSnapshotWithinPlanLimits(starterTenant, starterPlan, withoutUtypes));

  // utypes كـ string
  assert.throws(() =>
    assertSnapshotWithinPlanLimits(
      starterTenant,
      starterPlan,
      makeSnapshot({ utypes: "bypass" as unknown as AppState["utypes"] })
    )
  );

  // utypes كـ map (كائن)
  assert.throws(() =>
    assertSnapshotWithinPlanLimits(
      starterTenant,
      starterPlan,
      makeSnapshot({ utypes: { "0": { name: "نوع" } } as unknown as AppState["utypes"] })
    )
  );

  // utypes كـ null
  assert.throws(() =>
    assertSnapshotWithinPlanLimits(
      starterTenant,
      starterPlan,
      makeSnapshot({ utypes: null as unknown as AppState["utypes"] })
    )
  );

  // عنصر غير صالح داخل قائمة utypes
  assert.throws(() =>
    assertSnapshotWithinPlanLimits(
      bizTenant,
      businessPlan,
      makeSnapshot({ utypes: [{ name: "" }] as unknown as AppState["utypes"] })
    )
  );

  // custom ليست map (string / array / null) حتى على باقة الورش والمصانع (maxFields == -1)
  for (const badCustom of ["not-a-map", ["bad"], null, 123]) {
    assert.throws(() =>
      assertSnapshotWithinPlanLimits(
        bizTenant,
        businessPlan,
        makeSnapshot({ custom: badCustom as unknown as AppState["custom"] })
      )
    );
  }

  // قيمة مفتاح داخل custom ليست قائمة
  assert.throws(() =>
    assertSnapshotWithinPlanLimits(
      bizTenant,
      businessPlan,
      makeSnapshot({
        custom: { "شباك 3 مجاري نظامي": "bad-list" } as unknown as AppState["custom"],
      })
    )
  );
});

runTest("التحقق من الالتزام التام بخطة Firebase Spark المجانية وتثبيت التجربة وذرية سجل الإدارة", () => {
  // 1. غياب ملفات الخادم Express نهائياً
  assert.equal(fs.existsSync(path.resolve("server.ts")), false, "يجب حذف server.ts");
  assert.equal(
    fs.existsSync(path.resolve("src/server/security.ts")),
    false,
    "يجب حذف src/server/security.ts"
  );

  // 2. وجود إعدادات Firebase Hosting العادي + محاكي Firestore
  const fbJson = JSON.parse(fs.readFileSync(path.resolve("firebase.json"), "utf8"));
  assert.equal(fbJson.hosting.public, "dist");
  assert.equal(fbJson.firestore.rules, "firestore.rules");
  assert.equal(fbJson.emulators.firestore.port, 8080);
  assert.ok(
    Array.isArray(fbJson.hosting.rewrites) &&
      fbJson.hosting.rewrites.some((r: { source: string; destination: string }) => r.source === "**" && r.destination === "/index.html"),
    "يجب توجيه جميع المسارات إلى /index.html"
  );

  // 3. نظافة package.json من خدمات الخادم أو Blaze ووجود سكربت اختبارات المحاكي
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
  assert.ok("@firebase/rules-unit-testing" in allDeps, "يجب توفر @firebase/rules-unit-testing");
  assert.ok(String(pkg.scripts.dev).startsWith("vite"), "يجب تشغيل dev عبر Vite SPA فقط");
  assert.ok(String(pkg.scripts["test:rules:emulator"]).includes("emulators:exec"));

  // 4. فحص src/saas/service.ts: صفر onSnapshot، صفر /api/، ذرية adminSavePlan و adminSavePlatformConfig
  const serviceText = fs.readFileSync(path.resolve("src/saas/service.ts"), "utf8");
  assert.equal(serviceText.includes("onSnapshot"), false, "يجب الاستغناء عن onSnapshot لتوفير حصة Spark");
  assert.equal(serviceText.includes("/api/"), false, "لا يجوز الاعتماد على مسارات /api/ خادمية");
  assert.equal(serviceText.includes("no-cors"), false, "يجب إزالة mode: no-cors نهائياً");
  assert.ok(serviceText.includes("runTransaction"), "يجب استخدام المعاملات الذرية");

  const savePlanBlock = serviceText.slice(
    serviceText.indexOf("export async function adminSavePlan"),
    serviceText.indexOf("export async function adminSavePlatformConfig")
  );
  assert.ok(savePlanBlock.includes("runTransaction(db"), "adminSavePlan يجب أن يستخدم معاملة ذرية");
  assert.ok(savePlanBlock.includes('doc(db, "audit_logs", logId)'), "adminSavePlan يجب أن يكتب سجل التدقيق داخل المعاملة");

  const saveCfgBlock = serviceText.slice(
    serviceText.indexOf("export async function adminSavePlatformConfig"),
    serviceText.indexOf("export const PASSWORD_RESET_TTL_MS")
  );
  assert.ok(saveCfgBlock.includes("runTransaction(db"), "adminSavePlatformConfig يجب أن يستخدم معاملة ذرية");
  assert.ok(saveCfgBlock.includes('doc(db, "audit_logs", logId)'), "adminSavePlatformConfig يجب أن يكتب سجل التدقيق داخل المعاملة");
  assert.ok(saveCfgBlock.includes("trialDaysDefault: DEFAULT_TRIAL_DAYS"), "يجب تثبيت مدة التجربة على DEFAULT_TRIAL_DAYS");

  // 5. فحص firestore.rules: رفض utypes غير القائمة و custom غير الخريطة وتثبيت trialDaysDefault == 7
  const rulesText = fs.readFileSync(path.resolve("firestore.rules"), "utf8");
  assert.ok(rulesText.includes("request.auth.token.email_verified == true"));
  assert.ok(rulesText.includes("request.auth.token.email.lower() == 'xtashtoush@gmail.com'"));
  assert.ok(rulesText.includes("function isAdmin() {\n      return isOwnerAdmin();\n    }"));
  assert.ok(rulesText.includes("hasValidUtypesShape"));
  assert.ok(rulesText.includes("hasValidCustomMapShape"));
  assert.equal(
    rulesText.includes("!(projectData.snapshot.utypes is list)"),
    false,
    "ممنوع السماح بتمرير utypes غير القائمة"
  );
  assert.ok(rulesText.includes("data.trialDaysDefault is int && data.trialDaysDefault == 7"));
  assert.ok(rulesText.includes("planAllowsNewProject"));
  assert.ok(rulesText.includes("planAllowsCustomTypes"));
  assert.ok(rulesText.includes("planAllowsCustomFields"));
  assert.ok(rulesText.includes("planAllowsExtraTypesAddon"));
  assert.ok(rulesText.includes("existing().status == 'pending'"));
  assert.ok(rulesText.includes("match /admins/{adminUid} {\n      allow read, write: if false;\n    }"));
  assert.ok(rulesText.includes("match /expiry_alerts/{alertId} {\n      allow read, write: if false;\n    }"));
  assert.ok(rulesText.includes("match /config_private/{configId} {\n      allow read, write: if false;\n    }"));
  assert.ok(rulesText.includes("allow update: if false;\n      allow delete: if false;"));

  // 6. فحص src/firebase.ts: App Check اختياري بالتطوير وجاهز للإنتاج بدون أسرار
  const firebaseTs = fs.readFileSync(path.resolve("src/firebase.ts"), "utf8");
  assert.ok(firebaseTs.includes("ReCaptchaV3Provider"));
  assert.ok(firebaseTs.includes("VITE_RECAPTCHA_V3_SITE_KEY"));
  assert.ok(firebaseTs.includes("import.meta.env?.DEV"));
  assert.equal(firebaseTs.includes("SECRET"), false, "لا يجوز تخزين أي سر في src/firebase.ts");
});

console.log(`\nاكتملت جميع اختبارات الأمان والاشتراكات وخطة Spark بنجاح (${passed}/${passed}).`);
