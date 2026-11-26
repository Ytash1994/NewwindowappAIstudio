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
import {
  DEFAULT_PLANS,
  evaluateTenantAccess,
  getSubscriptionExpiryMs,
  getTrialExpiryMs,
  isAllowedSubscriptionDays,
  isAllowedTrialExtensionDays,
  resolvePlanLimits,
  resolveServerVerifiedStatusCandidates,
} from "../src/saas/types";
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
  assert.equal(trialLim.allowImportExport, false);
  assert.equal(trialLim.canRequestExtraTypesAddon, false);

  const starterLim = resolvePlanLimits(
    makeTenant({ planId: "starter", subscriptionStatus: "active" }),
    starterPlan,
    false
  );
  assert.equal(starterLim.maxCustomTypes, 0);
  assert.equal(starterLim.maxCustomFieldsPerType, 2);
  assert.equal(starterLim.allowReorder, true);
  assert.equal(starterLim.allowImportExport, false, "الباقة الأولى لا تسمح بالاستيراد أو التصدير");
  assert.equal(starterLim.canRequestExtraTypesAddon, false);

  const proLim = resolvePlanLimits(
    makeTenant({ planId: "pro", subscriptionStatus: "active", extraCustomTypesQuota: 5 }),
    proPlan,
    false
  );
  assert.equal(proLim.maxCustomTypes, 2, "الحزمة الإضافية لا تنطبق على الباقة الثانية");
  assert.equal(proLim.maxCustomFieldsPerType, 5);
  assert.equal(proLim.allowReorder, true);
  assert.equal(proLim.allowImportExport, true, "الباقة الثانية تسمح باستيراد وتصدير الأنواع والقياسات");
  assert.equal(proLim.canRequestExtraTypesAddon, false);

  const bizLim = resolvePlanLimits(
    makeTenant({ planId: "business", subscriptionStatus: "active", extraCustomTypesQuota: 0 }),
    businessPlan,
    false
  );
  assert.equal(bizLim.maxCustomTypes, 5);
  assert.equal(bizLim.maxCustomFieldsPerType, -1);
  assert.equal(bizLim.allowReorder, true);
  assert.equal(bizLim.allowImportExport, true);
  assert.equal(bizLim.canRequestExtraTypesAddon, true);
  assert.equal(bizLim.extraTypesPackSize, 5);
  assert.equal(bizLim.extraTypesPackPriceJod, 10);

  const adminLim = resolvePlanLimits(
    makeTenant({ email: "Xtashtoush@gmail.com", planId: "starter", subscriptionStatus: "active" }),
    starterPlan,
    true
  );
  assert.equal(adminLim.allowImportExport, true);

  const bizWithAddon = resolvePlanLimits(
    makeTenant({ planId: "business", subscriptionStatus: "active", extraCustomTypesQuota: 5 }),
    businessPlan,
    false
  );
  assert.equal(bizWithAddon.maxCustomTypes, 10);
  assert.equal(bizWithAddon.canRequestExtraTypesAddon, false, "عند بلوغ 10 أنواع تُغلق الحزم الإضافية");

  const bizOverCapped = resolvePlanLimits(
    makeTenant({ planId: "business", subscriptionStatus: "active", extraCustomTypesQuota: 50 }),
    businessPlan,
    false
  );
  assert.equal(bizOverCapped.maxCustomTypes, 10, "سقف الإطلاق التجريبي 10 أنواع لا يُتجاوز");
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

  // 10 أنواع صالحة تُقبل و 11 نوعاً تُرفض حتى مع حصة قديمة مرتفعة
  const bizOverQuota = makeTenant({
    planId: "business",
    subscriptionStatus: "active",
    extraCustomTypesQuota: 20,
  });
  assert.doesNotThrow(() =>
    assertSnapshotWithinPlanLimits(
      bizOverQuota,
      businessPlan,
      makeSnapshot({
        utypes: Array.from({ length: 10 }, (_, i) => ({ name: `نوع_${i + 1}` })),
        custom: { "نوع_10": [{ id: "c1", name: "ع1", group: "frame" }] },
      })
    )
  );
  assert.throws(() =>
    assertSnapshotWithinPlanLimits(
      bizOverQuota,
      businessPlan,
      makeSnapshot({
        utypes: Array.from({ length: 11 }, (_, i) => ({ name: `نوع_${i + 1}` })),
      })
    )
  );

  // النوع العاشر ببنية غير صالحة أو بدون name يُرفض
  assert.throws(() =>
    assertSnapshotWithinPlanLimits(
      bizOverQuota,
      businessPlan,
      makeSnapshot({
        utypes: [
          ...Array.from({ length: 9 }, (_, i) => ({ name: `نوع_${i + 1}` })),
          { label: "بدون اسم" } as unknown as { name: string },
        ],
      })
    )
  );

  // عنصر غير صالح داخل قائمة utypes (اسم فارغ أو مسافات)
  assert.throws(() =>
    assertSnapshotWithinPlanLimits(
      bizTenant,
      businessPlan,
      makeSnapshot({ utypes: [{ name: "" }] as unknown as AppState["utypes"] })
    )
  );
  assert.throws(() =>
    assertSnapshotWithinPlanLimits(
      bizTenant,
      businessPlan,
      makeSnapshot({ utypes: [{ name: "   " }] as unknown as AppState["utypes"] })
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

  // مفتاح custom غير معروف يُرفض حتى على باقة Business
  assert.throws(() =>
    assertSnapshotWithinPlanLimits(
      bizTenant,
      businessPlan,
      makeSnapshot({
        utypes: [{ name: "نوع_1" }],
        custom: { "مفتاح_غير_معروف": [{ id: "c1", name: "ع1", group: "frame" }] },
      })
    )
  );

  // قيمة مفتاح داخل custom ليست قائمة (string أو map)
  assert.throws(() =>
    assertSnapshotWithinPlanLimits(
      bizTenant,
      businessPlan,
      makeSnapshot({
        custom: { "شباك 3 مجاري نظامي": "bad-list" } as unknown as AppState["custom"],
      })
    )
  );
  assert.throws(() =>
    assertSnapshotWithinPlanLimits(
      bizTenant,
      businessPlan,
      makeSnapshot({
        custom: { "شباك 3 مجاري نظامي": { a: 1 } } as unknown as AppState["custom"],
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
  assert.ok(rulesText.includes("projectData.snapshot.utypes.size() <= 10"));
  assert.equal(
    rulesText.includes("projectData.snapshot.utypes.size() <= 210"),
    false,
    "ممنوع السماح بأكثر من 10 أنواع مخصصة في قواعد Firestore"
  );
  assert.ok(rulesText.includes("hasValidCustomMapShape"));
  assert.ok(rulesText.includes("allowedCustomKeys"));
  assert.ok(rulesText.includes("adminExtraQuotaWithinCap"));
  assert.equal(
    rulesText.includes("!(projectData.snapshot.utypes is list)"),
    false,
    "ممنوع السماح بتمرير utypes غير القائمة"
  );
  assert.equal(
    rulesText.includes(": true\n              )"),
    false,
    "ممنوع وجود مسار تجاوز في customFieldsWithinLimit"
  );
  assert.ok(rulesText.includes("data.trialDaysDefault is int && data.trialDaysDefault == 7"));
  assert.ok(rulesText.includes("planAllowsNewProject"));
  assert.ok(rulesText.includes("planAllowsCustomTypes"));
  assert.ok(rulesText.includes("planAllowsCustomFields"));
  assert.ok(rulesText.includes("planAllowsExtraTypesAddon"));
  assert.ok(
    rulesText.includes(
      "incoming().requestType == 'extra_types_addon' &&\n            get(/databases/$(database)/documents/tenants/$(request.auth.uid)).data.subscriptionStatus == 'active' &&\n            hasActiveTenantAccess(get(/databases/$(database)/documents/tenants/$(request.auth.uid)).data)"
    ),
    "يجب التحقق من hasActiveTenantAccess عند طلب extra_types_addon لمنع الحسابات المنتهية"
  );
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

  // 7. فحص وجود تقرير مراجعة الحصص القديمة في AdminPanel (قراءة فقط)
  const adminPanelTs = fs.readFileSync(path.resolve("src/saas/AdminPanel.tsx"), "utf8");
  assert.ok(adminPanelTs.includes("legacyQuotaReview"), "يجب عرض تقرير قراءة فقط للحصص القديمة المتجاوزة للسقف");
});

runTest("توقيت الاشتراكات الخادمي: activatedAt + subscriptionDays [30,90,365] وتجاهل activeUntil القديم والتوافق الخلفي", () => {
  const start = 1_750_000_000_000;

  // 1. فحص المدد المسموحة فقط
  assert.equal(isAllowedSubscriptionDays(30), true);
  assert.equal(isAllowedSubscriptionDays(90), true);
  assert.equal(isAllowedSubscriptionDays(365), true);
  for (const invalid of [0, -1, 7, 15, 60, 180, 1000, 30.5, "30", null, undefined]) {
    assert.equal(isAllowedSubscriptionDays(invalid), false, `يجب رفض المدة غير المدعومة: ${String(invalid)}`);
  }

  // 2. اشتراك خادمي 30 يوماً: فعّال خلال المدة، تحذير أقل من 48 ساعة، ومنتهي فور تجاوز activatedAt + 30d
  const srvTenant = makeTenant({
    subscriptionStatus: "active",
    planId: "pro",
    activatedAt: Timestamp.fromMillis(start),
    subscriptionDays: 30,
    activeUntil: null,
  });
  const expiryInfo = getSubscriptionExpiryMs(srvTenant);
  assert.equal(expiryInfo.isServerTimed, true);
  assert.equal(expiryInfo.endMs, start + 30 * DAY_MS);

  const day10 = evaluateTenantAccess(srvTenant, start + 10 * DAY_MS);
  assert.equal(day10.allowed, true);
  assert.equal(day10.state, "active");
  assert.equal(day10.daysLeft, 20);
  assert.equal(day10.isExpiringSoon, false);
  assert.equal(day10.activeUntilMs, start + 30 * DAY_MS);

  const day29 = evaluateTenantAccess(srvTenant, start + 29 * DAY_MS);
  assert.equal(day29.allowed, true);
  assert.equal(day29.isExpiringSoon, true);

  const after30 = evaluateTenantAccess(srvTenant, start + 30 * DAY_MS + 1000);
  assert.equal(after30.allowed, false);
  assert.equal(after30.state, "expired");

  // 3. تجديد 90 يوماً و 365 يوماً
  const srv90 = makeTenant({
    subscriptionStatus: "active",
    planId: "business",
    activatedAt: Timestamp.fromMillis(start),
    subscriptionDays: 90,
    activeUntil: null,
  });
  assert.equal(evaluateTenantAccess(srv90, start + 89 * DAY_MS).allowed, true);
  assert.equal(evaluateTenantAccess(srv90, start + 90 * DAY_MS + 1000).allowed, false);

  const srv365 = makeTenant({
    subscriptionStatus: "active",
    planId: "business",
    activatedAt: Timestamp.fromMillis(start),
    subscriptionDays: 365,
    activeUntil: null,
  });
  assert.equal(evaluateTenantAccess(srv365, start + 364 * DAY_MS).allowed, true);
  assert.equal(evaluateTenantAccess(srv365, start + 365 * DAY_MS + 1000).allowed, false);

  // 4. الحساب المحدّث يتجاهل activeUntil القديم تماماً حتى لو كان في المستقبل
  const conflictTenant = makeTenant({
    subscriptionStatus: "active",
    planId: "business",
    activatedAt: Timestamp.fromMillis(start),
    subscriptionDays: 30,
    activeUntil: Timestamp.fromMillis(start + 500 * DAY_MS),
  });
  assert.equal(getSubscriptionExpiryMs(conflictTenant).endMs, start + 30 * DAY_MS);
  assert.equal(evaluateTenantAccess(conflictTenant, start + 31 * DAY_MS).allowed, false);

  // 5. بنية جزئية غير مكتملة (activatedAt دون subscriptionDays أو العكس) تغلق الحساب ولا ترجع لـ activeUntil
  const halfTenant = makeTenant({
    subscriptionStatus: "active",
    planId: "pro",
    activatedAt: Timestamp.fromMillis(start),
    activeUntil: Timestamp.fromMillis(start + 300 * DAY_MS),
  });
  assert.equal(evaluateTenantAccess(halfTenant, start + 1 * DAY_MS).allowed, false);

  // 6. التوافق الخلفي للحسابات القديمة التي لا تحتوي activatedAt أو subscriptionDays وتعتمد على activeUntil
  const legacyTenant = makeTenant({
    subscriptionStatus: "active",
    planId: "starter",
    activeUntil: Timestamp.fromMillis(start + 30 * DAY_MS),
  });
  assert.equal(getSubscriptionExpiryMs(legacyTenant).isServerTimed, false);
  assert.equal(evaluateTenantAccess(legacyTenant, start + 15 * DAY_MS).allowed, true);
  assert.equal(evaluateTenantAccess(legacyTenant, start + 31 * DAY_MS).allowed, false);

  // 7. الحساب الموقوف (suspended) بحساب خادمي يبقى مقفلاً رغم بقاء مدة
  const suspendedSrv = makeTenant({
    subscriptionStatus: "suspended",
    planId: "pro",
    activatedAt: Timestamp.fromMillis(start),
    subscriptionDays: 30,
    activeUntil: null,
  });
  const suspEv = evaluateTenantAccess(suspendedSrv, start + 5 * DAY_MS);
  assert.equal(suspEv.allowed, false);
  assert.equal(suspEv.state, "suspended");
  assert.equal(suspEv.activeUntilMs, start + 30 * DAY_MS);

  // 8. التحقق الثابت من الكود وقواعد Firestore لضمان عدم الاعتماد على ساعة المتصفح في التفعيل أو التجديد
  const serviceText = fs.readFileSync(path.resolve("src/saas/service.ts"), "utf8");
  const activateBlock = serviceText.slice(
    serviceText.indexOf("export async function adminActivateTenant"),
    serviceText.indexOf("export async function adminGrantExtraTypesQuota")
  );
  assert.equal(
    activateBlock.includes("Timestamp.fromMillis"),
    false,
    "adminActivateTenant يجب ألا يحسب activeUntil عبر Timestamp.fromMillis في المتصفح"
  );
  assert.ok(activateBlock.includes("activatedAt: serverTimestamp()"));
  assert.ok(activateBlock.includes("subscriptionDays: opts.durationDays"));
  assert.ok(activateBlock.includes("activeUntil: null"));

  const reviewBlock = serviceText.slice(
    serviceText.indexOf("export async function adminReviewActivationRequest"),
    serviceText.indexOf("export async function adminSavePlan")
  );
  assert.equal(
    reviewBlock.includes("Timestamp.fromMillis"),
    false,
    "adminReviewActivationRequest يجب ألا يحسب activeUntil عبر Timestamp.fromMillis في المتصفح"
  );
  assert.ok(reviewBlock.includes("activatedAt: serverTimestamp()"));
  assert.ok(reviewBlock.includes("subscriptionDays: durationDays"));
  assert.ok(reviewBlock.includes("activeUntil: null"));

  const rulesText = fs.readFileSync(path.resolve("firestore.rules"), "utf8");
  assert.ok(rulesText.includes("function isValidSubscriptionDays(d) {\n      return d is int && d in [30, 90, 365];\n    }"));
  assert.ok(rulesText.includes("incoming().activatedAt == request.time"));
  assert.ok(rulesText.includes("isValidSubscriptionDays(incoming().subscriptionDays)"));
  assert.ok(rulesText.includes("incoming().activeUntil == null"));
  assert.ok(rulesText.includes("request.time <= tenantData.activatedAt + duration.value(tenantData.subscriptionDays, 'd')"));
  assert.ok(rulesText.includes("activatedAtUnchanged(incoming(), existing())"));
  assert.ok(rulesText.includes("subscriptionDaysUnchanged(incoming(), existing())"));
});

runTest("توحيد التحقق الزمني في العمليات الإدارية: إلغاء الاعتماد على ساعة جهاز المدير وتمديد التجربة الخادمي", () => {
  const start = 1_760_000_000_000;

  // 1. فحص مدد تمديد التجربة المعتمدة فقط [3, 7, 14, 30]
  for (const okDays of [3, 7, 14, 30]) {
    assert.equal(isAllowedTrialExtensionDays(okDays), true);
  }
  for (const badDays of [0, -7, 1, 5, 10, 45, 60, 365, 3650, 7.5, "7", null, undefined]) {
    assert.equal(isAllowedTrialExtensionDays(badDays), false, `يجب رفض مدة تمديد غير صالحة: ${String(badDays)}`);
  }

  // 2. استنتاج الحالة المرشحة لإعادة التفعيل ورفض طلب الدفع يعتمد على البنية فقط (بمعزل تماماً عن أي ساعة جهاز: +365 يوم أو -365 يوم)
  const paidServerTenant = makeTenant({
    subscriptionStatus: "suspended",
    planId: "pro",
    activatedAt: Timestamp.fromMillis(start),
    subscriptionDays: 30,
    activeUntil: null,
  });
  const paidLegacyTenant = makeTenant({
    subscriptionStatus: "suspended",
    planId: "starter",
    activeUntil: Timestamp.fromMillis(start + 30 * DAY_MS),
  });
  const pureTrialTenant = makeTenant({
    subscriptionStatus: "pending_payment",
    planId: "trial",
    trialDays: 7,
    activeUntil: null,
  });

  // بغض النظر عن اختلاف ساعة جهاز المدير (+365 يوماً أو -365 يوماً)، المرشح البنيوي لا يتأثر إطلاقاً
  const candSrv = resolveServerVerifiedStatusCandidates(paidServerTenant);
  assert.equal(candSrv.primaryStatus, "active");
  assert.equal(candSrv.isPaidAccount, true);

  const candLegacy = resolveServerVerifiedStatusCandidates(paidLegacyTenant);
  assert.equal(candLegacy.primaryStatus, "active");
  assert.equal(candLegacy.isPaidAccount, true);

  const candTrial = resolveServerVerifiedStatusCandidates(pureTrialTenant);
  assert.equal(candTrial.primaryStatus, "trialing");
  assert.equal(candTrial.isPaidAccount, false);

  // 3. تقييم تمديد التجربة الخادمي (trialExtendedAt + trialExtensionDays) مع بقاء trialDays == 7
  const extendedTrial = makeTenant({
    subscriptionStatus: "trialing",
    planId: "trial",
    trialDays: 7,
    createdAt: Timestamp.fromMillis(start - 25 * DAY_MS), // التجربة الأصلية منتهية منذ 18 يوماً
    trialExtendedAt: Timestamp.fromMillis(start),
    trialExtensionDays: 7,
    activeUntil: null,
  });
  const triInfo = getTrialExpiryMs(extendedTrial);
  assert.equal(triInfo.hasExtension, true);
  assert.equal(triInfo.trialEndsAtMs, start + 7 * DAY_MS);

  const extDay3 = evaluateTenantAccess(extendedTrial, start + 3 * DAY_MS);
  assert.equal(extDay3.allowed, true);
  assert.equal(extDay3.state, "trialing");
  assert.equal(extDay3.daysLeft, 4);

  const extDay8 = evaluateTenantAccess(extendedTrial, start + 7 * DAY_MS + 1000);
  assert.equal(extDay8.allowed, false);
  assert.equal(extDay8.state, "expired");

  // تمديد 14 يوماً يعرض أياماً متبقية دقيقة حتى 14 يوماً مع بقاء trialDays == 7
  const extended14 = makeTenant({
    subscriptionStatus: "trialing",
    planId: "trial",
    trialDays: 7,
    createdAt: Timestamp.fromMillis(start - 20 * DAY_MS),
    trialExtendedAt: Timestamp.fromMillis(start),
    trialExtensionDays: 14,
    activeUntil: null,
  });
  assert.equal(evaluateTenantAccess(extended14, start + 1 * DAY_MS).daysLeft, 13);
  assert.equal(evaluateTenantAccess(extended14, start + 14 * DAY_MS + 1000).allowed, false);

  // 4. التحقق الثابت من خلو الدوال الإدارية الثلاث من serverNowMs أو Date.now() لاتخاذ قرارات الصلاحية
  const serviceText = fs.readFileSync(path.resolve("src/saas/service.ts"), "utf8");

  const extendBlock = serviceText.slice(
    serviceText.indexOf("export async function adminExtendTrial"),
    serviceText.indexOf("export async function adminSuspendTenant")
  );
  assert.equal(extendBlock.includes("serverNowMs"), false, "adminExtendTrial يجب ألا يعتمد على serverNowMs");
  assert.equal(extendBlock.includes("Date.now"), false, "adminExtendTrial يجب ألا يعتمد على Date.now()");
  assert.equal(extendBlock.includes("elapsedDays"), false, "adminExtendTrial يجب ألا يحسب elapsedDays من ساعة المتصفح");
  assert.ok(extendBlock.includes("trialExtendedAt: serverTimestamp()"));
  assert.ok(extendBlock.includes("trialExtensionDays: extraDays"));
  assert.ok(extendBlock.includes("hasPaidHistory"), "يجب منع تمديد التجربة للحسابات المدفوعة");

  const reactivateBlock = serviceText.slice(
    serviceText.indexOf("export async function adminReactivateTenant"),
    serviceText.indexOf("export async function adminReviewActivationRequest")
  );
  assert.equal(reactivateBlock.includes("serverNowMs"), false, "adminReactivateTenant يجب ألا يعتمد على serverNowMs");
  assert.equal(reactivateBlock.includes("Date.now"), false, "adminReactivateTenant يجب ألا يعتمد على Date.now()");
  assert.ok(reactivateBlock.includes("resolveServerVerifiedStatusCandidates"));

  const reviewBlock = serviceText.slice(
    serviceText.indexOf("export async function adminReviewActivationRequest"),
    serviceText.indexOf("export async function adminSavePlan")
  );
  assert.equal(reviewBlock.includes("serverNowMs"), false, "adminReviewActivationRequest يجب ألا يعتمد على serverNowMs");
  assert.equal(reviewBlock.includes("Date.now"), false, "adminReviewActivationRequest يجب ألا يعتمد على Date.now()");
  assert.ok(reviewBlock.includes("resolveServerVerifiedStatusCandidates"));

  // 5. التحقق الثابت من AdminPanel.tsx بعدم تمرير serverNowMs للدوال الإدارية
  const adminPanelText = fs.readFileSync(path.resolve("src/saas/AdminPanel.tsx"), "utf8");
  assert.equal(adminPanelText.includes("adminExtendTrial(adminUser, t, days, serverNowMs)"), false);
  assert.equal(adminPanelText.includes("adminReactivateTenant(adminUser, t, serverNowMs)"), false);
  assert.equal(adminPanelText.includes("adminReviewActivationRequest(adminUser, req, decision, duration, serverNowMs)"), false);

  // 6. التحقق الثابت من قواعد Firestore: Branch A1 و A2 و A3 وحماية حقول التوقيت
  const rulesText = fs.readFileSync(path.resolve("firestore.rules"), "utf8");
  assert.ok(rulesText.includes("function isValidTrialExtensionDays(d) {\n      return d is int && d in [3, 7, 14, 30];\n    }"));
  assert.ok(rulesText.includes("function hasValidTrialAccess(tenantData)"));
  assert.ok(rulesText.includes("incoming().trialExtendedAt == request.time"));
  assert.ok(rulesText.includes("isValidTrialExtensionDays(incoming().trialExtensionDays)"));
  assert.ok(rulesText.includes("trialExtendedAtUnchanged(incoming(), existing())"));
  assert.ok(rulesText.includes("trialExtensionDaysUnchanged(incoming(), existing())"));
  assert.ok(
    rulesText.includes("incoming().subscriptionStatus == 'expired' &&\n                existing().subscriptionStatus in ['suspended', 'pending_payment', 'trialing', 'active'] &&\n                !hasValidPaidSubscription(existing()) &&\n                !hasValidTrialAccess(existing())"),
    "يجب منع تحويل أي اشتراك مدفوع صالح أو تجربة صالحة إلى expired في قواعد Firestore"
  );
});

runTest("توافق الحساب المدفوع القديم (activeUntil == null دون activatedAt/subscriptionDays) في حالة pending_payment دون كسر الإغلاق الخادمي", () => {
  const now = 1_760_000_000_000;

  // 1. حساب مدفوع قديم دائم (planId != trial، لا يوجد activatedAt/subscriptionDays، activeUntil == null) في حالة pending_payment
  const legacyPermPending = makeTenant({
    subscriptionStatus: "pending_payment",
    planId: "pro",
    activeUntil: null,
    createdAt: Timestamp.fromMillis(now - 90 * DAY_MS),
  });
  const evalLegacyPending = evaluateTenantAccess(legacyPermPending, now);
  assert.equal(evalLegacyPending.allowed, true, "الحساب المدفوع القديم الدائم في pending_payment يجب أن يبقى فعّالاً");
  assert.equal(evalLegacyPending.state, "active");
  assert.equal(evalLegacyPending.hasPendingPayment, true);
  assert.equal(evalLegacyPending.remainingLabel, "دائم");

  const candLegacyPending = resolveServerVerifiedStatusCandidates(legacyPermPending);
  assert.equal(candLegacyPending.primaryStatus, "active");
  assert.equal(candLegacyPending.isPaidAccount, true);

  // 2. حساب خادمي منتهي (activatedAt + 30d في الماضي، activeUntil == null) في pending_payment يبقى مقفلاً بالكامل
  const serverExpiredPending = makeTenant({
    subscriptionStatus: "pending_payment",
    planId: "pro",
    activatedAt: Timestamp.fromMillis(now - 45 * DAY_MS),
    subscriptionDays: 30,
    activeUntil: null,
    createdAt: Timestamp.fromMillis(now - 90 * DAY_MS),
  });
  const evalSrvExp = evaluateTenantAccess(serverExpiredPending, now);
  assert.equal(evalSrvExp.allowed, false, "الحساب الخادمي المنتهي مع activeUntil == null يجب أن يبقى مقفلاً");
  assert.equal(evalSrvExp.state, "pending_payment");

  // 3. حساب قديم expired مع activeUntil == null يبقى مقفلاً بالكامل
  const legacyExpiredNull = makeTenant({
    subscriptionStatus: "expired",
    planId: "starter",
    activeUntil: null,
    createdAt: Timestamp.fromMillis(now - 90 * DAY_MS),
  });
  const evalLegacyExp = evaluateTenantAccess(legacyExpiredNull, now);
  assert.equal(evalLegacyExp.allowed, false);
  assert.equal(evalLegacyExp.state, "expired");

  // 4. التحقق من قاعدة firestore.rules: شمول pending_payment للحساب القديم الدائم + حارس منع التصعيد من expired -> pending_payment
  const rulesText = fs.readFileSync(path.resolve("firestore.rules"), "utf8");
  assert.ok(
    rulesText.includes("(tenantData.subscriptionStatus in ['active', 'suspended', 'pending_payment'] && tenantData.activeUntil == null)"),
    "hasValidPaidSubscription يجب أن تشمل pending_payment للحسابات المدفوعة القديمة التي activeUntil لديها null"
  );
  assert.ok(
    rulesText.includes("(!hasValidPaidSubscription(incoming()) || hasValidPaidSubscription(existing()))"),
    "يجب وجود حارس منع تصعيد حساب expired إلى pending_payment في قاعدة العميل"
  );
});

console.log(`\nاكتملت جميع اختبارات الأمان والاشتراكات وخطة Spark بنجاح (${passed}/${passed}).`);
