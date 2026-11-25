/**
 * اختبارات قواعد أمان Firestore الحقيقية عبر Firebase Emulator (@firebase/rules-unit-testing).
 *
 * التشغيل الموصى به (يتطلب Java 17+ ومثبت Firebase CLI):
 *   npm run test:rules:emulator
 *
 * أو عند تشغيل محاكي Firestore مسبقاً على المنفذ 8080:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test:rules:direct
 */
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";

const OWNER_EMAIL = "xtashtoush@gmail.com";
const OWNER_UID = "owner_admin_uid";
const PROJECT_ID = "demo-window-calc-spark";
const DAY_MS = 86_400_000;

const BUILTIN_TYPE = "شباك 3 مجاري نظامي";

function parseEmulatorHost(): { host: string; port: number } {
  const raw = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
  const [host, portStr] = raw.split(":");
  const port = Number(portStr) || 8080;
  return { host: host || "127.0.0.1", port };
}

function asDb(ctx: { firestore(): unknown }): Firestore {
  return ctx.firestore() as unknown as Firestore;
}

function makePlanDoc(
  id: string,
  opts: {
    name: string;
    maxProjects: number;
    maxCustomTypes: number;
    maxCustomFieldsPerType: number;
    allowExtraTypesAddon: boolean;
    sortOrder: number;
  }
) {
  return {
    id,
    name: opts.name,
    priceLabel: "10 دينار / شهرياً",
    priceMonthlyJod: 10,
    maxProjects: opts.maxProjects,
    allowExport: true,
    allowCustomTypes: opts.maxCustomTypes !== 0,
    maxCustomTypes: opts.maxCustomTypes,
    maxCustomFieldsPerType: opts.maxCustomFieldsPerType,
    allowExtraTypesAddon: opts.allowExtraTypesAddon,
    extraTypesPackSize: opts.allowExtraTypesAddon ? 5 : 0,
    extraTypesPackPriceJod: opts.allowExtraTypesAddon ? 10 : 0,
    active: true,
    sortOrder: opts.sortOrder,
    features: ["ميزة 1"],
    updatedAt: Timestamp.now(),
  };
}

function makeSeedTenant(
  uid: string,
  email: string,
  overrides: Record<string, unknown> = {}
) {
  const now = Timestamp.now();
  return {
    ownerUid: uid,
    email,
    displayName: "ورشة اختبار",
    workshopName: "ورشة اختبار",
    phone: "0790000001",
    role: "owner",
    subscriptionStatus: "trialing",
    planId: "trial",
    trialDays: 7,
    activeUntil: null,
    adminNote: "",
    projectCount: 0,
    extraCustomTypesQuota: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeProjectDoc(
  ownerUid: string,
  snapshot: Record<string, unknown>,
  ts: unknown = serverTimestamp()
) {
  return {
    ownerUid,
    name: "مشروع اختبار",
    windowType: BUILTIN_TYPE,
    unit: "cm",
    windowCount: 2,
    snapshot,
    createdAt: ts,
    updatedAt: ts,
  };
}

function makeUtypes(count: number) {
  return Array.from({ length: count }, (_, i) => ({ name: `نوع_مخصص_${i + 1}` }));
}

function makeFields(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `c_${i + 1}`,
    name: `علاقة_${i + 1}`,
    group: "frame",
  }));
}

