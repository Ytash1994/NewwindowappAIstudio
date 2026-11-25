import { deleteApp, initializeApp } from "firebase/app";
import {
  EmailAuthProvider,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  getAuth,
  linkWithCredential,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  updatePassword,
  updateProfile,
  verifyPasswordResetCode,
} from "firebase/auth";
import type { User } from "firebase/auth";
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import { auth, db, googleProvider, handleFirestoreError, OperationType } from "../firebase";
import type { AppState, SavedProject } from "../types";
import {
  BLUEPRINT_LIMITS,
  DEFAULT_EXTRA_TYPES_PACK_PRICE_JOD,
  DEFAULT_EXTRA_TYPES_PACK_SIZE,
  DEFAULT_PLANS,
  DEFAULT_PLATFORM_CONFIG,
  DEFAULT_TRIAL_DAYS,
  TRIAL_MAX_PROJECTS,
  getPlanDefaultsById,
  isOwnerAdminEmail,
  resolvePlanLimits,
  sanitizeStr,
  tsToMs,
} from "./types";
import type {
  ActivationRequestDoc,
  ActivationRequestType,
  AuditLogDoc,
  BillingCycle,
  PlatformConfig,
  SubscriptionPlan,
  TenantAccount,
} from "./types";

// ذاكرة مؤقتة خفيفة داخل الجلسة لتقليل قراءات Firestore على خطة Spark المجانية
let cachedPlatformConfig: { data: PlatformConfig; fetchedAt: number } | null = null;
let cachedPlans: { data: SubscriptionPlan[]; isAdmin: boolean; fetchedAt: number } | null = null;
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateStaticSaaSCache(): void {
  cachedPlatformConfig = null;
  cachedPlans = null;
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    });
    return out as T;
  }
  return value;
}

export function makeSafeDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, "");
}

function summarizeTenantState(t: Partial<TenantAccount>): string {
  const untilMs = tsToMs(t.activeUntil as Timestamp | null | undefined);
  const summary = {
    status: t.subscriptionStatus || "",
    planId: t.planId || "",
    role: t.role || "",
    trialDays: t.trialDays ?? 0,
    activeUntil: untilMs ? new Date(untilMs).toISOString().slice(0, 10) : null,
  };
  return sanitizeStr(JSON.stringify(summary), BLUEPRINT_LIMITS.stateSnapMax);
}

/**
 * مزامنة تقدير التوقيت من ترويسة HTTP Date لاستضافة Firebase Hosting (بدون أي خادم Express أو تكلفة).
 * ملاحظة أمان: التحقق الإلزامي من انتهاء التجربة والاشتراك يتم دائماً عبر request.time داخل قواعد Firestore.
 */
export async function fetchServerTimeOffsetMs(): Promise<number> {
  if (typeof window === "undefined") return 0;
  try {
    const t0 = Date.now();
    const res = await fetch(`${window.location.origin}/`, {
      method: "HEAD",
      cache: "no-store",
    });
    const dateHeader = res.headers.get("date");
    const t1 = Date.now();
    if (!dateHeader) return 0;
    const serverMs = Date.parse(dateHeader);
    if (!Number.isFinite(serverMs)) return 0;
    const midpoint = Math.round((t0 + t1) / 2);
    return serverMs - midpoint;
  } catch {
    return 0;
  }
}

