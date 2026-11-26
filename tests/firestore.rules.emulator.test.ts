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
  deleteField,
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
    await setDoc(
      doc(db, "tenants", "biz_legacy_high_quota"),
      makeSeedTenant("biz_legacy_high_quota", "biz_legacy@workshop.jo", {
        subscriptionStatus: "active",
        planId: "business",
        activeUntil: future30d,
        extraCustomTypesQuota: 20, // محاكاة حساب قديم بحصة مرتفعة للتحقق من سقف الـ 10 أنواع
        projectCount: 1,
      })
    );
    await setDoc(
      doc(db, "tenants", "biz_expired_active"),
      makeSeedTenant("biz_expired_active", "biz_expired@workshop.jo", {
        subscriptionStatus: "active",
        planId: "business",
        activeUntil: past8d, // اشتراك منتهي الصلاحية فعلياً رغم بقاء النص active
        extraCustomTypesQuota: 0,
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
      "biz_legacy_high_quota",
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

    // 6. إصلاح تجاوز حدود الأنواع المخصصة (سقف 10 أنواع وفحص جميع العناصر 0..9)
    await runCase("سقف 10 أنواع مخصصة: 10 صالحة قبول، 11 رفض، النوع العاشر غير صالح رفض، وبدون name رفض", async () => {
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
      const bizLegacyHighDb = asDb(
        testEnv.authenticatedContext("biz_legacy_high_quota", {
          email: "biz_legacy@workshop.jo",
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

      // utypes كـ string / map / null -> مرفوضة دائماً (بما فيها باقة Business)
      await assertFails(updateSnap(starterDb, "starter_user", { utypes: "bypass" }));
      await assertFails(updateSnap(bizDb, "biz_user", { utypes: "bypass" }));
      await assertFails(
        updateSnap(starterDb, "starter_user", { utypes: { "0": { name: "نوع" } } })
      );
      await assertFails(updateSnap(starterDb, "starter_user", { utypes: null }));

      // نوع إضافي لا يملك name -> رفض
      await assertFails(updateSnap(proDb, "pro_user", { utypes: [{ title: "بدون اسم" }] }));
      await assertFails(updateSnap(bizDb, "biz_user", { utypes: [{}] }));

      // اسم فارغ أو مسافات فقط أو عنصر ليس map -> رفض
      await assertFails(updateSnap(proDb, "pro_user", { utypes: [123] }));
      await assertFails(updateSnap(proDb, "pro_user", { utypes: [{ name: "" }] }));
      await assertFails(updateSnap(proDb, "pro_user", { utypes: [{ name: "   " }] }));

      // starter (حد 0) يرفض نوعاً واحداً
      await assertFails(updateSnap(starterDb, "starter_user", { utypes: makeUtypes(1) }));

      // pro (حد 2 حتى لو وُجد extraCustomTypesQuota) يقبل 2 ويرفض 3
      await assertSucceeds(updateSnap(proDb, "pro_user", { utypes: makeUtypes(2) }));
      await assertFails(updateSnap(proDb, "pro_user", { utypes: makeUtypes(3) }));

      // business (حد 5 بدون حزمة إضافية) يقبل 5 ويرفض 6
      await assertSucceeds(updateSnap(bizDb, "biz_user", { utypes: makeUtypes(5) }));
      await assertFails(updateSnap(bizDb, "biz_user", { utypes: makeUtypes(6) }));

      // 10 أنواع صالحة على business مع حزمة +5: قبول
      await assertSucceeds(updateSnap(bizPlusDb, "biz_plus_user", { utypes: makeUtypes(10) }));

      // 11 نوعاً: رفض على biz_plus_user وحتى على biz_legacy_high_quota (حصة قديمة 20)
      await assertFails(updateSnap(bizPlusDb, "biz_plus_user", { utypes: makeUtypes(11) }));
      await assertFails(
        updateSnap(bizLegacyHighDb, "biz_legacy_high_quota", { utypes: makeUtypes(11) })
      );

      // النوع العاشر (الفهرس 9) ببنية غير صالحة أو بدون name: رفض
      await assertFails(
        updateSnap(bizPlusDb, "biz_plus_user", {
          utypes: [...makeUtypes(9), "invalid_10th_item"],
        })
      );
      await assertFails(
        updateSnap(bizPlusDb, "biz_plus_user", {
          utypes: [...makeUtypes(9), { label: "بدون حقل name" }],
        })
      );
      await assertFails(
        updateSnap(bizPlusDb, "biz_plus_user", {
          utypes: [...makeUtypes(9), { name: "   " }],
        })
      );
    });

    // 7. إصلاح customFieldsWithinLimit ومحاولة تجاوز الحماية باستخدام باقة Business
    await runCase("رفض مفاتيح custom غير المعروفة والقيم غير list (string/map) وتجاوز العلاقات ومحاولات تجاوز Business", async () => {
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

      // custom ليست map (string / list / null / int) -> رفض حتى على باقة Business
      for (const badCustom of ["not-a-map", ["bad"], null, 42]) {
        await assertFails(updateSnap(starterDb, "starter_user", { custom: badCustom }));
        await assertFails(updateSnap(bizDb, "biz_user", { custom: badCustom }));
      }

      // مفتاح custom بقيمة string -> رفض (على starter و pro و business)
      await assertFails(
        updateSnap(starterDb, "starter_user", {
          custom: { [BUILTIN_TYPE]: "not-a-list" },
        })
      );
      await assertFails(
        updateSnap(bizDb, "biz_user", {
          custom: { [BUILTIN_TYPE]: "string-bypass-on-business" },
        })
      );

      // مفتاح custom بقيمة map -> رفض (على starter و pro و business)
      await assertFails(
        updateSnap(proDb, "pro_user", {
          custom: { [BUILTIN_TYPE]: { count: 99 } },
        })
      );
      await assertFails(
        updateSnap(bizDb, "biz_user", {
          custom: { [BUILTIN_TYPE]: { hacked: true } },
        })
      );

      // مفتاح custom غير معروف -> رفض على starter و pro وحتى على business مع 10 أنواع
      await assertFails(
        updateSnap(starterDb, "starter_user", {
          custom: { "مفتاح_غير_معروف": makeFields(1) },
        })
      );
      await assertFails(
        updateSnap(bizPlusDb, "biz_plus_user", {
          utypes: makeUtypes(10),
          custom: { "مفتاح_مجهول_على_بزنس": makeFields(1) },
        })
      );

      // تجاوز عدد العلاقات المسموح: starter (حد 2) يقبل 2 ويرفض 3
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

      // تجاوز عدد العلاقات المسموح: pro (حد 5) يقبل 5 ويرفض 6 على الأساسي والمخصص
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
      await assertFails(
        updateSnap(proDb, "pro_user", {
          utypes: makeUtypes(2),
          custom: { "نوع_مخصص_1": makeFields(6) },
        })
      );

      // باقة Business صالحة: 10 أنواع صالحة + علاقات على النوع العاشر والأساسي -> قبول
      await assertSucceeds(
        updateSnap(bizPlusDb, "biz_plus_user", {
          utypes: makeUtypes(10),
          custom: {
            [BUILTIN_TYPE]: makeFields(12),
            "نوع_مخصص_10": makeFields(8),
          },
        })
      );

      // محاولة تجاوز الحماية على Business بوضع قيمة غير list داخل النوع العاشر -> رفض
      await assertFails(
        updateSnap(bizPlusDb, "biz_plus_user", {
          utypes: makeUtypes(10),
          custom: {
            "نوع_مخصص_10": "not-a-list",
          },
        })
      );
    });

    // 7ب. مراجعة سقف extraCustomTypesQuota (لا يتجاوز المجموع 10 أبداً)
    await runCase("منع منح أو طلب حصة extraCustomTypesQuota تجعل إجمالي الأنواع المخصصة يتجاوز 10", async () => {
      const adminDb = asDb(
        testEnv.authenticatedContext(OWNER_UID, {
          email: OWNER_EMAIL,
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

      // Business (base=5, extra=0) يطلب +5 (المجموع 10) -> قبول
      await assertSucceeds(
        setDoc(doc(bizDb, "activation_requests", "req_addon_ok"), {
          tenantId: "biz_user",
          ownerUid: "biz_user",
          email: "biz@workshop.jo",
          workshopName: "ورشة اختبار",
          phone: "0790000001",
          planId: "business",
          billingCycle: "monthly",
          cliqNote: "حزمة إضافية",
          status: "pending",
          reviewedBy: "",
          requestType: "extra_types_addon",
          extraTypesCount: 5,
          addonPriceJod: 10,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      // Business Plus (base=5, extra=5 = 10 بالفعل) يطلب +5 إضافية (المجموع 15 > 10) -> رفض
      await assertFails(
        setDoc(doc(bizPlusDb, "activation_requests", "req_addon_over10"), {
          tenantId: "biz_plus_user",
          ownerUid: "biz_plus_user",
          email: "biz_plus@workshop.jo",
          workshopName: "ورشة اختبار",
          phone: "0790000001",
          planId: "business",
          billingCycle: "monthly",
          cliqNote: "محاولة تجاوز 10",
          status: "pending",
          reviewedBy: "",
          requestType: "extra_types_addon",
          extraTypesCount: 5,
          addonPriceJod: 10,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      // المدير يمنح biz_user (base=5, extra=0 -> 5) المجموع 10 -> قبول
      await assertSucceeds(
        updateDoc(doc(adminDb, "tenants", "biz_user"), {
          extraCustomTypesQuota: 5,
          updatedAt: serverTimestamp(),
        })
      );

      // المدير يحاول منح biz_plus_user (base=5, extra=5 -> 10) المجموع 15 > 10 -> رفض
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "biz_plus_user"), {
          extraCustomTypesQuota: 10,
          updatedAt: serverTimestamp(),
        })
      );

      // المدير يحاول منح pro_user (لا تسمح بحزمة إضافية) حصة إضافية -> رفض
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "pro_user"), {
          extraCustomTypesQuota: 3,
          updatedAt: serverTimestamp(),
        })
      );

      // مشترك Business منتهي الصلاحية فعلياً (activeUntil في الماضي) يحاول طلب حزمة إضافية -> رفض
      const bizExpiredDb = asDb(
        testEnv.authenticatedContext("biz_expired_active", {
          email: "biz_expired@workshop.jo",
          email_verified: true,
        })
      );
      await assertFails(
        setDoc(doc(bizExpiredDb, "activation_requests", "req_addon_expired"), {
          tenantId: "biz_expired_active",
          ownerUid: "biz_expired_active",
          email: "biz_expired@workshop.jo",
          workshopName: "ورشة اختبار",
          phone: "0790000001",
          planId: "business",
          billingCycle: "monthly",
          cliqNote: "محاولة بعد الانتهاء",
          status: "pending",
          reviewedBy: "",
          requestType: "extra_types_addon",
          extraTypesCount: 5,
          addonPriceJod: 10,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
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
            activatedAt: serverTimestamp(),
            subscriptionDays: 30,
            activeUntil: null,
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

    // 12. تفعيل جديد بتوقيت الخادم ورفض أي activatedAt من العميل أو subscriptionDays غير مدعومة
    await runCase("توقيت الاشتراكات الخادمي: قبول serverTimestamp + [30,90,365] ورفض أي توقيت عميل أو مدة غير مدعومة", async () => {
      const adminDb = asDb(
        testEnv.authenticatedContext(OWNER_UID, {
          email: OWNER_EMAIL,
          email_verified: true,
        })
      );
      const tenantRef = doc(adminDb, "tenants", "trial_expired");
      const nowMs = Date.now();

      // 1) رفض إرسال activatedAt بقيمة Timestamp عشوائية من العميل (حتى لو قريبة من الآن)
      await assertFails(
        updateDoc(tenantRef, {
          subscriptionStatus: "active",
          planId: "starter",
          activatedAt: Timestamp.fromMillis(nowMs),
          subscriptionDays: 30,
          activeUntil: null,
          extraCustomTypesQuota: 0,
          adminNote: "توقيت عميل عشوائي",
          updatedAt: serverTimestamp(),
        })
      );

      // 2) رفض إرسال activatedAt بتاريخ مستقبلي (+10 أيام)
      await assertFails(
        updateDoc(tenantRef, {
          subscriptionStatus: "active",
          planId: "starter",
          activatedAt: Timestamp.fromMillis(nowMs + 10 * DAY_MS),
          subscriptionDays: 30,
          activeUntil: null,
          extraCustomTypesQuota: 0,
          adminNote: "تاريخ مستقبلي",
          updatedAt: serverTimestamp(),
        })
      );

      // 3) رفض إرسال activatedAt بتاريخ قديم (-5 أيام)
      await assertFails(
        updateDoc(tenantRef, {
          subscriptionStatus: "active",
          planId: "starter",
          activatedAt: Timestamp.fromMillis(nowMs - 5 * DAY_MS),
          subscriptionDays: 30,
          activeUntil: null,
          extraCustomTypesQuota: 0,
          adminNote: "تاريخ قديم",
          updatedAt: serverTimestamp(),
        })
      );

      // 4) رفض أي subscriptionDays غير مدعومة (15، 60، 1000، 0، -1، نص، كسر، null)
      for (const badDays of [15, 60, 1000, 0, -1, 30.5, "30", null]) {
        await assertFails(
          updateDoc(tenantRef, {
            subscriptionStatus: "active",
            planId: "starter",
            activatedAt: serverTimestamp(),
            subscriptionDays: badDays as unknown as number,
            activeUntil: null,
            extraCustomTypesQuota: 0,
            adminNote: "مدة غير صالحة",
            updatedAt: serverTimestamp(),
          })
        );
      }

      // 5) رفض تمرير activeUntil غير null مع التفعيل الجديد
      await assertFails(
        updateDoc(tenantRef, {
          subscriptionStatus: "active",
          planId: "starter",
          activatedAt: serverTimestamp(),
          subscriptionDays: 30,
          activeUntil: Timestamp.fromMillis(nowMs + 365 * DAY_MS),
          extraCustomTypesQuota: 0,
          adminNote: "محاولة تمرير activeUntil",
          updatedAt: serverTimestamp(),
        })
      );

      // 6) رفض تحويل الحالة إلى active بدون activatedAt == request.time
      await assertFails(
        updateDoc(tenantRef, {
          subscriptionStatus: "active",
          adminNote: "تفعيل بدون وقت خادم",
          updatedAt: serverTimestamp(),
        })
      );

      // 7) تفعيل جديد صالح (serverTimestamp + 30 يوم + activeUntil: null) ينجح
      await assertSucceeds(
        updateDoc(tenantRef, {
          subscriptionStatus: "active",
          planId: "pro",
          activatedAt: serverTimestamp(),
          subscriptionDays: 30,
          activeUntil: null,
          extraCustomTypesQuota: 0,
          adminNote: "تفعيل 30 يوم",
          updatedAt: serverTimestamp(),
        })
      );

      // التحقق أن الحساب المفعّل يستطيع قراءة وتعديل مشاريعه فوراً
      const userDb = asDb(
        testEnv.authenticatedContext("trial_expired", {
          email: "trial_expired@workshop.jo",
          email_verified: true,
        })
      );
      await assertSucceeds(getDoc(doc(userDb, "tenants", "trial_expired", "projects", "proj_existing")));

      // 8) تجديد صالح من المدير إلى 90 يوماً ثم 365 يوماً ينجح
      await assertSucceeds(
        updateDoc(tenantRef, {
          subscriptionStatus: "active",
          planId: "business",
          activatedAt: serverTimestamp(),
          subscriptionDays: 90,
          activeUntil: null,
          extraCustomTypesQuota: 0,
          adminNote: "تجديد 90 يوم",
          updatedAt: serverTimestamp(),
        })
      );
      await assertSucceeds(
        updateDoc(tenantRef, {
          subscriptionStatus: "active",
          planId: "business",
          activatedAt: serverTimestamp(),
          subscriptionDays: 365,
          activeUntil: null,
          extraCustomTypesQuota: 0,
          adminNote: "تجديد سنوي",
          updatedAt: serverTimestamp(),
        })
      );
    });

    // 13. منع العميل من تمديد اشتراكه أو تعديل activatedAt أو subscriptionDays أو activeUntil
    await runCase("منع العميل من تعديل activatedAt أو subscriptionDays أو activeUntil أو تمديد اشتراكه", async () => {
      const adminDb = asDb(
        testEnv.authenticatedContext(OWNER_UID, {
          email: OWNER_EMAIL,
          email_verified: true,
        })
      );
      // تفعيل حساب starter بتوقيت الخادم أولاً
      await assertSucceeds(
        updateDoc(doc(adminDb, "tenants", "trial_ok"), {
          subscriptionStatus: "active",
          planId: "starter",
          activatedAt: serverTimestamp(),
          subscriptionDays: 30,
          activeUntil: null,
          extraCustomTypesQuota: 0,
          adminNote: "تفعيل",
          updatedAt: serverTimestamp(),
        })
      );

      const userDb = asDb(
        testEnv.authenticatedContext("trial_ok", {
          email: "trial_ok@workshop.jo",
          email_verified: true,
        })
      );
      const ownRef = doc(userDb, "tenants", "trial_ok");

      // العميل يحاول تعديل subscriptionDays من 30 إلى 365 -> رفض
      await assertFails(
        updateDoc(ownRef, {
          subscriptionDays: 365,
          updatedAt: serverTimestamp(),
        })
      );

      // العميل يحاول تعديل activatedAt (سواء serverTimestamp أو تاريخ مستقبلي) -> رفض
      await assertFails(
        updateDoc(ownRef, {
          activatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      await assertFails(
        updateDoc(ownRef, {
          activatedAt: Timestamp.fromMillis(Date.now() + 90 * DAY_MS),
          updatedAt: serverTimestamp(),
        })
      );

      // العميل يحاول كتابة activeUntil مستقبلي -> رفض
      await assertFails(
        updateDoc(ownRef, {
          activeUntil: Timestamp.fromMillis(Date.now() + 365 * DAY_MS),
          updatedAt: serverTimestamp(),
        })
      );

      // العميل يحاول تعديل ملفه الشخصي (workshopName) بشكل طبيعي -> قبول
      await assertSucceeds(
        updateDoc(ownRef, {
          workshopName: "ورشة محدثة",
          updatedAt: serverTimestamp(),
        })
      );
    });

    // 14. انتهاء الاشتراك عند تجاوز activatedAt + subscriptionDays وحدود التوقيت ومنع extra_types_addon بعد الانتهاء
    await runCase("انتهاء الاشتراك الخادمي بدقة بعد activatedAt + subscriptionDays ومنع المشاريع وحزم الأنواع الإضافية", async () => {
      const nowMs = Date.now();
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = asDb(ctx);
        // حساب قبل الانتهاء بقليل (مفعّل قبل 30 يوماً إلا 10 دقائق) -> ما زال فعّالاً
        await setDoc(
          doc(db, "tenants", "srv_almost_exp"),
          makeSeedTenant("srv_almost_exp", "srv_almost@workshop.jo", {
            subscriptionStatus: "active",
            planId: "business",
            activatedAt: Timestamp.fromMillis(nowMs - 30 * DAY_MS + 10 * 60 * 1000),
            subscriptionDays: 30,
            activeUntil: null,
            projectCount: 1,
          })
        );
        await setDoc(
          doc(db, "tenants", "srv_almost_exp", "projects", "p1"),
          makeProjectDoc("srv_almost_exp", { utypes: [], custom: {} }, Timestamp.now())
        );

        // حساب بعد الانتهاء مباشرة (مفعّل قبل 30 يوماً و 10 دقائق) -> منتهي ومقفل
        await setDoc(
          doc(db, "tenants", "srv_expired"),
          makeSeedTenant("srv_expired", "srv_expired@workshop.jo", {
            subscriptionStatus: "active",
            planId: "business",
            activatedAt: Timestamp.fromMillis(nowMs - 30 * DAY_MS - 10 * 60 * 1000),
            subscriptionDays: 30,
            activeUntil: null,
            projectCount: 1,
          })
        );
        await setDoc(
          doc(db, "tenants", "srv_expired", "projects", "p1"),
          makeProjectDoc("srv_expired", { utypes: [], custom: {} }, Timestamp.now())
        );
      });

      const almostDb = asDb(
        testEnv.authenticatedContext("srv_almost_exp", {
          email: "srv_almost@workshop.jo",
          email_verified: true,
        })
      );
      await assertSucceeds(getDoc(doc(almostDb, "tenants", "srv_almost_exp", "projects", "p1")));
      await assertSucceeds(
        updateDoc(doc(almostDb, "tenants", "srv_almost_exp", "projects", "p1"), {
          name: "مشروع قبل الانتهاء",
          updatedAt: serverTimestamp(),
        })
      );

      const expiredDb = asDb(
        testEnv.authenticatedContext("srv_expired", {
          email: "srv_expired@workshop.jo",
          email_verified: true,
        })
      );
      // قراءة وتعديل وحذف المشاريع مرفوضة فور تجاوز activatedAt + 30d
      await assertFails(getDoc(doc(expiredDb, "tenants", "srv_expired", "projects", "p1")));
      await assertFails(
        updateDoc(doc(expiredDb, "tenants", "srv_expired", "projects", "p1"), {
          name: "بعد الانتهاء",
          updatedAt: serverTimestamp(),
        })
      );
      await assertFails(deleteDoc(doc(expiredDb, "tenants", "srv_expired", "projects", "p1")));

      // طلب حزمة extra_types_addon للحساب الخادمي المنتهي -> مرفوض
      await assertFails(
        setDoc(doc(expiredDb, "activation_requests", "req_addon_srv_expired"), {
          tenantId: "srv_expired",
          ownerUid: "srv_expired",
          email: "srv_expired@workshop.jo",
          workshopName: "ورشة اختبار",
          phone: "0790000001",
          planId: "business",
          billingCycle: "monthly",
          cliqNote: "حزمة بعد انتهاء الاشتراك",
          status: "pending",
          reviewedBy: "",
          requestType: "extra_types_addon",
          extraTypesCount: 5,
          addonPriceJod: 10,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    });

    // 15. التوافق الخلفي للحسابات القديمة (activeUntil) ومنع الحسابات المحدّثة من التجاوز عبر activeUntil
    await runCase("استمرار عمل الحسابات القديمة بـ activeUntil ومنع أي تجاوز عبر activeUntil في الحسابات الجديدة أو المحدّثة", async () => {
      const nowMs = Date.now();
      const adminDb = asDb(
        testEnv.authenticatedContext(OWNER_UID, {
          email: OWNER_EMAIL,
          email_verified: true,
        })
      );

      // الحساب القديم starter_user (يملك activeUntil دون activatedAt/subscriptionDays) يعمل بشكل طبيعي
      const legacyDb = asDb(
        testEnv.authenticatedContext("starter_user", {
          email: "starter@workshop.jo",
          email_verified: true,
        })
      );
      await assertSucceeds(getDoc(doc(legacyDb, "tenants", "starter_user", "projects", "proj_existing")));
      await assertSucceeds(
        updateDoc(doc(legacyDb, "tenants", "starter_user"), {
          workshopName: "ورشة قديمة فعّالة",
          updatedAt: serverTimestamp(),
        })
      );

      // ممنوع حتى على المدير تعديل activeUntil القديم مباشرة دون الانتقال للآلية الخادمية
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "starter_user"), {
          activeUntil: Timestamp.fromMillis(nowMs + 500 * DAY_MS),
          updatedAt: serverTimestamp(),
        })
      );

      // عند تجديد الحساب القديم يتحول نظيفاً للآلية الخادمية (activeUntil: null + activatedAt + subscriptionDays)
      await assertSucceeds(
        updateDoc(doc(adminDb, "tenants", "starter_user"), {
          subscriptionStatus: "active",
          planId: "pro",
          activatedAt: serverTimestamp(),
          subscriptionDays: 30,
          activeUntil: null,
          extraCustomTypesQuota: 0,
          adminNote: "ترحيل تلقائي عند التجديد",
          updatedAt: serverTimestamp(),
        })
      );

      // ممنوع حذف activatedAt أو subscriptionDays للعودة إلى activeUntil القديم
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "starter_user"), {
          activatedAt: deleteField(),
          subscriptionDays: deleteField(),
          activeUntil: Timestamp.fromMillis(nowMs + 365 * DAY_MS),
          updatedAt: serverTimestamp(),
        })
      );

      // حتى لو وُجد مستند متضارب في قاعدة البيانات (activatedAt منتهي + activeUntil مستقبلي): القواعد تتجاهل activeUntil وتقفل الحساب!
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = asDb(ctx);
        await setDoc(
          doc(db, "tenants", "conflict_bypass"),
          makeSeedTenant("conflict_bypass", "conflict@workshop.jo", {
            subscriptionStatus: "active",
            planId: "business",
            activatedAt: Timestamp.fromMillis(nowMs - 40 * DAY_MS),
            subscriptionDays: 30,
            activeUntil: Timestamp.fromMillis(nowMs + 365 * DAY_MS), // حقل قديم مستقبلي يجب تجاهله
            projectCount: 1,
          })
        );
        await setDoc(
          doc(db, "tenants", "conflict_bypass", "projects", "p1"),
          makeProjectDoc("conflict_bypass", { utypes: [], custom: {} }, Timestamp.now())
        );
      });

      const conflictDb = asDb(
        testEnv.authenticatedContext("conflict_bypass", {
          email: "conflict@workshop.jo",
          email_verified: true,
        })
      );
      await assertFails(getDoc(doc(conflictDb, "tenants", "conflict_bypass", "projects", "p1")));
    });

    // 16. استمرار منع suspended وحماية إعادة التفعيل الإداري والتجربة المجانية 7 أيام
    await runCase("قفل الحساب الموقوف (suspended) ومنع إعادة تفعيله إلى active إن كان منتهياً + استمرار التجربة 7 أيام", async () => {
      const nowMs = Date.now();
      const adminDb = asDb(
        testEnv.authenticatedContext(OWNER_UID, {
          email: OWNER_EMAIL,
          email_verified: true,
        })
      );

      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = asDb(ctx);
        // حساب موقوف لديه مدة خادمية متبقية
        await setDoc(
          doc(db, "tenants", "susp_valid"),
          makeSeedTenant("susp_valid", "susp_valid@workshop.jo", {
            subscriptionStatus: "suspended",
            planId: "pro",
            activatedAt: Timestamp.fromMillis(nowMs - 5 * DAY_MS),
            subscriptionDays: 30,
            activeUntil: null,
            projectCount: 1,
          })
        );
        await setDoc(
          doc(db, "tenants", "susp_valid", "projects", "p1"),
          makeProjectDoc("susp_valid", { utypes: [], custom: {} }, Timestamp.now())
        );

        // حساب موقوف انتهت مدته الخادمية
        await setDoc(
          doc(db, "tenants", "susp_expired"),
          makeSeedTenant("susp_expired", "susp_expired@workshop.jo", {
            subscriptionStatus: "suspended",
            planId: "pro",
            activatedAt: Timestamp.fromMillis(nowMs - 40 * DAY_MS),
            subscriptionDays: 30,
            activeUntil: null,
            projectCount: 1,
          })
        );

        // حساب تجربة موقوف
        await setDoc(
          doc(db, "tenants", "susp_trial"),
          makeSeedTenant("susp_trial", "susp_trial@workshop.jo", {
            subscriptionStatus: "suspended",
            planId: "trial",
            trialDays: 7,
            activeUntil: null,
          })
        );
      });

      // الحساب الموقوف ممنوع من الوصول لمشاريعه حتى لو كانت مدته لم تنته
      const suspValidDb = asDb(
        testEnv.authenticatedContext("susp_valid", {
          email: "susp_valid@workshop.jo",
          email_verified: true,
        })
      );
      await assertFails(getDoc(doc(suspValidDb, "tenants", "susp_valid", "projects", "p1")));

      // المدير يستطيع إعادة تفعيل الموقوف الذي ما زالت له مدة متبقية دون المساس بـ activatedAt/subscriptionDays
      await assertSucceeds(
        updateDoc(doc(adminDb, "tenants", "susp_valid"), {
          subscriptionStatus: "active",
          adminNote: "إعادة تفعيل",
          updatedAt: serverTimestamp(),
        })
      );
      await assertSucceeds(getDoc(doc(suspValidDb, "tenants", "susp_valid", "projects", "p1")));

      // المدير ممنوع من إعادة تفعيل حساب موقوف منتهي الصلاحية إلى active بدون تجديد خادمي جديد
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "susp_expired"), {
          subscriptionStatus: "active",
          adminNote: "محاولة إعادة تفعيل منتهي",
          updatedAt: serverTimestamp(),
        })
      );

      // المدير ممنوع من تحويل حساب تجربة موقوف إلى active عبر إعادة التفعيل دون تجديد حقيقي
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "susp_trial"), {
          subscriptionStatus: "active",
          adminNote: "محاولة ترقية تجربة",
          updatedAt: serverTimestamp(),
        })
      );

      // التجربة المجانية 7 أيام ما زالت تعمل كما هي (إنشاء مشروع داخل المدة)
      const trialDb = asDb(
        testEnv.authenticatedContext("trial_ok", {
          email: "trial_ok@workshop.jo",
          email_verified: true,
        })
      );
      await assertSucceeds(
        runTransaction(trialDb, async (tx) => {
          const tRef = doc(trialDb, "tenants", "trial_ok");
          const pRef = doc(trialDb, "tenants", "trial_ok", "projects", "pj_trial_check");
          tx.set(pRef, makeProjectDoc("trial_ok", { utypes: [], custom: {} }));
          tx.update(tRef, {
            projectCount: 1,
            lastProjectActionId: "pj_trial_check",
            updatedAt: serverTimestamp(),
          });
        })
      );
    });

    // 17. إعادة التفعيل الإداري بتوقيت الخادم فقط: حساب مدفوع صالح، قديم activeUntil، ومنع تحويل صالح إلى expired
    await runCase("إعادة التفعيل الإداري (adminReactivateTenant) بتوقيت الخادم فقط ومنع تحويل اشتراك صالح إلى expired", async () => {
      const nowMs = Date.now();
      const adminDb = asDb(
        testEnv.authenticatedContext(OWNER_UID, {
          email: OWNER_EMAIL,
          email_verified: true,
        })
      );

      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = asDb(ctx);
        // 1) حساب مدفوع خادمي موقوف وما زال صالحاً
        await setDoc(
          doc(db, "tenants", "susp_srv_valid"),
          makeSeedTenant("susp_srv_valid", "susp_srv_valid@workshop.jo", {
            subscriptionStatus: "suspended",
            planId: "pro",
            activatedAt: Timestamp.fromMillis(nowMs - 5 * DAY_MS),
            subscriptionDays: 30,
            activeUntil: null,
            projectCount: 1,
          })
        );
        await setDoc(
          doc(db, "tenants", "susp_srv_valid", "projects", "p1"),
          makeProjectDoc("susp_srv_valid", { utypes: [], custom: {} }, Timestamp.now())
        );

        // 2) حساب قديم (activeUntil) موقوف وما زال صالحاً
        await setDoc(
          doc(db, "tenants", "susp_legacy_valid"),
          makeSeedTenant("susp_legacy_valid", "susp_legacy_valid@workshop.jo", {
            subscriptionStatus: "suspended",
            planId: "starter",
            activeUntil: Timestamp.fromMillis(nowMs + 20 * DAY_MS),
            projectCount: 1,
          })
        );
        await setDoc(
          doc(db, "tenants", "susp_legacy_valid", "projects", "p1"),
          makeProjectDoc("susp_legacy_valid", { utypes: [], custom: {} }, Timestamp.now())
        );

        // 3) حساب قديم (activeUntil) موقوف ومنتهي الصلاحية
        await setDoc(
          doc(db, "tenants", "susp_legacy_expired"),
          makeSeedTenant("susp_legacy_expired", "susp_legacy_expired@workshop.jo", {
            subscriptionStatus: "suspended",
            planId: "starter",
            activeUntil: Timestamp.fromMillis(nowMs - 5 * DAY_MS),
            projectCount: 1,
          })
        );

        // 4) حساب تجربة موقوف وما زال ضمن الـ 7 أيام
        await setDoc(
          doc(db, "tenants", "susp_trial_valid"),
          makeSeedTenant("susp_trial_valid", "susp_trial_valid@workshop.jo", {
            subscriptionStatus: "suspended",
            planId: "trial",
            trialDays: 7,
            activeUntil: null,
            createdAt: Timestamp.fromMillis(nowMs - 2 * DAY_MS),
          })
        );

        // 5) حساب تجربة موقوف وانتهت تجربته
        await setDoc(
          doc(db, "tenants", "susp_trial_expired"),
          makeSeedTenant("susp_trial_expired", "susp_trial_expired@workshop.jo", {
            subscriptionStatus: "suspended",
            planId: "trial",
            trialDays: 7,
            activeUntil: null,
            createdAt: Timestamp.fromMillis(nowMs - 15 * DAY_MS),
          })
        );
      });

      // محاكاة خطأ ساعة جهاز متقدمة (+365 يوم): محاولة تحويل اشتراك مدفوع صالح إلى expired -> مرفوضة من القواعد!
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "susp_srv_valid"), {
          subscriptionStatus: "expired",
          adminNote: "خطأ ساعة متقدمة",
          updatedAt: serverTimestamp(),
        })
      );
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "starter_user"), {
          subscriptionStatus: "expired",
          adminNote: "محاولة إنهاء اشتراك قديم صالح",
          updatedAt: serverTimestamp(),
        })
      );

      // إعادة تفعيل الحساب المدفوع الخادمي الصالح إلى active (دون تعديل activatedAt أو subscriptionDays) -> نجاح
      await assertSucceeds(
        updateDoc(doc(adminDb, "tenants", "susp_srv_valid"), {
          subscriptionStatus: "active",
          adminNote: "إعادة تفعيل",
          updatedAt: serverTimestamp(),
        })
      );

      // إعادة تفعيل الحساب القديم الصالح (activeUntil) إلى active -> نجاح
      await assertSucceeds(
        updateDoc(doc(adminDb, "tenants", "susp_legacy_valid"), {
          subscriptionStatus: "active",
          adminNote: "إعادة تفعيل قديم",
          updatedAt: serverTimestamp(),
        })
      );
      const legacyUserDb = asDb(
        testEnv.authenticatedContext("susp_legacy_valid", {
          email: "susp_legacy_valid@workshop.jo",
          email_verified: true,
        })
      );
      await assertSucceeds(getDoc(doc(legacyUserDb, "tenants", "susp_legacy_valid", "projects", "p1")));

      // رفض إعادة تفعيل الحساب القديم المنتهي إلى active
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "susp_legacy_expired"), {
          subscriptionStatus: "active",
          adminNote: "محاولة إعادة تفعيل قديم منتهي",
          updatedAt: serverTimestamp(),
        })
      );

      // إعادة تفعيل حساب تجربة ما زال ضمن الـ 7 أيام إلى trialing -> نجاح، والمنتهي -> رفض
      await assertSucceeds(
        updateDoc(doc(adminDb, "tenants", "susp_trial_valid"), {
          subscriptionStatus: "trialing",
          adminNote: "إعادة تفعيل تجربة صالحة",
          updatedAt: serverTimestamp(),
        })
      );
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "susp_trial_expired"), {
          subscriptionStatus: "trialing",
          adminNote: "محاولة إعادة تفعيل تجربة منتهية",
          updatedAt: serverTimestamp(),
        })
      );
    });

    // 18. رفض طلب الدفع (adminReviewActivationRequest): استعادة الحالة بتوقيت الخادم وعدم المساس بـ activatedAt
    await runCase("رفض طلب الدفع بتوقيت الخادم: حماية المدفوع الصالح والتجربة الصالحة ومنع إعادة المنتهي إلى trialing", async () => {
      const nowMs = Date.now();
      const origActivatedAt = Timestamp.fromMillis(nowMs - 4 * DAY_MS);
      const adminDb = asDb(
        testEnv.authenticatedContext(OWNER_UID, {
          email: OWNER_EMAIL,
          email_verified: true,
        })
      );

      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = asDb(ctx);
        // 1) حساب مدفوع صالح في حالة pending_payment
        await setDoc(
          doc(db, "tenants", "pend_paid_valid"),
          makeSeedTenant("pend_paid_valid", "pend_paid@workshop.jo", {
            subscriptionStatus: "pending_payment",
            planId: "pro",
            activatedAt: origActivatedAt,
            subscriptionDays: 30,
            activeUntil: null,
          })
        );
        // 2) حساب تجربة صالحة في حالة pending_payment
        await setDoc(
          doc(db, "tenants", "pend_trial_valid"),
          makeSeedTenant("pend_trial_valid", "pend_trial_valid@workshop.jo", {
            subscriptionStatus: "pending_payment",
            planId: "trial",
            trialDays: 7,
            activeUntil: null,
            createdAt: Timestamp.fromMillis(nowMs - 2 * DAY_MS),
          })
        );
        // 3) حساب تجربة منتهية في حالة pending_payment (pending_expired موجود مسبقاً)
        // طلبات الدفع المقابلة
        for (const [reqId, uid, email] of [
          ["req_rej_paid", "pend_paid_valid", "pend_paid@workshop.jo"],
          ["req_rej_trial_valid", "pend_trial_valid", "pend_trial_valid@workshop.jo"],
          ["req_rej_trial_exp", "pending_expired", "pending_expired@workshop.jo"],
        ] as const) {
          await setDoc(doc(db, "activation_requests", reqId), {
            tenantId: uid,
            ownerUid: uid,
            email,
            workshopName: "ورشة اختبار",
            phone: "0790000001",
            planId: "pro",
            billingCycle: "monthly",
            cliqNote: "حوالة",
            status: "pending",
            reviewedBy: "",
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
          });
        }
      });

      // أ) حساب مدفوع صالح في pending_payment: ممنوع تحويله إلى expired عند الرفض، وممنوع تعديل activatedAt
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "pend_paid_valid"), {
          subscriptionStatus: "expired",
          adminNote: "رفض خاطئ بسبب ساعة متقدمة",
          updatedAt: serverTimestamp(),
        })
      );
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "pend_paid_valid"), {
          subscriptionStatus: "active",
          activatedAt: Timestamp.fromMillis(nowMs - 10 * DAY_MS),
          adminNote: "محاولة تغيير activatedAt عند الرفض",
          updatedAt: serverTimestamp(),
        })
      );
      // رفض الطلب واستعادة الحساب المدفوع الصالح إلى active دون مساس بـ activatedAt -> نجاح
      await assertSucceeds(
        runTransaction(adminDb, async (tx) => {
          tx.update(doc(adminDb, "activation_requests", "req_rej_paid"), {
            status: "rejected",
            reviewedBy: OWNER_UID,
            updatedAt: serverTimestamp(),
          });
          tx.update(doc(adminDb, "tenants", "pend_paid_valid"), {
            subscriptionStatus: "active",
            adminNote: "تم رفض طلب الدفع",
            updatedAt: serverTimestamp(),
          });
        })
      );
      const afterPaid = await assertSucceeds(getDoc(doc(adminDb, "tenants", "pend_paid_valid")));
      if (afterPaid.data()?.activatedAt?.toMillis() !== origActivatedAt.toMillis()) {
        throw new Error("تغيّر activatedAt بشكل غير مصرح به عند رفض طلب الدفع");
      }

      // ب) حساب تجربة صالحة في pending_payment: ممنوع تحويله إلى expired (ساعة متقدمة)، ويُسمح بإعادته إلى trialing
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "pend_trial_valid"), {
          subscriptionStatus: "expired",
          adminNote: "خطأ ساعة متقدمة",
          updatedAt: serverTimestamp(),
        })
      );
      await assertSucceeds(
        runTransaction(adminDb, async (tx) => {
          tx.update(doc(adminDb, "activation_requests", "req_rej_trial_valid"), {
            status: "rejected",
            reviewedBy: OWNER_UID,
            updatedAt: serverTimestamp(),
          });
          tx.update(doc(adminDb, "tenants", "pend_trial_valid"), {
            subscriptionStatus: "trialing",
            adminNote: "رفض طلب الدفع مع بقاء التجربة",
            updatedAt: serverTimestamp(),
          });
        })
      );

      // ج) حساب تجربة منتهية في pending_payment: ممنوع إعادته إلى trialing (ساعة متأخرة)، ويُسمح فقط بضبطه إلى expired
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "pending_expired"), {
          subscriptionStatus: "trialing",
          adminNote: "خطأ ساعة متأخرة",
          updatedAt: serverTimestamp(),
        })
      );
      await assertSucceeds(
        runTransaction(adminDb, async (tx) => {
          tx.update(doc(adminDb, "activation_requests", "req_rej_trial_exp"), {
            status: "rejected",
            reviewedBy: OWNER_UID,
            updatedAt: serverTimestamp(),
          });
          tx.update(doc(adminDb, "tenants", "pending_expired"), {
            subscriptionStatus: "expired",
            adminNote: "رفض طلب الدفع بعد انتهاء التجربة",
            updatedAt: serverTimestamp(),
          });
        })
      );
    });

    // 19. تمديد التجربة الإداري (Branch A3): توقيت خادمي صارم، منع المدفوع/الموقوف، وحماية trialDays
    await runCase("تمديد التجربة الإداري بتوقيت الخادم (trialExtendedAt == request.time) ومنع المدفوع والموقوف وتعديل trialDays", async () => {
      const nowMs = Date.now();
      const adminDb = asDb(
        testEnv.authenticatedContext(OWNER_UID, {
          email: OWNER_EMAIL,
          email_verified: true,
        })
      );

      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = asDb(ctx);
        // حساب موقوف على خطة تجربة
        await setDoc(
          doc(db, "tenants", "susp_trial_no_ext"),
          makeSeedTenant("susp_trial_no_ext", "susp_t@workshop.jo", {
            subscriptionStatus: "suspended",
            planId: "trial",
            trialDays: 7,
            activeUntil: null,
          })
        );
        // حساب مدفوع منتهي (خادمي)
        await setDoc(
          doc(db, "tenants", "paid_exp_no_ext"),
          makeSeedTenant("paid_exp_no_ext", "paid_exp@workshop.jo", {
            subscriptionStatus: "active",
            planId: "pro",
            activatedAt: Timestamp.fromMillis(nowMs - 40 * DAY_MS),
            subscriptionDays: 30,
            activeUntil: null,
          })
        );
        // حساب تجربة ممددة منتهية فعلياً (ممددة قبل 10 أيام لمدة 7 أيام)
        await setDoc(
          doc(db, "tenants", "trial_ext_expired"),
          makeSeedTenant("trial_ext_expired", "trial_ext_exp@workshop.jo", {
            subscriptionStatus: "trialing",
            planId: "trial",
            trialDays: 7,
            createdAt: Timestamp.fromMillis(nowMs - 30 * DAY_MS),
            trialExtendedAt: Timestamp.fromMillis(nowMs - 10 * DAY_MS),
            trialExtensionDays: 7,
            activeUntil: null,
            projectCount: 1,
          })
        );
        await setDoc(
          doc(db, "tenants", "trial_ext_expired", "projects", "p1"),
          makeProjectDoc("trial_ext_expired", { utypes: [], custom: {} }, Timestamp.now())
        );
      });

      // 1) رفض تعديل trialDays مباشرة (الحفاظ على قاعدة الـ 7 أيام الأصلية)
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "trial_expired"), {
          subscriptionStatus: "trialing",
          trialDays: 30,
          adminNote: "محاولة تغيير trialDays",
          updatedAt: serverTimestamp(),
        })
      );

      // 2) رفض تمديد تجربة حساب مدفوع (سواء خادمي منتهي أو قديم activeUntil منتهي أو فعال)
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "paid_exp_no_ext"), {
          subscriptionStatus: "trialing",
          trialExtendedAt: serverTimestamp(),
          trialExtensionDays: 7,
          adminNote: "محاولة تمديد مدفوع",
          updatedAt: serverTimestamp(),
        })
      );
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "biz_expired_active"), {
          subscriptionStatus: "trialing",
          trialExtendedAt: serverTimestamp(),
          trialExtensionDays: 7,
          adminNote: "محاولة تمديد قديم مدفوع",
          updatedAt: serverTimestamp(),
        })
      );

      // 3) رفض تمديد تجربة حساب موقوف إدارياً (suspended)
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "susp_trial_no_ext"), {
          subscriptionStatus: "trialing",
          trialExtendedAt: serverTimestamp(),
          trialExtensionDays: 7,
          adminNote: "محاولة فتح موقوف",
          updatedAt: serverTimestamp(),
        })
      );

      // 4) رفض trialExtendedAt بتوقيت عميل (مستقبلي أو ماضٍ أو عشوائي)
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "trial_expired"), {
          subscriptionStatus: "trialing",
          trialExtendedAt: Timestamp.fromMillis(nowMs + 30 * DAY_MS),
          trialExtensionDays: 7,
          adminNote: "توقيت مستقبلي",
          updatedAt: serverTimestamp(),
        })
      );
      await assertFails(
        updateDoc(doc(adminDb, "tenants", "trial_expired"), {
          subscriptionStatus: "trialing",
          trialExtendedAt: Timestamp.fromMillis(nowMs - 2 * DAY_MS),
          trialExtensionDays: 7,
          adminNote: "توقيت قديم",
          updatedAt: serverTimestamp(),
        })
      );

      // 5) رفض مدد تمديد غير معتمدة (1، 10، 60، 365، 0، -5، نص)
      for (const badExtDays of [1, 10, 60, 365, 0, -5, "7"]) {
        await assertFails(
          updateDoc(doc(adminDb, "tenants", "trial_expired"), {
            subscriptionStatus: "trialing",
            trialExtendedAt: serverTimestamp(),
            trialExtensionDays: badExtDays as unknown as number,
            adminNote: "مدة غير مدعومة",
            updatedAt: serverTimestamp(),
          })
        );
      }

      // 6) تمديد إداري صالح بتوقيت الخادم (+7 أيام) لحساب تجربة صرف -> نجاح وفتح وصول المشاريع مع بقاء trialDays == 7
      await assertSucceeds(
        updateDoc(doc(adminDb, "tenants", "trial_expired"), {
          subscriptionStatus: "trialing",
          trialExtendedAt: serverTimestamp(),
          trialExtensionDays: 7,
          adminNote: "تمديد التجربة +7 يوم (بتوقيت الخادم)",
          updatedAt: serverTimestamp(),
        })
      );
      const trialUserDb = asDb(
        testEnv.authenticatedContext("trial_expired", {
          email: "trial_expired@workshop.jo",
          email_verified: true,
        })
      );
      await assertSucceeds(getDoc(doc(trialUserDb, "tenants", "trial_expired", "projects", "proj_existing")));

      // 7) حساب انتهت مدة تمديده (trialExtendedAt + 7d في الماضي) يُقفل فوراً من القواعد
      const extExpUserDb = asDb(
        testEnv.authenticatedContext("trial_ext_expired", {
          email: "trial_ext_exp@workshop.jo",
          email_verified: true,
        })
      );
      await assertFails(getDoc(doc(extExpUserDb, "tenants", "trial_ext_expired", "projects", "p1")));
    });

    // 20. منع العميل العادي من تعديل أو حقن حقول توقيت التجربة (trialExtendedAt / trialExtensionDays / trialDays)
    await runCase("منع العميل العادي من تعديل أو حقن trialExtendedAt أو trialExtensionDays أو trialDays", async () => {
      const u = testEnv.authenticatedContext("new_trial_attacker", {
        email: "attacker_trial@workshop.jo",
        email_verified: true,
      });
      const db = asDb(u);

      // رفض حقن trialExtendedAt و trialExtensionDays عند إنشاء الحساب
      await assertFails(
        setDoc(doc(db, "tenants", "new_trial_attacker"), {
          ownerUid: "new_trial_attacker",
          email: "attacker_trial@workshop.jo",
          displayName: "ورشة",
          workshopName: "ورشة",
          phone: "",
          role: "owner",
          subscriptionStatus: "trialing",
          planId: "trial",
          trialDays: 7,
          trialExtendedAt: serverTimestamp(),
          trialExtensionDays: 30,
          activeUntil: null,
          adminNote: "",
          projectCount: 0,
          extraCustomTypesQuota: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      // رفض تعديل حقول توقيت التجربة من العميل على حساب قائم
      const existingTrialDb = asDb(
        testEnv.authenticatedContext("trial_expired", {
          email: "trial_expired@workshop.jo",
          email_verified: true,
        })
      );
      await assertFails(
        updateDoc(doc(existingTrialDb, "tenants", "trial_expired"), {
          trialExtendedAt: serverTimestamp(),
          trialExtensionDays: 30,
          updatedAt: serverTimestamp(),
        })
      );
      await assertFails(
        updateDoc(doc(existingTrialDb, "tenants", "trial_expired"), {
          trialDays: 365,
          updatedAt: serverTimestamp(),
        })
      );
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