async function seedBaseFixtures(testEnv: RulesTestEnvironment): Promise<void> {
  const nowMs = Date.now();
  const future30d = Timestamp.fromMillis(nowMs + 30 * DAY_MS);
  const past8d = Timestamp.fromMillis(nowMs - 8 * DAY_MS);

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = asDb(ctx);

    await setDoc(doc(db, "config", "platform"), {
      whatsappPhone: "0798904182",
      cliqAlias: "WINDOWCALC",
      cliqBankName: "بنك تجريبي",
      cliqHolderName: "مالك المنصة",
      trialDaysDefault: 7,
      supportNote: "أرسل الإيصال عبر واتساب",
      updatedBy: OWNER_UID,
      updatedAt: Timestamp.now(),
    });

    await setDoc(
      doc(db, "plans", "starter"),
      makePlanDoc("starter", {
        name: "الباقة الأساسية",
        maxProjects: 25,
        maxCustomTypes: 0,
        maxCustomFieldsPerType: 2,
        allowExtraTypesAddon: false,
        sortOrder: 1,
      })
    );
    await setDoc(
      doc(db, "plans", "pro"),
      makePlanDoc("pro", {
        name: "الباقة الاحترافية",
        maxProjects: 200,
        maxCustomTypes: 2,
        maxCustomFieldsPerType: 5,
        allowExtraTypesAddon: false,
        sortOrder: 2,
      })
    );
    await setDoc(
      doc(db, "plans", "business"),
      makePlanDoc("business", {
        name: "باقة الورش والمصانع",
        maxProjects: -1,
        maxCustomTypes: 5,
        maxCustomFieldsPerType: -1,
        allowExtraTypesAddon: true,
        sortOrder: 3,
      })
    );

    // ورش متنوعة للاختبار
    await setDoc(
      doc(db, "tenants", "trial_ok"),
      makeSeedTenant("trial_ok", "trial_ok@workshop.jo", {
        subscriptionStatus: "trialing",
        planId: "trial",
        trialDays: 7,
        projectCount: 0,
      })
    );
    await setDoc(
      doc(db, "tenants", "trial_full"),
      makeSeedTenant("trial_full", "trial_full@workshop.jo", {
        subscriptionStatus: "trialing",
        planId: "trial",
        trialDays: 7,
        projectCount: 25,
      })
    );
    await setDoc(
      doc(db, "tenants", "trial_expired"),
      makeSeedTenant("trial_expired", "trial_expired@workshop.jo", {
        subscriptionStatus: "trialing",
        planId: "trial",
        trialDays: 7,
        createdAt: past8d,
        updatedAt: past8d,
        projectCount: 1,
      })
    );
    await setDoc(
      doc(db, "tenants", "pending_expired"),
      makeSeedTenant("pending_expired", "pending_expired@workshop.jo", {
        subscriptionStatus: "pending_payment",
        planId: "trial",
        trialDays: 7,
        createdAt: past8d,
        updatedAt: past8d,
        projectCount: 1,
      })
    );
    await setDoc(
      doc(db, "tenants", "starter_user"),
      makeSeedTenant("starter_user", "starter@workshop.jo", {
        subscriptionStatus: "active",
        planId: "starter",
        activeUntil: future30d,
        projectCount: 1,
      })
    );
    await setDoc(
      doc(db, "tenants", "pro_user"),
      makeSeedTenant("pro_user", "pro@workshop.jo", {
        subscriptionStatus: "active",
        planId: "pro",
        activeUntil: future30d,
        extraCustomTypesQuota: 5, // يجب تجاهلها لأن pro لا تسمح بالحزمة الإضافية
        projectCount: 1,
      })
    );
    await setDoc(
      doc(db, "tenants", "biz_user"),
      makeSeedTenant("biz_user", "biz@workshop.jo", {
        subscriptionStatus: "active",
        planId: "business",
        activeUntil: future30d,
        extraCustomTypesQuota: 0,
        projectCount: 1,
      })
    );
    await setDoc(
      doc(db, "tenants", "biz_plus_user"),
      makeSeedTenant("biz_plus_user", "biz_plus@workshop.jo", {
        subscriptionStatus: "active",
        planId: "business",
        activeUntil: future30d,
        extraCustomTypesQuota: 5,
        projectCount: 1,
      })
    );

    // مشاريع أولية للتحديث واختبارات العزل
    for (const uid of [
      "trial_expired",
      "pending_expired",
      "starter_user",
      "pro_user",
      "biz_user",
      "biz_plus_user",
    ]) {
      await setDoc(
        doc(db, "tenants", uid, "projects", "proj_existing"),
        makeProjectDoc(uid, { utypes: [], custom: {} }, Timestamp.now())
      );
    }

    // طلب تفعيل CliQ معلق لاختبار الموافقة لمرة واحدة فقط
    await setDoc(doc(db, "activation_requests", "req_pending_1"), {
      tenantId: "trial_expired",
      ownerUid: "trial_expired",
      email: "trial_expired@workshop.jo",
      workshopName: "ورشة اختبار",
      phone: "0790000001",
      planId: "pro",
      billingCycle: "monthly",
      cliqNote: "حوالة رقم 12345",
      status: "pending",
      reviewedBy: "",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    // سجل تدقيق أولي لاختبار عدم القابلية للتعديل أو الحذف
    await setDoc(doc(db, "audit_logs", "log_seed_1"), {
      actorUid: OWNER_UID,
      actorEmail: OWNER_EMAIL,
      action: "seed",
      targetTenantId: "platform",
      details: "تهيئة أولية",
      beforeState: "",
      afterState: "",
      createdAt: Timestamp.now(),
    });
  });
}