/** إرسال رسالة توثيق البريد الإلكتروني عبر Firebase Authentication */
export async function sendEmailVerificationSafe(user: User): Promise<void> {
  auth.languageCode = "ar";
  try {
    await sendEmailVerification(user, {
      url: `${window.location.origin}/`,
      handleCodeInApp: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unauthorized-continue-uri") || msg.includes("invalid-continue-uri")) {
      await sendEmailVerification(user);
      return;
    }
    throw err;
  }
}

/** إعادة تحميل حالة المستخدم وتحديث رمز الهوية للتحقق من إتمام توثيق البريد */
export async function refreshUserVerificationStatus(user: User): Promise<boolean> {
  await user.reload();
  const fresh = auth.currentUser || user;
  if (fresh.emailVerified) {
    await fresh.getIdToken(true);
    return true;
  }
  return false;
}

/**
 * إنشاء بيانات الورشة فقط بعد التحقق الفعلي من توثيق البريد الإلكتروني
 * (ممنوع منعاً باتاً إنشاء tenant أو بدء التجربة قبل توثيق البريد)
 */
export async function ensureTenantAndDefaults(
  user: User,
  initialProfile?: { workshopName?: string; phone?: string }
): Promise<TenantAccount> {
  if (!user.emailVerified) {
    throw new Error("يجب توثيق البريد الإلكتروني أولاً قبل إنشاء حساب الورشة وبدء التجربة.");
  }

  // تأكد من تحديث الرمز المميز حتى تعكس قواعد Firestore قيمة email_verified == true
  await user.getIdToken(true);

  const tenantPath = `tenants/${user.uid}`;
  const tenantRef = doc(db, "tenants", user.uid);
  const isPrimaryOwner = isOwnerAdminEmail(user.email) && Boolean(user.emailVerified);

  let snap;
  try {
    snap = await getDoc(tenantRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, tenantPath);
  }

  let createdNow = false;
  if (!snap.exists()) {
    const email = sanitizeStr((user.email || "").toLowerCase(), BLUEPRINT_LIMITS.emailMax);
    const displayName = sanitizeStr(
      initialProfile?.workshopName || user.displayName || email.split("@")[0] || "مستخدم",
      BLUEPRINT_LIMITS.nameMax
    );
    const workshopName = sanitizeStr(
      initialProfile?.workshopName ||
        user.displayName ||
        email.split("@")[0] ||
        (isPrimaryOwner ? "إدارة المنصة" : "ورشتي"),
      BLUEPRINT_LIMITS.nameMax
    );
    const phone = sanitizeStr(
      initialProfile?.phone || (isPrimaryOwner ? DEFAULT_PLATFORM_CONFIG.whatsappPhone : ""),
      BLUEPRINT_LIMITS.phoneMax
    );

    const payload = isPrimaryOwner
      ? {
          ownerUid: user.uid,
          email,
          displayName,
          workshopName: workshopName || "إدارة المنصة",
          phone,
          role: "admin" as const,
          subscriptionStatus: "active" as const,
          planId: "owner_free",
          trialDays: 0,
          activeUntil: null,
          adminNote: "حساب مالك المنصة - مجاني دائم",
          projectCount: 0,
          extraCustomTypesQuota: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      : {
          ownerUid: user.uid,
          email,
          displayName,
          workshopName: workshopName || "ورشتي",
          phone,
          role: "owner" as const,
          subscriptionStatus: "trialing" as const,
          planId: "trial",
          trialDays: DEFAULT_TRIAL_DAYS,
          activeUntil: null,
          adminNote: "",
          projectCount: 0,
          extraCustomTypesQuota: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

    try {
      await setDoc(tenantRef, payload);
      createdNow = true;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, tenantPath);
    }
  }

  if (isPrimaryOwner) {
    await seedDefaultsIfMissing(user.uid);
  }

  if (!createdNow && snap.exists()) {
    return snap.data() as TenantAccount;
  }

  let freshSnap;
  try {
    freshSnap = await getDoc(tenantRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, tenantPath);
  }

  return freshSnap.data() as TenantAccount;
}

async function seedDefaultsIfMissing(adminUid: string): Promise<void> {
  const cfgPath = "config/platform";
  try {
    const cfgRef = doc(db, "config", "platform");
    const cfgSnap = await getDoc(cfgRef);
    if (!cfgSnap.exists()) {
      await setDoc(cfgRef, {
        ...DEFAULT_PLATFORM_CONFIG,
        updatedBy: adminUid,
        updatedAt: serverTimestamp(),
      });
    } else {
      // تنظيف أي حقول حساسة قديمة (expiryWebhookUrl / adminAlertEmail) من الوثيقة العامة تلقائياً
      const existingData = cfgSnap.data() as Record<string, unknown>;
      if ("expiryWebhookUrl" in existingData || "adminAlertEmail" in existingData) {
        await setDoc(cfgRef, {
          whatsappPhone:
            sanitizeStr(String(existingData.whatsappPhone || ""), BLUEPRINT_LIMITS.phoneMax) ||
            DEFAULT_PLATFORM_CONFIG.whatsappPhone,
          cliqAlias: sanitizeStr(String(existingData.cliqAlias || ""), 100),
          cliqBankName: sanitizeStr(String(existingData.cliqBankName || ""), 100),
          cliqHolderName: sanitizeStr(String(existingData.cliqHolderName || ""), 120),
          trialDaysDefault: Math.max(
            0,
            Math.min(90, Math.round(Number(existingData.trialDaysDefault) || DEFAULT_TRIAL_DAYS))
          ),
          supportNote: sanitizeStr(String(existingData.supportNote || ""), BLUEPRINT_LIMITS.adminNoteMax),
          updatedBy: adminUid,
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, cfgPath);
  }

  const plansPath = "plans";
  try {
    const existingPlans = await getDocs(collection(db, "plans"));
    if (existingPlans.empty) {
      for (const p of DEFAULT_PLANS) {
        await setDoc(doc(db, "plans", p.id), {
          ...p,
          updatedAt: serverTimestamp(),
        });
      }
    } else {
      for (const d of existingPlans.docs) {
        const cur = d.data() as Partial<SubscriptionPlan>;
        if (typeof cur.maxCustomTypes !== "number" || typeof cur.maxCustomFieldsPerType !== "number") {
          const def = DEFAULT_PLANS.find((p) => p.id === d.id);
          if (def) {
            try {
              await updateDoc(doc(db, "plans", d.id), {
                allowCustomTypes: def.maxCustomTypes !== 0,
                maxCustomTypes: def.maxCustomTypes,
                maxCustomFieldsPerType: def.maxCustomFieldsPerType,
                allowExtraTypesAddon: Boolean(def.allowExtraTypesAddon),
                extraTypesPackSize: def.extraTypesPackSize ?? 0,
                extraTypesPackPriceJod: def.extraTypesPackPriceJod ?? 0,
                features: def.features,
                updatedAt: serverTimestamp(),
              });
            } catch {
              // يتم تطبيق القيم الافتراضية تلقائياً عبر getPlanDefaultsById
            }
          }
        }
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, plansPath);
  }
}

// ==================== قراءات عند الطلب (بدون مستمعات حية مستمرة لتقليل استهلاك خطة Spark) ====================

export async function fetchTenant(uid: string): Promise<TenantAccount | null> {
  const path = `tenants/${uid}`;
  try {
    const snap = await getDoc(doc(db, "tenants", uid));
    return snap.exists() ? (snap.data() as TenantAccount) : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function fetchPlatformConfig(force = false): Promise<PlatformConfig> {
  if (
    !force &&
    cachedPlatformConfig &&
    Date.now() - cachedPlatformConfig.fetchedAt < CONFIG_CACHE_TTL_MS
  ) {
    return cachedPlatformConfig.data;
  }
  const path = "config/platform";
  try {
    const snap = await getDoc(doc(db, "config", "platform"));
    const cfg: PlatformConfig = snap.exists()
      ? (() => {
          const d = snap.data() as Partial<PlatformConfig>;
          return {
            whatsappPhone: d.whatsappPhone || DEFAULT_PLATFORM_CONFIG.whatsappPhone,
            cliqAlias: d.cliqAlias || "",
            cliqBankName: d.cliqBankName || "",
            cliqHolderName: d.cliqHolderName || "",
            trialDaysDefault:
              typeof d.trialDaysDefault === "number" ? d.trialDaysDefault : DEFAULT_TRIAL_DAYS,
            supportNote: d.supportNote || "",
            updatedBy: d.updatedBy || "system",
            updatedAt: d.updatedAt ?? null,
          };
        })()
      : DEFAULT_PLATFORM_CONFIG;
    cachedPlatformConfig = { data: cfg, fetchedAt: Date.now() };
    return cfg;
  } catch {
    return DEFAULT_PLATFORM_CONFIG;
  }
}

export async function fetchPlans(isAdmin: boolean, force = false): Promise<SubscriptionPlan[]> {
  if (
    !force &&
    cachedPlans &&
    cachedPlans.isAdmin === isAdmin &&
    Date.now() - cachedPlans.fetchedAt < CONFIG_CACHE_TTL_MS
  ) {
    return cachedPlans.data;
  }
  try {
    const q = isAdmin
      ? query(collection(db, "plans"))
      : query(collection(db, "plans"), where("active", "==", true));
    const snap = await getDocs(q);
    const list = snap.empty
      ? DEFAULT_PLANS
      : snap.docs
          .map((d) => d.data() as SubscriptionPlan)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    cachedPlans = { data: list, isAdmin, fetchedAt: Date.now() };
    return list;
  } catch {
    return DEFAULT_PLANS;
  }
}

export async function fetchTenantProjects(uid: string): Promise<SavedProject[]> {
  const path = `tenants/${uid}/projects`;
  try {
    const q = query(collection(db, "tenants", uid, "projects"), where("ownerUid", "==", uid));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        const updatedMs = tsToMs(data.updatedAt as Timestamp | null) || Date.now();
        return {
          id: d.id,
          name: String(data.name || "مشروع"),
          updatedAt: new Date(updatedMs).toISOString(),
          data: data.snapshot as Omit<AppState, "raw">,
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function fetchMyActivationRequests(uid: string): Promise<ActivationRequestDoc[]> {
  try {
    const q = query(collection(db, "activation_requests"), where("ownerUid", "==", uid));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<ActivationRequestDoc, "id">) }))
      .sort((a, b) => (tsToMs(b.createdAt) || 0) - (tsToMs(a.createdAt) || 0));
  } catch {
    return [];
  }
}

/** التحقق من حدود الأنواع المخصصة والعلاقات الجديدة على لقطة المشروع قبل الحفظ السحابي */
export function assertSnapshotWithinPlanLimits(
  tenant: TenantAccount,
  plan: SubscriptionPlan | null,
  snapshot: Omit<AppState, "raw">
): void {
  if (isOwnerAdminEmail(tenant.email)) return;
  const limits = resolvePlanLimits(tenant, plan, false);
  const customTypesCount = Array.isArray(snapshot.utypes) ? snapshot.utypes.length : 0;

  if (limits.maxCustomTypes === 0 && customTypesCount > 0) {
    throw new Error(
      "باقتك الحالية لا تسمح بحفظ أنواع شبابيك مخصصة (الأنواع الأساسية الأربعة فقط). قم بترقية الباقة."
    );
  }
  if (limits.maxCustomTypes >= 0 && customTypesCount > limits.maxCustomTypes) {
    throw new Error(
      limits.canRequestExtraTypesAddon
        ? `تجاوزت الحد المسموح من الأنواع المخصصة (${limits.maxCustomTypes}). يمكنك طلب حزمة أنواع إضافية من نافذة الاشتراك.`
        : `تجاوزت الحد الأقصى للأنواع المخصصة في باقتك (${limits.maxCustomTypes}). قم بترقية الباقة لحفظ المزيد.`
    );
  }

  if (limits.maxCustomFieldsPerType >= 0 && snapshot.custom && typeof snapshot.custom === "object") {
    for (const [typeName, fieldsList] of Object.entries(snapshot.custom)) {
      const cnt = Array.isArray(fieldsList) ? fieldsList.length : 0;
      if (cnt > limits.maxCustomFieldsPerType) {
        throw new Error(
          `تجاوزت الحد الأقصى لإضافة العلاقات الجديدة لنوع «${typeName}» في باقتك (${limits.maxCustomFieldsPerType} علاقات لكل نوع). قم بترقية الباقة.`
        );
      }
    }
  }
}

/**
 * حفظ مشروع سحابي داخل معاملة ذرية تفرض حد المشاريع (maxProjects)
 * وحد الأنواع المخصصة (maxCustomTypes + extraCustomTypesQuota) وحد العلاقات الجديدة لكل نوع
 * بالتزامن مع قواعد Firestore، وتُرجع المشروع المحفوظ لتحديث الواجهة محلياً دون قراءة إضافية.
 */
export async function saveCloudProject(
  uid: string,
  projectId: string | null,
  name: string,
  snapshot: Omit<AppState, "raw">
): Promise<SavedProject> {
  const safeName = sanitizeStr(name, BLUEPRINT_LIMITS.nameMax) || "مشروع جديد";
  const safeType = sanitizeStr(snapshot.type || "شباك 3 مجاري نظامي", BLUEPRINT_LIMITS.windowTypeMax);
  const windowCount = Math.min(
    1000,
    (snapshot.rows || []).filter((r) => r.L || r.W || r.p).length
  );
  const cleanSnapshot = stripUndefined(snapshot);

  if (projectId) {
    const path = `tenants/${uid}/projects/${projectId}`;
    try {
      await runTransaction(db, async (tx) => {
        const tenantRef = doc(db, "tenants", uid);
        const tenantSnap = await tx.get(tenantRef);
        if (!tenantSnap.exists()) {
          throw new Error("حساب الورشة غير موجود.");
        }
        const tenant = tenantSnap.data() as TenantAccount;
        let plan: SubscriptionPlan | null = null;
        if (!isOwnerAdminEmail(tenant.email) && tenant.planId && tenant.planId !== "trial") {
          const planSnap = await tx.get(doc(db, "plans", tenant.planId));
          if (planSnap.exists()) plan = planSnap.data() as SubscriptionPlan;
        }
        assertSnapshotWithinPlanLimits(tenant, plan, cleanSnapshot);

        tx.update(doc(db, "tenants", uid, "projects", projectId), {
          name: safeName,
          windowType: safeType,
          unit: snapshot.unit,
          windowCount,
          snapshot: cleanSnapshot,
          updatedAt: serverTimestamp(),
        });
      });
      return {
        id: projectId,
        name: safeName,
        updatedAt: new Date().toISOString(),
        data: cleanSnapshot,
      };
    } catch (err) {
      if (err instanceof Error && (err.message.includes("الحد") || err.message.includes("باقتك الحالية"))) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("permission-denied") || msg.includes("PERMISSION_DENIED")) {
        throw new Error("تعذر تعديل المشروع: تحقق من صلاحية اشتراكك أو حدود الباقة الحالية.");
      }
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  const newId = makeSafeDocId("pj");
  const path = `tenants/${uid}/projects/${newId}`;
  try {
    await runTransaction(db, async (tx) => {
      const tenantRef = doc(db, "tenants", uid);
      const tenantSnap = await tx.get(tenantRef);
      if (!tenantSnap.exists()) {
        throw new Error("حساب الورشة غير موجود.");
      }
      const tenant = tenantSnap.data() as TenantAccount;
      const isOwner = isOwnerAdminEmail(tenant.email);
      const currentCount = typeof tenant.projectCount === "number" ? tenant.projectCount : 0;

      if (!isOwner) {
        let maxProjects = TRIAL_MAX_PROJECTS;
        let plan: SubscriptionPlan | null = null;
        if (tenant.planId && tenant.planId !== "trial") {
          const planSnap = await tx.get(doc(db, "plans", tenant.planId));
          if (planSnap.exists()) {
            plan = planSnap.data() as SubscriptionPlan;
            maxProjects = plan.maxProjects;
          }
        }
        if (maxProjects >= 0 && currentCount >= maxProjects) {
          throw new Error(
            `وصلت إلى الحد الأقصى لعدد المشاريع في باقتك (${maxProjects} مشروع). قم بترقية الباقة لحفظ المزيد.`
          );
        }
        assertSnapshotWithinPlanLimits(tenant, plan, cleanSnapshot);
      }

      const projectRef = doc(db, "tenants", uid, "projects", newId);
      tx.set(projectRef, {
        ownerUid: uid,
        name: safeName,
        windowType: safeType,
        unit: snapshot.unit,
        windowCount,
        snapshot: cleanSnapshot,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (!isOwner) {
        tx.update(tenantRef, {
          projectCount: currentCount + 1,
          lastProjectActionId: newId,
          updatedAt: serverTimestamp(),
        });
      }
    });
    return {
      id: newId,
      name: safeName,
      updatedAt: new Date().toISOString(),
      data: cleanSnapshot,
    };
  } catch (err) {
    if (err instanceof Error && (err.message.includes("الحد") || err.message.includes("باقتك الحالية"))) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("permission-denied") || msg.includes("PERMISSION_DENIED")) {
      throw new Error(
        "تعذر حفظ المشروع: انتهت مدة الاشتراك أو تجاوزت حدود باقتك الحالية."
      );
    }
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function renameCloudProject(
  uid: string,
  projectId: string,
  nextName: string
): Promise<void> {
  const path = `tenants/${uid}/projects/${projectId}`;
  const safeName = sanitizeStr(nextName, BLUEPRINT_LIMITS.nameMax);
  if (!safeName) return;
  try {
    await updateDoc(doc(db, "tenants", uid, "projects", projectId), {
      name: safeName,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

/** حذف مشروع سحابي داخل معاملة ذرية تنقص عدّاد projectCount بشكل متزامن مع القواعد */
export async function deleteCloudProject(uid: string, projectId: string): Promise<void> {
  const path = `tenants/${uid}/projects/${projectId}`;
  try {
    await runTransaction(db, async (tx) => {
      const tenantRef = doc(db, "tenants", uid);
      const projectRef = doc(db, "tenants", uid, "projects", projectId);
      const [tenantSnap, projectSnap] = await Promise.all([tx.get(tenantRef), tx.get(projectRef)]);
      if (!projectSnap.exists()) return;

      tx.delete(projectRef);

      if (tenantSnap.exists()) {
        const tenant = tenantSnap.data() as TenantAccount;
        const currentCount = typeof tenant.projectCount === "number" ? tenant.projectCount : 0;
        if (!isOwnerAdminEmail(tenant.email) && currentCount > 0) {
          tx.update(tenantRef, {
            projectCount: currentCount - 1,
            lastProjectActionId: projectId,
            updatedAt: serverTimestamp(),
          });
        }
      }
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function updateTenantProfile(
  uid: string,
  patch: { workshopName: string; phone: string; displayName?: string }
): Promise<void> {
  const path = `tenants/${uid}`;
  try {
    const updatePayload: Record<string, unknown> = {
      workshopName: sanitizeStr(patch.workshopName, BLUEPRINT_LIMITS.nameMax),
      phone: sanitizeStr(patch.phone, BLUEPRINT_LIMITS.phoneMax),
      updatedAt: serverTimestamp(),
    };
    if (patch.displayName !== undefined) {
      updatePayload.displayName = sanitizeStr(patch.displayName, BLUEPRINT_LIMITS.nameMax);
    }
    await updateDoc(doc(db, "tenants", uid), updatePayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

/**
 * تقديم طلب دفع يدوي عبر CliQ:
 * - لاشتراك جديد/تجديد: ينشئ الطلب بحالة pending ويحوّل حالة الحساب إلى pending_payment (دون تفعيل الاشتراك)
 * - لحزمة أنواع إضافية (خاصة بباقة الورش والمصانع الفعالة فقط): ينشئ الطلب بحالة pending دون إيقاف الاشتراك الفعال
 */
export async function submitActivationRequest(
  user: User,
  params: {
    workshopName: string;
    phone: string;
    planId: string;
    billingCycle: BillingCycle;
    cliqNote: string;
    requestType?: ActivationRequestType;
    extraTypesCount?: number;
    addonPriceJod?: number;
  }
): Promise<string> {
  if (!user.emailVerified) {
    throw new Error("يجب توثيق البريد الإلكتروني قبل تقديم طلب الدفع.");
  }

  const reqType: ActivationRequestType =
    params.requestType === "extra_types_addon" ? "extra_types_addon" : "subscription";
  const reqId = makeSafeDocId(reqType === "extra_types_addon" ? "addon" : "req");
  const path = `activation_requests/${reqId}`;

  try {
    await runTransaction(db, async (tx) => {
      const tenantRef = doc(db, "tenants", user.uid);
      const tenantSnap = await tx.get(tenantRef);
      if (!tenantSnap.exists()) {
        throw new Error("لم يتم العثور على بيانات الورشة.");
      }
      const tenant = tenantSnap.data() as TenantAccount;

      let extraTypesCount = 0;
      let addonPriceJod = 0;
      let effectivePlanId = sanitizeStr(params.planId, BLUEPRINT_LIMITS.planIdMax) || "starter";

      if (reqType === "extra_types_addon") {
        if (tenant.subscriptionStatus !== "active") {
          throw new Error("طلب حزمة الأنواع الإضافية متاح فقط للاشتراكات الفعّالة على الباقة الأخيرة.");
        }
        const planSnap = await tx.get(doc(db, "plans", tenant.planId));
        const livePlan = planSnap.exists() ? (planSnap.data() as SubscriptionPlan) : null;
        const resolved = getPlanDefaultsById(livePlan || { id: tenant.planId });
        if (!resolved.allowExtraTypesAddon) {
          throw new Error("حزمة الأنواع الإضافية متاحة فقط للباقة الأخيرة (باقة الورش والمصانع).");
        }
        effectivePlanId = tenant.planId;
        extraTypesCount = Math.max(
          1,
          Math.min(50, Math.round(Number(params.extraTypesCount) || resolved.extraTypesPackSize))
        );
        addonPriceJod = Math.max(
          0,
          Math.min(10000, Number(params.addonPriceJod ?? resolved.extraTypesPackPriceJod) || 0)
        );
      }

      const payload: Record<string, unknown> = {
        tenantId: user.uid,
        ownerUid: user.uid,
        email: sanitizeStr((user.email || "").toLowerCase(), BLUEPRINT_LIMITS.emailMax),
        workshopName:
          sanitizeStr(params.workshopName || tenant.workshopName || "ورشتي", BLUEPRINT_LIMITS.nameMax) ||
          "ورشتي",
        phone: sanitizeStr(params.phone, BLUEPRINT_LIMITS.phoneMax),
        planId: effectivePlanId,
        billingCycle: params.billingCycle,
        cliqNote: sanitizeStr(params.cliqNote, BLUEPRINT_LIMITS.noteMax),
        status: "pending",
        reviewedBy: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (reqType === "extra_types_addon") {
        payload.requestType = "extra_types_addon";
        payload.extraTypesCount = extraTypesCount;
        payload.addonPriceJod = addonPriceJod;
      }

      tx.set(doc(db, "activation_requests", reqId), payload);

      if (
        reqType === "subscription" &&
        (tenant.subscriptionStatus === "trialing" || tenant.subscriptionStatus === "expired")
      ) {
        tx.update(tenantRef, {
          subscriptionStatus: "pending_payment",
          updatedAt: serverTimestamp(),
        });
      }
    });
    return reqId;
  } catch (err) {
    if (err instanceof Error && (err.message.includes("متاح فقط") || err.message.includes("توثيق"))) {
      throw err;
    }
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

// ==================== خدمات المدير الأساسي (قراءات عند الطلب + معاملات ذرية وسجل تدقيق) ====================

async function writeAuditLog(
  adminUser: User,
  action: string,
  targetTenantId: string,
  details: string,
  snapshots?: { beforeState?: string; afterState?: string }
): Promise<void> {
  const logId = makeSafeDocId("log");
  const path = `audit_logs/${logId}`;
  try {
    await setDoc(doc(db, "audit_logs", logId), {
      actorUid: adminUser.uid,
      actorEmail: sanitizeStr((adminUser.email || "").toLowerCase(), BLUEPRINT_LIMITS.emailMax),
      action: sanitizeStr(action, 80),
      targetTenantId: sanitizeStr(targetTenantId, BLUEPRINT_LIMITS.idMax),
      details: sanitizeStr(details, BLUEPRINT_LIMITS.adminNoteMax),
      beforeState: sanitizeStr(snapshots?.beforeState || "", BLUEPRINT_LIMITS.stateSnapMax),
      afterState: sanitizeStr(snapshots?.afterState || "", BLUEPRINT_LIMITS.stateSnapMax),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function fetchAllTenants(): Promise<TenantAccount[]> {
  const path = "tenants";
  try {
    const snap = await getDocs(query(collection(db, "tenants")));
    return snap.docs
      .map((d) => d.data() as TenantAccount)
      .sort((a, b) => (tsToMs(b.createdAt) || 0) - (tsToMs(a.createdAt) || 0));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function fetchAllActivationRequests(): Promise<ActivationRequestDoc[]> {
  const path = "activation_requests";
  try {
    const snap = await getDocs(query(collection(db, "activation_requests")));
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<ActivationRequestDoc, "id">) }))
      .sort((a, b) => (tsToMs(b.createdAt) || 0) - (tsToMs(a.createdAt) || 0));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function fetchAuditLogs(maxItems = 80): Promise<AuditLogDoc[]> {
  const path = "audit_logs";
  try {
    const snap = await getDocs(
      query(collection(db, "audit_logs"), orderBy("createdAt", "desc"), limit(maxItems))
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditLogDoc, "id">) }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

/** تفعيل اشتراك مدفوع داخل معاملة ذرية تبدأ مدتها من تاريخ التأكيد وتسجّل قبل/بعد في audit_logs */
export async function adminActivateTenant(
  adminUser: User,
  target: TenantAccount,
  opts: { planId: string; durationDays: number | null; adminNote?: string },
  serverNowMs = Date.now()
): Promise<void> {
  const path = `tenants/${target.ownerUid}`;
  const cleanPlan = sanitizeStr(opts.planId, BLUEPRINT_LIMITS.planIdMax) || "starter";
  const activeUntil =
    opts.durationDays === null
      ? null
      : Timestamp.fromMillis(serverNowMs + opts.durationDays * 86400000);
  const note = sanitizeStr(
    opts.adminNote ??
      `تفعيل عبر كليك (${opts.durationDays === null ? "دائم" : `${opts.durationDays} يوم`})`,
    BLUEPRINT_LIMITS.adminNoteMax
  );
  const logId = makeSafeDocId("log");

  try {
    await runTransaction(db, async (tx) => {
      const tenantRef = doc(db, "tenants", target.ownerUid);
      const snap = await tx.get(tenantRef);
      if (!snap.exists()) {
        throw new Error("لم يتم العثور على حساب الورشة.");
      }
      const prev = snap.data() as TenantAccount;
      const beforeState = summarizeTenantState(prev);
      const afterState = summarizeTenantState({
        ...prev,
        subscriptionStatus: "active",
        planId: cleanPlan,
        activeUntil,
      });

      tx.update(tenantRef, {
        subscriptionStatus: "active",
        planId: cleanPlan,
        activeUntil,
        extraCustomTypesQuota: 0, // حزمة الأنواع الإضافية تُدفع مرة واحدة مع كل اشتراك جديد
        adminNote: note,
        updatedAt: serverTimestamp(),
      });

      tx.set(doc(db, "audit_logs", logId), {
        actorUid: adminUser.uid,
        actorEmail: sanitizeStr((adminUser.email || "").toLowerCase(), BLUEPRINT_LIMITS.emailMax),
        action: "activate_subscription",
        targetTenantId: target.ownerUid,
        details: sanitizeStr(
          `تفعيل ${prev.email} على باقة ${cleanPlan} لمدة ${
            opts.durationDays === null ? "دائمة" : `${opts.durationDays} يوم`
          }`,
          BLUEPRINT_LIMITS.adminNoteMax
        ),
        beforeState,
        afterState,
        createdAt: serverTimestamp(),
      });
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

/** منح حصة أنواع مخصصة إضافية لورشة مشتركه على الباقة الأخيرة (ضمن معاملة ذرية مؤرخة) */
export async function adminGrantExtraTypesQuota(
  adminUser: User,
  target: TenantAccount,
  deltaTypes: number
): Promise<void> {
  const path = `tenants/${target.ownerUid}`;
  const logId = makeSafeDocId("log");
  const safeDelta = Math.max(1, Math.min(50, Math.round(Number(deltaTypes) || DEFAULT_EXTRA_TYPES_PACK_SIZE)));

  try {
    await runTransaction(db, async (tx) => {
      const tenantRef = doc(db, "tenants", target.ownerUid);
      const snap = await tx.get(tenantRef);
      if (!snap.exists()) {
        throw new Error("لم يتم العثور على حساب الورشة.");
      }
      const prev = snap.data() as TenantAccount;
      const curQuota = typeof prev.extraCustomTypesQuota === "number" ? prev.extraCustomTypesQuota : 0;
      const nextQuota = Math.min(200, curQuota + safeDelta);

      const beforeState = `${summarizeTenantState(prev)} | extraTypes=${curQuota}`;
      const afterState = `${summarizeTenantState(prev)} | extraTypes=${nextQuota}`;

      tx.update(tenantRef, {
        extraCustomTypesQuota: nextQuota,
        adminNote: sanitizeStr(
          `إضافة حزمة +${safeDelta} أنواع مخصصة للاشتراك الحالي (الإجمالي الإضافي: ${nextQuota})`,
          BLUEPRINT_LIMITS.adminNoteMax
        ),
        updatedAt: serverTimestamp(),
      });

      tx.set(doc(db, "audit_logs", logId), {
        actorUid: adminUser.uid,
        actorEmail: sanitizeStr((adminUser.email || "").toLowerCase(), BLUEPRINT_LIMITS.emailMax),
        action: "grant_extra_types",
        targetTenantId: target.ownerUid,
        details: sanitizeStr(
          `منح +${safeDelta} أنواع مخصصة للورشة ${prev.email} (الحصة الإضافية الآن ${nextQuota})`,
          BLUEPRINT_LIMITS.adminNoteMax
        ),
        beforeState,
        afterState,
        createdAt: serverTimestamp(),
      });
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function adminExtendTrial(
  adminUser: User,
  target: TenantAccount,
  extraDays: number,
  serverNowMs = Date.now()
): Promise<void> {
  const path = `tenants/${target.ownerUid}`;
  const logId = makeSafeDocId("log");

  try {
    await runTransaction(db, async (tx) => {
      const tenantRef = doc(db, "tenants", target.ownerUid);
      const snap = await tx.get(tenantRef);
      if (!snap.exists()) {
        throw new Error("لم يتم العثور على حساب الورشة.");
      }
      const prev = snap.data() as TenantAccount;
      const createdMs = tsToMs(prev.createdAt) || serverNowMs;
      const elapsedDays = Math.max(0, Math.ceil((serverNowMs - createdMs) / 86400000));
      const nextTrialDays = Math.min(3650, Math.max((prev.trialDays || 0) + extraDays, elapsedDays + extraDays));

      const beforeState = summarizeTenantState(prev);
      const afterState = summarizeTenantState({
        ...prev,
        subscriptionStatus: "trialing",
        trialDays: nextTrialDays,
      });

      tx.update(tenantRef, {
        subscriptionStatus: "trialing",
        trialDays: nextTrialDays,
        adminNote: sanitizeStr(`تمديد التجربة +${extraDays} يوم`, BLUEPRINT_LIMITS.adminNoteMax),
        updatedAt: serverTimestamp(),
      });

      tx.set(doc(db, "audit_logs", logId), {
        actorUid: adminUser.uid,
        actorEmail: sanitizeStr((adminUser.email || "").toLowerCase(), BLUEPRINT_LIMITS.emailMax),
        action: "extend_trial",
        targetTenantId: target.ownerUid,
        details: sanitizeStr(
          `تمديد تجربة ${prev.email} بمقدار ${extraDays} يوم (الإجمالي ${nextTrialDays} يوم)`,
          BLUEPRINT_LIMITS.adminNoteMax
        ),
        beforeState,
        afterState,
        createdAt: serverTimestamp(),
      });
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function adminSuspendTenant(
  adminUser: User,
  target: TenantAccount,
  reason: string
): Promise<void> {
  const path = `tenants/${target.ownerUid}`;
  const logId = makeSafeDocId("log");
  const cleanReason = sanitizeStr(reason || "تم إيقاف الحساب من الإدارة", BLUEPRINT_LIMITS.adminNoteMax);

  try {
    await runTransaction(db, async (tx) => {
      const tenantRef = doc(db, "tenants", target.ownerUid);
      const snap = await tx.get(tenantRef);
      if (!snap.exists()) {
        throw new Error("لم يتم العثور على حساب الورشة.");
      }
      const prev = snap.data() as TenantAccount;
      const beforeState = summarizeTenantState(prev);
      const afterState = summarizeTenantState({ ...prev, subscriptionStatus: "suspended" });

      tx.update(tenantRef, {
        subscriptionStatus: "suspended",
        adminNote: cleanReason,
        updatedAt: serverTimestamp(),
      });

      tx.set(doc(db, "audit_logs", logId), {
        actorUid: adminUser.uid,
        actorEmail: sanitizeStr((adminUser.email || "").toLowerCase(), BLUEPRINT_LIMITS.emailMax),
        action: "suspend_tenant",
        targetTenantId: target.ownerUid,
        details: sanitizeStr(`إيقاف حساب ${prev.email}: ${cleanReason}`, BLUEPRINT_LIMITS.adminNoteMax),
        beforeState,
        afterState,
        createdAt: serverTimestamp(),
      });
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function adminReactivateTenant(
  adminUser: User,
  target: TenantAccount,
  serverNowMs = Date.now()
): Promise<void> {
  const path = `tenants/${target.ownerUid}`;
  const logId = makeSafeDocId("log");

  try {
    await runTransaction(db, async (tx) => {
      const tenantRef = doc(db, "tenants", target.ownerUid);
      const snap = await tx.get(tenantRef);
      if (!snap.exists()) {
        throw new Error("لم يتم العثور على حساب الورشة.");
      }
      const prev = snap.data() as TenantAccount;
      const activeUntilMs = tsToMs(prev.activeUntil);
      const createdMs = tsToMs(prev.createdAt) || serverNowMs;
      const trialEndMs = createdMs + (prev.trialDays || 0) * 86400000;

      const nextStatus: TenantAccount["subscriptionStatus"] =
        activeUntilMs !== null && activeUntilMs > serverNowMs
          ? "active"
          : trialEndMs > serverNowMs
            ? "trialing"
            : "expired";

      const beforeState = summarizeTenantState(prev);
      const afterState = summarizeTenantState({ ...prev, subscriptionStatus: nextStatus });

      tx.update(tenantRef, {
        subscriptionStatus: nextStatus,
        adminNote: "تمت إعادة تفعيل الحساب من الإدارة",
        updatedAt: serverTimestamp(),
      });

      tx.set(doc(db, "audit_logs", logId), {
        actorUid: adminUser.uid,
        actorEmail: sanitizeStr((adminUser.email || "").toLowerCase(), BLUEPRINT_LIMITS.emailMax),
        action: "reactivate_tenant",
        targetTenantId: target.ownerUid,
        details: sanitizeStr(`إعادة تفعيل حساب ${prev.email} (الحالة: ${nextStatus})`, BLUEPRINT_LIMITS.adminNoteMax),
        beforeState,
        afterState,
        createdAt: serverTimestamp(),
      });
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

/**
 * مراجعة طلب تفعيل CliQ داخل معاملة ذرية واحدة:
 * تمنع الموافقة المزدوجة على نفس الطلب، وتحدّث الطلب + الاشتراك + سجل التدقيق ذرياً.
 */
export async function adminReviewActivationRequest(
  adminUser: User,
  req: ActivationRequestDoc,
  decision: "approved" | "rejected",
  durationDays: number | null,
  serverNowMs = Date.now()
): Promise<void> {
  const reqPath = `activation_requests/${req.id}`;
  const logId = makeSafeDocId("log");

  try {
    await runTransaction(db, async (tx) => {
      const reqRef = doc(db, "activation_requests", req.id);
      const tenantRef = doc(db, "tenants", req.tenantId);

      const [reqSnap, tenantSnap] = await Promise.all([tx.get(reqRef), tx.get(tenantRef)]);
      if (!reqSnap.exists()) {
        throw new Error("لم يتم العثور على طلب الدفع.");
      }
      const liveReq = reqSnap.data() as Omit<ActivationRequestDoc, "id">;
      if (liveReq.status !== "pending") {
        throw new Error("تمت معالجة هذا الطلب مسبقاً ولا يمكن تأكيده أو تغييره مرتين.");
      }

      tx.update(reqRef, {
        status: decision,
        reviewedBy: adminUser.uid,
        updatedAt: serverTimestamp(),
      });

      if (tenantSnap.exists()) {
        const prevTenant = tenantSnap.data() as TenantAccount;
        const beforeState = summarizeTenantState(prevTenant);

        if (decision === "approved") {
          const isExtraAddon = liveReq.requestType === "extra_types_addon";

          if (isExtraAddon) {
            const addedCount = Math.max(
              1,
              Math.min(50, Math.round(Number(liveReq.extraTypesCount) || DEFAULT_EXTRA_TYPES_PACK_SIZE))
            );
            const curQuota =
              typeof prevTenant.extraCustomTypesQuota === "number" ? prevTenant.extraCustomTypesQuota : 0;
            const nextQuota = Math.min(200, curQuota + addedCount);

            tx.update(tenantRef, {
              extraCustomTypesQuota: nextQuota,
              adminNote: sanitizeStr(
                `تأكيد دفع حزمة +${addedCount} أنواع مخصصة #${req.id.slice(-6)}`,
                BLUEPRINT_LIMITS.adminNoteMax
              ),
              updatedAt: serverTimestamp(),
            });

            tx.set(doc(db, "audit_logs", logId), {
              actorUid: adminUser.uid,
              actorEmail: sanitizeStr((adminUser.email || "").toLowerCase(), BLUEPRINT_LIMITS.emailMax),
              action: "approve_extra_types_addon",
              targetTenantId: req.tenantId,
              details: sanitizeStr(
                `تأكيد دفع كليك لحزمة +${addedCount} أنواع مخصصة للورشة ${liveReq.email} (الإجمالي الإضافي ${nextQuota})`,
                BLUEPRINT_LIMITS.adminNoteMax
              ),
              beforeState: `${beforeState} | extraTypes=${curQuota}`,
              afterState: `${beforeState} | extraTypes=${nextQuota}`,
              createdAt: serverTimestamp(),
            });
          } else {
            const activeUntil =
              durationDays === null
                ? null
                : Timestamp.fromMillis(serverNowMs + durationDays * 86400000);
            const cleanPlan = sanitizeStr(liveReq.planId, BLUEPRINT_LIMITS.planIdMax) || "starter";

            tx.update(tenantRef, {
              subscriptionStatus: "active",
              planId: cleanPlan,
              activeUntil,
              extraCustomTypesQuota: 0,
              adminNote: sanitizeStr(
                `تأكيد دفع كليك #${req.id.slice(-6)} (${
                  durationDays === null ? "دائم" : `${durationDays} يوم`
                })`,
                BLUEPRINT_LIMITS.adminNoteMax
              ),
              updatedAt: serverTimestamp(),
            });

            const afterState = summarizeTenantState({
              ...prevTenant,
              subscriptionStatus: "active",
              planId: cleanPlan,
              activeUntil,
            });

            tx.set(doc(db, "audit_logs", logId), {
              actorUid: adminUser.uid,
              actorEmail: sanitizeStr((adminUser.email || "").toLowerCase(), BLUEPRINT_LIMITS.emailMax),
              action: "approve_payment_request",
              targetTenantId: req.tenantId,
              details: sanitizeStr(
                `تأكيد دفع كليك للورشة ${liveReq.email} على باقة ${cleanPlan} لمدة ${
                  durationDays === null ? "دائمة" : `${durationDays} يوم`
                }`,
                BLUEPRINT_LIMITS.adminNoteMax
              ),
              beforeState,
              afterState,
              createdAt: serverTimestamp(),
            });
          }
        } else {
          let nextStatus = prevTenant.subscriptionStatus;
          if (liveReq.requestType !== "extra_types_addon" && prevTenant.subscriptionStatus === "pending_payment") {
            const createdMs = tsToMs(prevTenant.createdAt) || serverNowMs;
            const trialEndMs = createdMs + (prevTenant.trialDays || 0) * 86400000;
            nextStatus = trialEndMs > serverNowMs ? "trialing" : "expired";
            tx.update(tenantRef, {
              subscriptionStatus: nextStatus,
              adminNote: sanitizeStr(`تم رفض طلب الدفع #${req.id.slice(-6)}`, BLUEPRINT_LIMITS.adminNoteMax),
              updatedAt: serverTimestamp(),
            });
          }

          const afterState = summarizeTenantState({
            ...prevTenant,
            subscriptionStatus: nextStatus,
          });

          tx.set(doc(db, "audit_logs", logId), {
            actorUid: adminUser.uid,
            actorEmail: sanitizeStr((adminUser.email || "").toLowerCase(), BLUEPRINT_LIMITS.emailMax),
            action: "reject_payment_request",
            targetTenantId: req.tenantId,
            details: sanitizeStr(
              `رفض طلب دفع ${liveReq.email} (${liveReq.planId})`,
              BLUEPRINT_LIMITS.adminNoteMax
            ),
            beforeState,
            afterState,
            createdAt: serverTimestamp(),
          });
        }
      } else {
        tx.set(doc(db, "audit_logs", logId), {
          actorUid: adminUser.uid,
          actorEmail: sanitizeStr((adminUser.email || "").toLowerCase(), BLUEPRINT_LIMITS.emailMax),
          action: decision === "approved" ? "approve_payment_request" : "reject_payment_request",
          targetTenantId: req.tenantId,
          details: sanitizeStr(
            `${decision === "approved" ? "قبول" : "رفض"} طلب تفعيل ${liveReq.email}`,
            BLUEPRINT_LIMITS.adminNoteMax
          ),
          beforeState: "",
          afterState: "",
          createdAt: serverTimestamp(),
        });
      }
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("معالجة هذا الطلب مسبقاً")) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, reqPath);
  }
}

export async function adminSavePlan(
  adminUser: User,
  plan: SubscriptionPlan
): Promise<void> {
  const safeId = sanitizeStr(plan.id, BLUEPRINT_LIMITS.planIdMax).replace(/[^a-zA-Z0-9_\-]/g, "");
  const path = `plans/${safeId}`;
  const cleanFeatures = (plan.features || [])
    .map((f) => sanitizeStr(f, 140))
    .filter(Boolean)
    .slice(0, 12);

  const defaults = getPlanDefaultsById(plan);
  const maxCustomTypes = Math.max(-1, Math.min(500, Math.round(defaults.maxCustomTypes)));
  const maxCustomFieldsPerType = Math.max(-1, Math.min(500, Math.round(defaults.maxCustomFieldsPerType)));
  const allowExtraTypesAddon = Boolean(defaults.allowExtraTypesAddon);
  const extraTypesPackSize = allowExtraTypesAddon
    ? Math.max(1, Math.min(50, Math.round(defaults.extraTypesPackSize || DEFAULT_EXTRA_TYPES_PACK_SIZE)))
    : 0;
  const extraTypesPackPriceJod = allowExtraTypesAddon
    ? Math.max(0, Math.min(10000, Number(defaults.extraTypesPackPriceJod ?? DEFAULT_EXTRA_TYPES_PACK_PRICE_JOD) || 0))
    : 0;

  try {
    await setDoc(doc(db, "plans", safeId), {
      id: safeId,
      name: sanitizeStr(plan.name, 80) || safeId,
      priceLabel: sanitizeStr(plan.priceLabel, 60) || `${plan.priceMonthlyJod} دينار / شهرياً`,
      priceMonthlyJod: Math.max(0, Math.min(10000, Number(plan.priceMonthlyJod) || 0)),
      maxProjects: Math.max(-1, Math.min(100000, Math.round(Number(plan.maxProjects) || 0))),
      allowExport: Boolean(plan.allowExport),
      allowCustomTypes: maxCustomTypes !== 0,
      maxCustomTypes,
      maxCustomFieldsPerType,
      allowExtraTypesAddon,
      extraTypesPackSize,
      extraTypesPackPriceJod,
      active: Boolean(plan.active),
      sortOrder: Math.max(0, Math.min(100, Math.round(Number(plan.sortOrder) || 0))),
      features: cleanFeatures,
      updatedAt: serverTimestamp(),
    });
    cachedPlans = null;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
  await writeAuditLog(
    adminUser,
    "save_plan",
    safeId,
    `تحديث باقة ${plan.name} (أنواع مخصصة: ${maxCustomTypes}، علاقات/نوع: ${maxCustomFieldsPerType})`
  );
}

/** حفظ الإعدادات العامة (كليك وواتساب فقط — لا تخزن أي أسرار أو روابط Webhook) */
export async function adminSavePlatformConfig(
  adminUser: User,
  cfg: PlatformConfig
): Promise<void> {
  const path = "config/platform";
  try {
    await setDoc(doc(db, "config", "platform"), {
      whatsappPhone:
        sanitizeStr(cfg.whatsappPhone, BLUEPRINT_LIMITS.phoneMax) ||
        DEFAULT_PLATFORM_CONFIG.whatsappPhone,
      cliqAlias: sanitizeStr(cfg.cliqAlias, 100),
      cliqBankName: sanitizeStr(cfg.cliqBankName, 100),
      cliqHolderName: sanitizeStr(cfg.cliqHolderName, 120),
      trialDaysDefault: Math.max(0, Math.min(90, Math.round(Number(cfg.trialDaysDefault) || 7))),
      supportNote: sanitizeStr(cfg.supportNote, BLUEPRINT_LIMITS.adminNoteMax),
      updatedBy: adminUser.uid,
      updatedAt: serverTimestamp(),
    });
    cachedPlatformConfig = null;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
  await writeAuditLog(
    adminUser,
    "update_platform_config",
    "platform",
    `تحديث إعدادات كليك وواتساب (${cfg.whatsappPhone})`
  );
}

export const PASSWORD_RESET_TTL_MS = 10 * 60 * 1000; // 10 دقائق

export async function sendPasswordResetSafe(email: string): Promise<void> {
  auth.languageCode = "ar";
  const cleanEmail = email.trim();
  const now = Date.now();
  const actionCodeSettings = {
    url: `${window.location.origin}/?resetSentAt=${now}&resetExpiresAt=${now + PASSWORD_RESET_TTL_MS}`,
    handleCodeInApp: false,
  };
  try {
    await sendPasswordResetEmail(auth, cleanEmail, actionCodeSettings);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unauthorized-continue-uri") || msg.includes("invalid-continue-uri")) {
      await sendPasswordResetEmail(auth, cleanEmail);
      return;
    }
    throw err;
  }
}

export async function adminSendPasswordResetLink(
  adminUser: User,
  target: TenantAccount
): Promise<void> {
  await sendPasswordResetSafe(target.email);
  await writeAuditLog(
    adminUser,
    "send_password_reset",
    target.ownerUid,
    `إرسال رابط إعادة تعيين كلمة المرور إلى ${target.email}`
  );
}

/**
 * إنشاء حساب دخول بالبريد وكلمة المرور من لوحة المدير مع إرسال رسالة التوثيق تلقائياً.
 * التزاماً بسياسة الأمان: لا يُنشأ tenant ولا تبدأ التجربة إلا بعد توثيق العميل لبريده الإلكتروني.
 */
export async function adminCreateWorkshopAccount(
  adminUser: User,
  params: {
    workshopName: string;
    email: string;
    phone: string;
    password: string;
    planId: string;
    durationDays: number | null;
  }
): Promise<{ uid: string; email: string }> {
  const cleanEmail = sanitizeStr(params.email, BLUEPRINT_LIMITS.emailMax).toLowerCase();
  const cleanName = sanitizeStr(params.workshopName, BLUEPRINT_LIMITS.nameMax) || "ورشة جديدة";
  const secondaryName = `admin_create_${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, secondaryName);

  try {
    const secAuth = getAuth(secondaryApp);
    secAuth.languageCode = "ar";
    const cred = await createUserWithEmailAndPassword(secAuth, cleanEmail, params.password);
    await updateProfile(cred.user, { displayName: cleanName });
    try {
      await sendEmailVerification(cred.user);
    } catch {
      // يمكن للعميل إعادة إرسال رسالة التوثيق من شاشة التوثيق عند أول دخول
    }

    const newUid = cred.user.uid;
    await signOut(secAuth);
    await deleteApp(secondaryApp);

    await writeAuditLog(
      adminUser,
      "create_workshop_manual",
      newUid,
      `إنشاء حساب دخول للورشة ${cleanName} (${cleanEmail}) وإرسال رسالة توثيق البريد`
    );

    return { uid: newUid, email: cleanEmail };
  } catch (err) {
    try {
      await deleteApp(secondaryApp);
    } catch {
      // تجاهل أخطاء التنظيف
    }
    throw err;
  }
}

export async function sendOwnPasswordReset(email: string): Promise<void> {
  await sendPasswordResetSafe(email);
}

export async function linkPasswordToAccount(
  user: User,
  newPassword: string
): Promise<void> {
  if (!user.email) throw new Error("لا يوجد بريد إلكتروني مرتبط بالحساب.");
  const credential = EmailAuthProvider.credential(user.email, newPassword);
  try {
    await linkWithCredential(user, credential);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("requires-recent-login")) {
      await reauthenticateWithPopup(user, googleProvider);
      await linkWithCredential(user, credential);
      return;
    }
    throw err;
  }
}

export async function changeOwnPassword(
  user: User,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  if (!user.email) throw new Error("لا يوجد بريد إلكتروني مرتبط بالحساب.");
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

export async function verifyInAppResetCode(oobCode: string): Promise<string> {
  return verifyPasswordResetCode(auth, oobCode);
}

export async function confirmInAppPasswordReset(
  oobCode: string,
  newPassword: string
): Promise<void> {
  await confirmPasswordReset(auth, oobCode, newPassword);
}