async function main() {
  const rulesPath = path.resolve("firestore.rules");
  const rules = fs.readFileSync(rulesPath, "utf8");
  const { host, port } = parseEmulatorHost();

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules, host, port },
  });

  let passed = 0;

  async function runCase(name: string, fn: () => Promise<void>) {
    await testEnv.clearFirestore();
    await seedBaseFixtures(testEnv);
    try {
      await fn();
      passed++;
      console.log(`✓ ${name}`);
    } catch (err) {
      console.error(`✗ ${name}`);
      throw err;
    }
  }

  try {
    // 1. مستخدم غير موثق البريد
    await runCase("رفض جميع عمليات المستخدم غير الموثّق (email_verified: false)", async () => {
      const unverified = testEnv.authenticatedContext("unv_1", {
        email: "unv@workshop.jo",
        email_verified: false,
      });
      const db = asDb(unverified);

      await assertFails(getDoc(doc(db, "config", "platform")));
      await assertFails(
        setDoc(doc(db, "tenants", "unv_1"), {
          ownerUid: "unv_1",
          email: "unv@workshop.jo",
          displayName: "ورشة",
          workshopName: "ورشة",
          phone: "0790000001",
          role: "owner",
          subscriptionStatus: "trialing",
          planId: "trial",
          trialDays: 7,
          activeUntil: null,
          adminNote: "",
          projectCount: 0,
          extraCustomTypesQuota: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      await assertFails(
        setDoc(
          doc(db, "tenants", "unv_1", "projects", "p1"),
          makeProjectDoc("unv_1", {})
        )
      );
    });

    // 2. تسجيل جديد صالح + رفض التفعيل الذاتي وتغيير مدة التجربة والترقية لمدير
    await runCase("منع المستخدم من تفعيل اشتراكه بنفسه أو تغيير trialDays أو انتحال دور admin", async () => {
      const u = testEnv.authenticatedContext("new_user", {
        email: "new@workshop.jo",
        email_verified: true,
      });
      const db = asDb(u);

      // محاولة تفعيل ذاتي عند الإنشاء
      await assertFails(
        setDoc(doc(db, "tenants", "new_user"), {
          ownerUid: "new_user",
          email: "new@workshop.jo",
          displayName: "ورشة",
          workshopName: "ورشة",
          phone: "",
          role: "owner",
          subscriptionStatus: "active",
          planId: "business",
          trialDays: 7,
          activeUntil: null,
          adminNote: "",
          projectCount: 0,
          extraCustomTypesQuota: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      // محاولة تعيين مدة تجربة مختلفة عن 7 أيام
      await assertFails(
        setDoc(doc(db, "tenants", "new_user"), {
          ownerUid: "new_user",
          email: "new@workshop.jo",
          displayName: "ورشة",
          workshopName: "ورشة",
          phone: "",
          role: "owner",
          subscriptionStatus: "trialing",
          planId: "trial",
          trialDays: 30,
          activeUntil: null,
          adminNote: "",
          projectCount: 0,
          extraCustomTypesQuota: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      // محاولة انتحال دور admin
      await assertFails(
        setDoc(doc(db, "tenants", "new_user"), {
          ownerUid: "new_user",
          email: "new@workshop.jo",
          displayName: "ورشة",
          workshopName: "ورشة",
          phone: "",
          role: "admin",
          subscriptionStatus: "active",
          planId: "owner_free",
          trialDays: 0,
          activeUntil: null,
          adminNote: "",
          projectCount: 0,
          extraCustomTypesQuota: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      // إنشاء سليم لتجربة 7 أيام ينجح
      await assertSucceeds(
        setDoc(doc(db, "tenants", "new_user"), {
          ownerUid: "new_user",
          email: "new@workshop.jo",
          displayName: "ورشة جديدة",
          workshopName: "ورشة جديدة",
          phone: "0791111111",
          role: "owner",
          subscriptionStatus: "trialing",
          planId: "trial",
          trialDays: 7,
          activeUntil: null,
          adminNote: "",
          projectCount: 0,
          extraCustomTypesQuota: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      // محاولة الترقية الذاتية بعد الإنشاء
      await assertFails(
        updateDoc(doc(db, "tenants", "new_user"), {
          subscriptionStatus: "active",
          planId: "business",
          updatedAt: serverTimestamp(),
        })
      );

      // محاولة تعديل trialDays بعد الإنشاء
      await assertFails(
        updateDoc(doc(db, "tenants", "new_user"), {
          trialDays: 90,
          updatedAt: serverTimestamp(),
        })
      );
    });

    // 3. الوصول إلى ورشة أخرى (عزل كامل بين المستأجرين)
    await runCase("منع الوصول إلى بيانات أو مشاريع ورشة أخرى (Cross-Tenant Isolation)", async () => {
      const starterCtx = testEnv.authenticatedContext("starter_user", {
        email: "starter@workshop.jo",
        email_verified: true,
      });
      const db = asDb(starterCtx);

      await assertFails(getDoc(doc(db, "tenants", "pro_user")));
      await assertFails(getDoc(doc(db, "tenants", "pro_user", "projects", "proj_existing")));
      await assertFails(
        getDocs(
          query(
            collection(db, "tenants", "pro_user", "projects"),
            where("ownerUid", "==", "pro_user")
          )
        )
      );
      await assertFails(
        updateDoc(doc(db, "tenants", "pro_user", "projects", "proj_existing"), {
          name: "اختراق",
          updatedAt: serverTimestamp(),
        })
      );
      await assertFails(deleteDoc(doc(db, "tenants", "pro_user", "projects", "proj_existing")));
    });

    // 4. مستخدم انتهت تجربته (trialing و pending_payment)
    await runCase("قفل المشاريع للمستخدم المنتهية تجربته (بما فيها pending_payment) مع السماح بطلب كليك", async () => {
      for (const [uid, email] of [
        ["trial_expired", "trial_expired@workshop.jo"],
        ["pending_expired", "pending_expired@workshop.jo"],
      ] as const) {
        const ctx = testEnv.authenticatedContext(uid, { email, email_verified: true });
        const db = asDb(ctx);

        await assertFails(getDoc(doc(db, "tenants", uid, "projects", "proj_existing")));
        await assertFails(
          updateDoc(doc(db, "tenants", uid, "projects", "proj_existing"), {
            name: "بعد الانتهاء",
            updatedAt: serverTimestamp(),
          })
        );
        await assertFails(deleteDoc(doc(db, "tenants", uid, "projects", "proj_existing")));

        // لكن يُسمح له بتقديم طلب تفعيل CliQ بحالة pending
        await assertSucceeds(
          setDoc(doc(db, "activation_requests", `req_new_${uid}`), {
            tenantId: uid,
            ownerUid: uid,
            email,
            workshopName: "ورشة اختبار",
            phone: "0790000001",
            planId: "starter",
            billingCycle: "monthly",
            cliqNote: "تحويل كليك",
            status: "pending",
            reviewedBy: "",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }
    });

    // 5. تجاوز حد المشاريع maxProjects وعداد projectCount الذري
    await runCase("فرض حد maxProjects (25 للتجربة) ومنع إنشاء مشروع بدون زيادة projectCount أو إنقاصه زيفاً", async () => {
      // مستخدم عند الحد الأقصى 25 مشروع
      const fullCtx = testEnv.authenticatedContext("trial_full", {
        email: "trial_full@workshop.jo",
        email_verified: true,
      });
      const fullDb = asDb(fullCtx);

      await assertFails(
        runTransaction(fullDb, async (tx) => {
          const tRef = doc(fullDb, "tenants", "trial_full");
          const pRef = doc(fullDb, "tenants", "trial_full", "projects", "pj_26");
          tx.set(pRef, makeProjectDoc("trial_full", { utypes: [], custom: {} }));
          tx.update(tRef, {
            projectCount: 26,
            lastProjectActionId: "pj_26",
            updatedAt: serverTimestamp(),
          });
        })
      );

      // مستخدم سليم يحاول إنشاء مشروع بدون زيادة العداد ذرياً
      const okCtx = testEnv.authenticatedContext("trial_ok", {
        email: "trial_ok@workshop.jo",
        email_verified: true,
      });
      const okDb = asDb(okCtx);

      await assertFails(
        setDoc(
          doc(okDb, "tenants", "trial_ok", "projects", "pj_no_counter"),
          makeProjectDoc("trial_ok", { utypes: [], custom: {} })
        )
      );

      // إنشاء مشروع ذري سليم ينجح
      await assertSucceeds(
        runTransaction(okDb, async (tx) => {
          const tRef = doc(okDb, "tenants", "trial_ok");
          const pRef = doc(okDb, "tenants", "trial_ok", "projects", "pj_valid_1");
          tx.set(pRef, makeProjectDoc("trial_ok", { utypes: [], custom: {} }));
          tx.update(tRef, {
            projectCount: 1,
            lastProjectActionId: "pj_valid_1",
            updatedAt: serverTimestamp(),
          });
        })
      );

      // محاولة إنقاص projectCount دون حذف مشروع حقيقي تُرفض
      await assertFails(
        updateDoc(doc(okDb, "tenants", "trial_ok"), {
          projectCount: 0,
          lastProjectActionId: "fake_id",
          updatedAt: serverTimestamp(),
        })
      );
    });

    // 6. إصلاح تجاوز حدود الأنواع المخصصة (utypes) — رفض كل البنى غير الصالحة وتجاوز الحد
    await runCase("رفض utypes كـ string أو map أو null أو قائمة أكبر من الحد والسماح بالحالات الصالحة", async () => {
      const starterDb = asDb(
        testEnv.authenticatedContext("starter_user", {
          email: "starter@workshop.jo",
          email_verified: true,
        })
      );
      const proDb = asDb(
        testEnv.authenticatedContext("pro_user", {
          email: "pro@workshop.jo",
          email_verified: true,
        })
      );
      const bizDb = asDb(
        testEnv.authenticatedContext("biz_user", {
          email: "biz@workshop.jo",
          email_verified: true,
        })
      );
      const bizPlusDb = asDb(
        testEnv.authenticatedContext("biz_plus_user", {
          email: "biz_plus@workshop.jo",
          email_verified: true,
        })
      );

      const updateSnap = (db: Firestore, uid: string, snapshot: Record<string, unknown>) =>
        updateDoc(doc(db, "tenants", uid, "projects", "proj_existing"), {
          snapshot,
          updatedAt: serverTimestamp(),
        });

      // utypes غير موجودة -> تُعامل كقائمة فارغة وتنجح على starter
      await assertSucceeds(updateSnap(starterDb, "starter_user", { custom: {} }));

      // utypes كـ string -> مرفوضة على starter و business
      await assertFails(updateSnap(starterDb, "starter_user", { utypes: "bypass" }));
      await assertFails(updateSnap(bizDb, "biz_user", { utypes: "bypass" }));

      // utypes كـ map -> مرفوضة
      await assertFails(
        updateSnap(starterDb, "starter_user", { utypes: { "0": { name: "نوع" } } })
      );

      // utypes كـ null -> مرفوضة
      await assertFails(updateSnap(starterDb, "starter_user", { utypes: null }));

      // عنصر غير صالح داخل utypes -> مرفوض
      await assertFails(updateSnap(proDb, "pro_user", { utypes: [123] }));
      await assertFails(updateSnap(proDb, "pro_user", { utypes: [{ name: "" }] }));

      // starter (حد 0) يرفض نوعاً واحداً
      await assertFails(updateSnap(starterDb, "starter_user", { utypes: makeUtypes(1) }));

      // pro (حد 2 حتى لو وُجد extraCustomTypesQuota) يقبل 2 ويرفض 3
      await assertSucceeds(updateSnap(proDb, "pro_user", { utypes: makeUtypes(2) }));
      await assertFails(updateSnap(proDb, "pro_user", { utypes: makeUtypes(3) }));

      // business (حد 5 بدون حزمة إضافية) يقبل 5 ويرفض 6
      await assertSucceeds(updateSnap(bizDb, "biz_user", { utypes: makeUtypes(5) }));
      await assertFails(updateSnap(bizDb, "biz_user", { utypes: makeUtypes(6) }));

      // business مع حزمة +5 (المجموع 10) يقبل 10 ويرفض 11
      await assertSucceeds(updateSnap(bizPlusDb, "biz_plus_user", { utypes: makeUtypes(10) }));
      await assertFails(updateSnap(bizPlusDb, "biz_plus_user", { utypes: makeUtypes(11) }));
    });

    // 7. إصلاح تجاوز حدود العلاقات المخصصة (custom) — رفض البنى غير الصالحة والعلاقات فوق الحد
    await runCase("رفض custom غير الخريطة والقوائم غير الصالحة والمفاتيح المهربة والعلاقات فوق الحد", async () => {
      const starterDb = asDb(
        testEnv.authenticatedContext("starter_user", {
          email: "starter@workshop.jo",
          email_verified: true,
        })
      );
      const proDb = asDb(
        testEnv.authenticatedContext("pro_user", {
          email: "pro@workshop.jo",
          email_verified: true,
        })
      );
      const bizDb = asDb(
        testEnv.authenticatedContext("biz_user", {
          email: "biz@workshop.jo",
          email_verified: true,
        })
      );

      const updateSnap = (db: Firestore, uid: string, snapshot: Record<string, unknown>) =>
        updateDoc(doc(db, "tenants", uid, "projects", "proj_existing"), {
          snapshot,
          updatedAt: serverTimestamp(),
        });

      // custom ليست map (string / list / null) -> مرفوضة على starter وحتى على business (maxFields == -1)!
      for (const badCustom of ["not-a-map", ["bad"], null, 42]) {
        await assertFails(updateSnap(starterDb, "starter_user", { custom: badCustom }));
        await assertFails(updateSnap(bizDb, "biz_user", { custom: badCustom }));
      }

      // custom[key] ليست list -> مرفوضة على starter و business
      await assertFails(
        updateSnap(starterDb, "starter_user", {
          custom: { [BUILTIN_TYPE]: "not-a-list" },
        })
      );
      await assertFails(
        updateSnap(bizDb, "biz_user", {
          custom: { [BUILTIN_TYPE]: { count: 99 } },
        })
      );

      // مفتاح مجهول مهرب داخل custom -> مرفوض
      await assertFails(
        updateSnap(starterDb, "starter_user", {
          custom: { "مفتاح_مجهول_مهرب": makeFields(1) },
        })
      );

      // starter (حد 2): يقبل 2 ويرفض 3
      await assertSucceeds(
        updateSnap(starterDb, "starter_user", {
          custom: { [BUILTIN_TYPE]: makeFields(2) },
        })
      );
      await assertFails(
        updateSnap(starterDb, "starter_user", {
          custom: { [BUILTIN_TYPE]: makeFields(3) },
        })
      );

      // pro (حد 5): يقبل 5 ويرفض 6
      await assertSucceeds(
        updateSnap(proDb, "pro_user", {
          utypes: makeUtypes(2),
          custom: {
            [BUILTIN_TYPE]: makeFields(5),
            "نوع_مخصص_1": makeFields(5),
          },
        })
      );
      await assertFails(
        updateSnap(proDb, "pro_user", {
          custom: { [BUILTIN_TYPE]: makeFields(6) },
        })
      );

      // business (مفتوح مع بنية map/list سليمة): يقبل 12 علاقة
      await assertSucceeds(
        updateSnap(bizDb, "biz_user", {
          utypes: makeUtypes(5),
          custom: { [BUILTIN_TYPE]: makeFields(12) },
        })
      );
    });

    // 8. مستخدم عادي يحاول تعديل plans أو config
    await runCase("رفض تعديل المستخدم العادي لمجموعات plans أو config/platform", async () => {
      const userDb = asDb(
        testEnv.authenticatedContext("starter_user", {
          email: "starter@workshop.jo",
          email_verified: true,
        })
      );

      await assertFails(
        updateDoc(doc(userDb, "plans", "starter"), {
          maxProjects: -1,
          updatedAt: serverTimestamp(),
        })
      );
      await assertFails(deleteDoc(doc(userDb, "plans", "starter")));
      await assertFails(
        updateDoc(doc(userDb, "config", "platform"), {
          whatsappPhone: "0799999999",
          updatedBy: "starter_user",
          updatedAt: serverTimestamp(),
        })
      );
    });

    // 9. حماية audit_logs وذرية adminSavePlan و adminSavePlatformConfig وتثبيت trialDaysDefault == 7
    await runCase("حماية audit_logs وتثبيت trialDaysDefault == 7 ونجاح معاملات المدير الذرية", async () => {
      const userDb = asDb(
        testEnv.authenticatedContext("starter_user", {
          email: "starter@workshop.jo",
          email_verified: true,
        })
      );
      const adminDb = asDb(
        testEnv.authenticatedContext(OWNER_UID, {
          email: OWNER_EMAIL,
          email_verified: true,
        })
      );

      // المستخدم العادي ممنوع من قراءة أو كتابة audit_logs
      await assertFails(getDoc(doc(userDb, "audit_logs", "log_seed_1")));
      await assertFails(
        setDoc(doc(userDb, "audit_logs", "log_user_fake"), {
          actorUid: "starter_user",
          actorEmail: "starter@workshop.jo",
          action: "fake",
          targetTenantId: "starter_user",
          details: "fake",
          createdAt: serverTimestamp(),
        })
      );

      // حتى المدير ممنوع من تعديل أو حذف audit_logs
      await assertFails(
        updateDoc(doc(adminDb, "audit_logs", "log_seed_1"), { details: "معدل" })
      );
      await assertFails(deleteDoc(doc(adminDb, "audit_logs", "log_seed_1")));

      // المدير ممنوع من تغيير trialDaysDefault إلى أي قيمة غير 7
      await assertFails(
        updateDoc(doc(adminDb, "config", "platform"), {
          trialDaysDefault: 14,
          updatedBy: OWNER_UID,
          updatedAt: serverTimestamp(),
        })
      );

      // معاملة ذرية للمدير: تحديث config/platform (مع trialDaysDefault == 7) + كتابة audit_logs معاً
      await assertSucceeds(
        runTransaction(adminDb, async (tx) => {
          const cfgRef = doc(adminDb, "config", "platform");
          await tx.get(cfgRef);
          tx.set(cfgRef, {
            whatsappPhone: "0798904182",
            cliqAlias: "NEWALIAS",
            cliqBankName: "بنك محدث",
            cliqHolderName: "مالك المنصة",
            trialDaysDefault: 7,
            supportNote: "ملاحظة محدثة",
            updatedBy: OWNER_UID,
            updatedAt: serverTimestamp(),
          });
          tx.set(doc(adminDb, "audit_logs", "log_cfg_atomic"), {
            actorUid: OWNER_UID,
            actorEmail: OWNER_EMAIL,
            action: "update_platform_config",
            targetTenantId: "platform",
            details: "تحديث ذري للإعدادات",
            beforeState: "{}",
            afterState: "{}",
            createdAt: serverTimestamp(),
          });
        })
      );

      // معاملة ذرية للمدير: تحديث plans/starter + كتابة audit_logs معاً
      await assertSucceeds(
        runTransaction(adminDb, async (tx) => {
          const planRef = doc(adminDb, "plans", "starter");
          await tx.get(planRef);
          tx.set(planRef, {
            ...makePlanDoc("starter", {
              name: "الباقة الأساسية المحدثة",
              maxProjects: 30,
              maxCustomTypes: 0,
              maxCustomFieldsPerType: 2,
              allowExtraTypesAddon: false,
              sortOrder: 1,
            }),
            updatedAt: serverTimestamp(),
          });
          tx.set(doc(adminDb, "audit_logs", "log_plan_atomic"), {
            actorUid: OWNER_UID,
            actorEmail: OWNER_EMAIL,
            action: "save_plan",
            targetTenantId: "starter",
            details: "تحديث ذري للباقة",
            beforeState: "{}",
            afterState: "{}",
            createdAt: serverTimestamp(),
          });
        })
      );
    });

    // 10. اعتماد طلب CliQ لمرة واحدة فقط ومنع الموافقة المزدوجة
    await runCase("اعتماد طلب كليك لمرة واحدة فقط داخل معاملة ذرية ورفض الاعتماد المزدوج", async () => {
      const adminDb = asDb(
        testEnv.authenticatedContext(OWNER_UID, {
          email: OWNER_EMAIL,
          email_verified: true,
        })
      );
      const reqRef = doc(adminDb, "activation_requests", "req_pending_1");
      const tenantRef = doc(adminDb, "tenants", "trial_expired");

      // الموافقة الأولى تنجح
      await assertSucceeds(
        runTransaction(adminDb, async (tx) => {
          const rSnap = await tx.get(reqRef);
          if (!rSnap.exists()) throw new Error("missing req");
          tx.update(reqRef, {
            status: "approved",
            reviewedBy: OWNER_UID,
            updatedAt: serverTimestamp(),
          });
          tx.update(tenantRef, {
            subscriptionStatus: "active",
            planId: "pro",
            activeUntil: Timestamp.fromMillis(Date.now() + 30 * DAY_MS),
            extraCustomTypesQuota: 0,
            adminNote: "تأكيد كليك",
            updatedAt: serverTimestamp(),
          });
          tx.set(doc(adminDb, "audit_logs", "log_approve_1"), {
            actorUid: OWNER_UID,
            actorEmail: OWNER_EMAIL,
            action: "approve_payment_request",
            targetTenantId: "trial_expired",
            details: "تأكيد دفع",
            beforeState: "{}",
            afterState: "{}",
            createdAt: serverTimestamp(),
          });
        })
      );

      // المحاولة الثانية على نفس الطلب (سواء موافقة أو رفض) تُرفض من قواعد Firestore
      await assertFails(
        updateDoc(reqRef, {
          status: "approved",
          reviewedBy: OWNER_UID,
          updatedAt: serverTimestamp(),
        })
      );
      await assertFails(
        updateDoc(reqRef, {
          status: "rejected",
          reviewedBy: OWNER_UID,
          updatedAt: serverTimestamp(),
        })
      );
    });

    // 11. رفض المالك غير الموثق والمجموعات المعطلة في خطة Spark
    await runCase("رفض بريد المالك غير الموثق وإغلاق المجموعات المعطلة (admins / config_private / expiry_alerts)", async () => {
      const unverifiedAdminDb = asDb(
        testEnv.authenticatedContext(OWNER_UID, {
          email: OWNER_EMAIL,
          email_verified: false,
        })
      );
      const adminDb = asDb(
        testEnv.authenticatedContext(OWNER_UID, {
          email: OWNER_EMAIL,
          email_verified: true,
        })
      );

      await assertFails(getDocs(collection(unverifiedAdminDb, "tenants")));
      await assertFails(setDoc(doc(adminDb, "admins", "other_uid"), { email: "x@y.com" }));
      await assertFails(setDoc(doc(adminDb, "config_private", "secrets"), { token: "x" }));
      await assertFails(setDoc(doc(adminDb, "expiry_alerts", "a1"), { uid: "u1" }));
    });

    console.log(`\nاكتملت جميع اختبارات محاكي Firestore بنجاح (${passed}/${passed}).`);
  } finally {
    await testEnv.cleanup();
  }
}

main().catch((err) => {
  console.error("فشل تشغيل اختبارات محاكي Firestore:", err);
  process.exit(1);
});
