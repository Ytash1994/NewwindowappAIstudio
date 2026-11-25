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
  onSnapshot,
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
  DEFAULT_PLANS,
  DEFAULT_PLATFORM_CONFIG,
  DEFAULT_PRIVATE_NOTIFICATION_CONFIG,
  DEFAULT_TRIAL_DAYS,
  DEFAULT_WHATSAPP_PHONE,
  OWNER_ADMIN_EMAIL,
  TRIAL_MAX_PROJECTS,
  buildExpiryReminderEmailContent,
  isOwnerAdminEmail,
  sanitizeStr,
  tsToMs,
} from "./types";
import type {
  ActivationRequestDoc,
  AdminRecord,
  AuditLogDoc,
  BillingCycle,
  ExpiryAlertDoc,
  PlatformConfig,
  PrivateNotificationConfig,
  SubscriptionPlan,
  TenantAccessEvaluation,
  TenantAccount,
} from "./types";

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

/** جلب فرق التوقيت مع الخادم الموثوق حتى لا يتأثر الحساب بتعديل ساعة جهاز المستخدم */
export async function fetchServerTimeOffsetMs(): Promise<number> {
  try {
    const t0 = Date.now();
    const res = await fetch("/api/server-time", { cache: "no-store" });
    if (!res.ok) return 0;
    const data = (await res.json()) as { nowMs?: number };
    const t1 = Date.now();
    if (typeof data.nowMs !== "number" || !Number.isFinite(data.nowMs)) return 0;
    const midpoint = Math.round((t0 + t1) / 2);
    return data.nowMs - midpoint;
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

  let isRegisteredAdmin = isPrimaryOwner;
  if (!isRegisteredAdmin) {
    try {
      const adminSnap = await getDoc(doc(db, "admins", user.uid));
      isRegisteredAdmin = adminSnap.exists();
    } catch {
      isRegisteredAdmin = false;
    }
  }

  let snap;
  try {
    snap = await getDoc(tenantRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, tenantPath);
  }

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
        (isRegisteredAdmin ? "إدارة المنصة" : "ورشتي"),
      BLUEPRINT_LIMITS.nameMax
    );
    const phone = sanitizeStr(
      initialProfile?.phone || (isPrimaryOwner ? DEFAULT_PLATFORM_CONFIG.whatsappPhone : ""),
      BLUEPRINT_LIMITS.phoneMax
    );

    const payload = isRegisteredAdmin
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
          adminNote: isPrimaryOwner ? "حساب مالك المنصة - مجاني دائم" : "حساب مدير منصة",
          projectCount: 0,
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
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

    try {
      await setDoc(tenantRef, payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, tenantPath);
    }
  }

  if (isPrimaryOwner) {
    await seedDefaultsIfMissing(user.uid);
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
        const legacyAdminEmail =
          typeof existingData.adminAlertEmail === "string" && existingData.adminAlertEmail.includes("@")
            ? existingData.adminAlertEmail
            : OWNER_ADMIN_EMAIL;

        // ترحيل بريد التنبيه للإعدادات الخاصة قبل تنظيف الوثيقة العامة
        const privRef = doc(db, "config_private", "notifications");
        const privSnap = await getDoc(privRef);
        if (!privSnap.exists()) {
          await setDoc(privRef, {
            adminAlertEmail: sanitizeStr(legacyAdminEmail, BLUEPRINT_LIMITS.emailMax),
            notificationsEnabled: true,
            updatedBy: adminUid,
            updatedAt: serverTimestamp(),
          });
        }

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

  // ضمان وجود وثيقة الإعدادات الخاصة بالمدير فقط
  try {
    const privRef = doc(db, "config_private", "notifications");
    const privSnap = await getDoc(privRef);
    if (!privSnap.exists()) {
      await setDoc(privRef, {
        ...DEFAULT_PRIVATE_NOTIFICATION_CONFIG,
        updatedBy: adminUid,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, "config_private/notifications");
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
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, plansPath);
  }
}

export function subscribeTenant(
  uid: string,
  onData: (tenant: TenantAccount | null) => void,
  onError?: (err: unknown) => void
): () => void {
  const path = `tenants/${uid}`;
  return onSnapshot(
    doc(db, "tenants", uid),
    (snap) => {
      onData(snap.exists() ? (snap.data() as TenantAccount) : null);
    },
    (error) => {
      if (onError) onError(error);
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch {
        // تم التمرير عبر onError
      }
    }
  );
}

export function subscribePlatformConfig(
  onData: (cfg: PlatformConfig) => void
): () => void {
  const path = "config/platform";
  return onSnapshot(
    doc(db, "config", "platform"),
    (snap) => {
      if (snap.exists()) {
        const d = snap.data() as Partial<PlatformConfig>;
        onData({
          whatsappPhone: d.whatsappPhone || DEFAULT_PLATFORM_CONFIG.whatsappPhone,
          cliqAlias: d.cliqAlias || "",
          cliqBankName: d.cliqBankName || "",
          cliqHolderName: d.cliqHolderName || "",
          trialDaysDefault:
            typeof d.trialDaysDefault === "number" ? d.trialDaysDefault : DEFAULT_TRIAL_DAYS,
          supportNote: d.supportNote || "",
          updatedBy: d.updatedBy || "system",
          updatedAt: d.updatedAt ?? null,
        });
      } else {
        onData(DEFAULT_PLATFORM_CONFIG);
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch {
        onData(DEFAULT_PLATFORM_CONFIG);
      }
    }
  );
}

export function subscribePrivateNotificationConfig(
  onData: (cfg: PrivateNotificationConfig) => void
): () => void {
  const path = "config_private/notifications";
  return onSnapshot(
    doc(db, "config_private", "notifications"),
    (snap) => {
      if (snap.exists()) {
        onData(snap.data() as PrivateNotificationConfig);
      } else {
        onData(DEFAULT_PRIVATE_NOTIFICATION_CONFIG);
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch {
        onData(DEFAULT_PRIVATE_NOTIFICATION_CONFIG);
      }
    }
  );
}

export function subscribePlans(
  isAdmin: boolean,
  onData: (plans: SubscriptionPlan[]) => void
): () => void {
  const path = "plans";
  const q = isAdmin
    ? query(collection(db, "plans"))
    : query(collection(db, "plans"), where("active", "==", true));

  return onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        onData(DEFAULT_PLANS);
        return;
      }
      const list = snap.docs
        .map((d) => d.data() as SubscriptionPlan)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        onData(DEFAULT_PLANS);
      }
    }
  );
}

export function subscribeTenantProjects(
  uid: string,
  onData: (projects: SavedProject[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const path = `tenants/${uid}/projects`;
  const q = query(collection(db, "tenants", uid, "projects"), where("ownerUid", "==", uid));
  return onSnapshot(
    q,
    (snap) => {
      const items: SavedProject[] = snap.docs
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
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        // تم التعامل معه عبر onError
      }
    }
  );
}

/**
 * حفظ مشروع سحابي داخل معاملة ذرية تفرض حد المشاريع (maxProjects) والأنواع المخصصة (allowCustomTypes)
 * بالتزامن مع قواعد Firestore.
 */
export async function saveCloudProject(
  uid: string,
  projectId: string | null,
  name: string,
  snapshot: Omit<AppState, "raw">
): Promise<string> {
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
      await updateDoc(doc(db, "tenants", uid, "projects", projectId), {
        name: safeName,
        windowType: safeType,
        unit: snapshot.unit,
        windowCount,
        snapshot: cleanSnapshot,
        updatedAt: serverTimestamp(),
      });
      return projectId;
    } catch (err) {
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
      const currentCount = typeof tenant.projectCount === "number" ? tenant.projectCount : 0;

      if (tenant.role !== "admin") {
        let maxProjects = TRIAL_MAX_PROJECTS;
        let allowCustomTypes = true;
        if (tenant.planId && tenant.planId !== "trial") {
          const planSnap = await tx.get(doc(db, "plans", tenant.planId));
          if (planSnap.exists()) {
            const p = planSnap.data() as SubscriptionPlan;
            maxProjects = p.maxProjects;
            allowCustomTypes = Boolean(p.allowCustomTypes);
          }
        }
        if (maxProjects >= 0 && currentCount >= maxProjects) {
          throw new Error(
            `وصلت إلى الحد الأقصى لعدد المشاريع في باقتك (${maxProjects} مشروع). قم بترقية الباقة لحفظ المزيد.`
          );
        }
        const hasCustomTypes = Array.isArray(cleanSnapshot.utypes) && cleanSnapshot.utypes.length > 0;
        if (hasCustomTypes && !allowCustomTypes) {
          throw new Error("باقتك الحالية لا تسمح بحفظ أنواع شبابيك مخصصة. قم بترقية الباقة.");
        }
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

      if (tenant.role !== "admin") {
        tx.update(tenantRef, {
          projectCount: currentCount + 1,
          lastProjectActionId: newId,
          updatedAt: serverTimestamp(),
        });
      }
    });
    return newId;
  } catch (err) {
    if (err instanceof Error && (err.message.includes("الحد الأقصى") || err.message.includes("باقتك الحالية"))) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("permission-denied") || msg.includes("PERMISSION_DENIED")) {
      throw new Error(
        "تعذر حفظ المشروع: انتهت مدة الاشتراك أو وصلت إلى الحد الأقصى للمشاريع في باقتك."
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
        if (tenant.role !== "admin" && currentCount > 0) {
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
 * تقديم طلب دفع يدوي عبر CliQ — ينشئ الطلب بحالة pending ويحوّل حالة الحساب إلى pending_payment
 * (دون تفعيل الاشتراك ودون تمديد التجربة المنتهية)
 */
export async function submitActivationRequest(
  user: User,
  params: {
    workshopName: string;
    phone: string;
    planId: string;
    billingCycle: BillingCycle;
    cliqNote: string;
  }
): Promise<string> {
  if (!user.emailVerified) {
    throw new Error("يجب توثيق البريد الإلكتروني قبل تقديم طلب الدفع.");
  }

  const reqId = makeSafeDocId("req");
  const path = `activation_requests/${reqId}`;
  try {
    await runTransaction(db, async (tx) => {
      const tenantRef = doc(db, "tenants", user.uid);
      const tenantSnap = await tx.get(tenantRef);
      if (!tenantSnap.exists()) {
        throw new Error("لم يتم العثور على بيانات الورشة.");
      }
      const tenant = tenantSnap.data() as TenantAccount;

      tx.set(doc(db, "activation_requests", reqId), {
        tenantId: user.uid,
        ownerUid: user.uid,
        email: sanitizeStr((user.email || "").toLowerCase(), BLUEPRINT_LIMITS.emailMax),
        workshopName:
          sanitizeStr(params.workshopName || tenant.workshopName || "ورشتي", BLUEPRINT_LIMITS.nameMax) ||
          "ورشتي",
        phone: sanitizeStr(params.phone, BLUEPRINT_LIMITS.phoneMax),
        planId: sanitizeStr(params.planId, BLUEPRINT_LIMITS.planIdMax) || "starter",
        billingCycle: params.billingCycle,
        cliqNote: sanitizeStr(params.cliqNote, BLUEPRINT_LIMITS.noteMax),
        status: "pending",
        reviewedBy: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (tenant.subscriptionStatus === "trialing" || tenant.subscriptionStatus === "expired") {
        tx.update(tenantRef, {
          subscriptionStatus: "pending_payment",
          updatedAt: serverTimestamp(),
        });
      }
    });
    return reqId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribeMyActivationRequests(
  uid: string,
  onData: (items: ActivationRequestDoc[]) => void
): () => void {
  const path = "activation_requests";
  const q = query(collection(db, "activation_requests"), where("ownerUid", "==", uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ActivationRequestDoc, "id">) }))
        .sort((a, b) => (tsToMs(b.createdAt) || 0) - (tsToMs(a.createdAt) || 0));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        onData([]);
      }
    }
  );
}

// ==================== ADMIN SERVICES (TRANSACTIONAL & AUDITED) ====================

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

export function subscribeAllTenants(
  onData: (tenants: TenantAccount[]) => void
): () => void {
  const path = "tenants";
  return onSnapshot(
    query(collection(db, "tenants")),
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as TenantAccount)
        .sort((a, b) => (tsToMs(b.createdAt) || 0) - (tsToMs(a.createdAt) || 0));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        onData([]);
      }
    }
  );
}

export function subscribeAdditionalAdmins(
  onData: (admins: AdminRecord[]) => void
): () => void {
  const path = "admins";
  return onSnapshot(
    query(collection(db, "admins")),
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as AdminRecord)
        .sort((a, b) => (tsToMs(b.createdAt) || 0) - (tsToMs(a.createdAt) || 0));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        onData([]);
      }
    }
  );
}

export function subscribeAllActivationRequests(
  onData: (items: ActivationRequestDoc[]) => void
): () => void {
  const path = "activation_requests";
  return onSnapshot(
    query(collection(db, "activation_requests")),
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ActivationRequestDoc, "id">) }))
        .sort((a, b) => (tsToMs(b.createdAt) || 0) - (tsToMs(a.createdAt) || 0));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        onData([]);
      }
    }
  );
}

export function subscribeAuditLogs(onData: (logs: AuditLogDoc[]) => void): () => void {
  const path = "audit_logs";
  return onSnapshot(
    query(collection(db, "audit_logs"), orderBy("createdAt", "desc")),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditLogDoc, "id">) }));
      onData(list.slice(0, 120));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        onData([]);
      }
    }
  );
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
          const activeUntil =
            durationDays === null
              ? null
              : Timestamp.fromMillis(serverNowMs + durationDays * 86400000);
          const cleanPlan = sanitizeStr(liveReq.planId, BLUEPRINT_LIMITS.planIdMax) || "starter";

          tx.update(tenantRef, {
            subscriptionStatus: "active",
            planId: cleanPlan,
            activeUntil,
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
        } else {
          // عند رفض الطلب: إذا كانت الحالة pending_payment نعيدها لحالتها الحقيقية (trialing أو expired)
          let nextStatus = prevTenant.subscriptionStatus;
          if (prevTenant.subscriptionStatus === "pending_payment") {
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

/** إضافة مدير إضافي من قِبل مالك المنصة الأساسي فقط */
export async function adminAddAdditionalAdmin(
  ownerUser: User,
  target: TenantAccount
): Promise<void> {
  if (!isOwnerAdminEmail(ownerUser.email) || !ownerUser.emailVerified) {
    throw new Error("إدارة المدراء الإضافيين متاحة لمالك المنصة الأساسي فقط.");
  }
  const logId = makeSafeDocId("log");
  await runTransaction(db, async (tx) => {
    const adminRef = doc(db, "admins", target.ownerUid);
    const tenantRef = doc(db, "tenants", target.ownerUid);
    const tenantSnap = await tx.get(tenantRef);
    const prev = tenantSnap.exists() ? (tenantSnap.data() as TenantAccount) : target;

    tx.set(adminRef, {
      uid: target.ownerUid,
      email: sanitizeStr(target.email.toLowerCase(), BLUEPRINT_LIMITS.emailMax),
      createdAt: serverTimestamp(),
    });

    if (tenantSnap.exists()) {
      tx.update(tenantRef, {
        role: "admin",
        subscriptionStatus: "active",
        adminNote: "تم منحه صلاحية مدير منصة",
        updatedAt: serverTimestamp(),
      });
    }

    tx.set(doc(db, "audit_logs", logId), {
      actorUid: ownerUser.uid,
      actorEmail: sanitizeStr((ownerUser.email || "").toLowerCase(), BLUEPRINT_LIMITS.emailMax),
      action: "grant_admin",
      targetTenantId: target.ownerUid,
      details: sanitizeStr(`منح صلاحية مدير إضافي لـ ${target.email}`, BLUEPRINT_LIMITS.adminNoteMax),
      beforeState: summarizeTenantState(prev),
      afterState: summarizeTenantState({ ...prev, role: "admin", subscriptionStatus: "active" }),
      createdAt: serverTimestamp(),
    });
  });
}

/** سحب صلاحية مدير إضافي من قِبل مالك المنصة الأساسي فقط */
export async function adminRemoveAdditionalAdmin(
  ownerUser: User,
  adminUid: string,
  adminEmail: string
): Promise<void> {
  if (!isOwnerAdminEmail(ownerUser.email) || !ownerUser.emailVerified) {
    throw new Error("إدارة المدراء الإضافيين متاحة لمالك المنصة الأساسي فقط.");
  }
  if (adminUid === ownerUser.uid || isOwnerAdminEmail(adminEmail)) {
    throw new Error("لا يمكن سحب صلاحية مالك المنصة الأساسي.");
  }
  const logId = makeSafeDocId("log");
  await runTransaction(db, async (tx) => {
    const adminRef = doc(db, "admins", adminUid);
    const tenantRef = doc(db, "tenants", adminUid);
    const tenantSnap = await tx.get(tenantRef);

    tx.delete(adminRef);
    if (tenantSnap.exists()) {
      const prev = tenantSnap.data() as TenantAccount;
      tx.update(tenantRef, {
        role: "owner",
        adminNote: "تم سحب صلاحية المدير",
        updatedAt: serverTimestamp(),
      });
      tx.set(doc(db, "audit_logs", logId), {
        actorUid: ownerUser.uid,
        actorEmail: sanitizeStr((ownerUser.email || "").toLowerCase(), BLUEPRINT_LIMITS.emailMax),
        action: "revoke_admin",
        targetTenantId: adminUid,
        details: sanitizeStr(`سحب صلاحية المدير من ${adminEmail}`, BLUEPRINT_LIMITS.adminNoteMax),
        beforeState: summarizeTenantState(prev),
        afterState: summarizeTenantState({ ...prev, role: "owner" }),
        createdAt: serverTimestamp(),
      });
    }
  });
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

  try {
    await setDoc(doc(db, "plans", safeId), {
      id: safeId,
      name: sanitizeStr(plan.name, 80) || safeId,
      priceLabel: sanitizeStr(plan.priceLabel, 60) || `${plan.priceMonthlyJod} دينار / شهرياً`,
      priceMonthlyJod: Math.max(0, Math.min(10000, Number(plan.priceMonthlyJod) || 0)),
      maxProjects: Math.max(-1, Math.min(100000, Math.round(Number(plan.maxProjects) || 0))),
      allowExport: Boolean(plan.allowExport),
      allowCustomTypes: Boolean(plan.allowCustomTypes),
      active: Boolean(plan.active),
      sortOrder: Math.max(0, Math.min(100, Math.round(Number(plan.sortOrder) || 0))),
      features: cleanFeatures,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
  await writeAuditLog(adminUser, "save_plan", safeId, `تحديث باقة ${plan.name} (${plan.priceLabel})`);
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

/** حفظ إعدادات التنبيهات الخاصة بالمدير فقط في config_private/notifications */
export async function adminSavePrivateNotificationConfig(
  adminUser: User,
  cfg: PrivateNotificationConfig
): Promise<void> {
  const path = "config_private/notifications";
  const cleanAdminEmail =
    sanitizeStr(cfg.adminAlertEmail || OWNER_ADMIN_EMAIL, BLUEPRINT_LIMITS.emailMax).toLowerCase() ||
    OWNER_ADMIN_EMAIL;
  try {
    await setDoc(doc(db, "config_private", "notifications"), {
      adminAlertEmail: cleanAdminEmail,
      notificationsEnabled: Boolean(cfg.notificationsEnabled),
      updatedBy: adminUser.uid,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
  await writeAuditLog(
    adminUser,
    "update_private_notifications_config",
    "notifications",
    `تحديث إعدادات تنبيهات الإدارة الخاصة (${cleanAdminEmail})`
  );
}

/** فحص حالة ضبط EXPIRY_WEBHOOK_URL على الخادم (للمدير الموثّق فقط) */
export async function fetchNotificationWebhookStatus(
  adminUser: User
): Promise<{ webhookConfigured: boolean; secretConfigured: boolean }> {
  try {
    const idToken = await adminUser.getIdToken();
    const res = await fetch("/api/notifications/status", {
      method: "GET",
      headers: { Authorization: `Bearer ${idToken}` },
      cache: "no-store",
    });
    if (!res.ok) return { webhookConfigured: false, secretConfigured: false };
    const data = (await res.json()) as {
      webhookConfigured?: boolean;
      secretConfigured?: boolean;
    };
    return {
      webhookConfigured: Boolean(data.webhookConfigured),
      secretConfigured: Boolean(data.secretConfigured),
    };
  } catch {
    return { webhookConfigured: false, secretConfigured: false };
  }
}

/** إرسال تنبيه قرب الانتهاء عبر خادم Express المحمي مع التحقق الفعلي من الاستجابة */
async function dispatchExpiryNotificationViaServer(
  user: User,
  payload: Record<string, unknown>
): Promise<{ delivered: boolean; status: "sent" | "failed" | "unconfigured"; error?: string }> {
  try {
    const idToken = await user.getIdToken();
    const resp = await fetch("/api/notifications/expiry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });
    const data = (await resp.json().catch(() => ({}))) as {
      delivered?: boolean;
      status?: "sent" | "failed" | "unconfigured";
      error?: string;
    };
    if (resp.ok && data.delivered) {
      return { delivered: true, status: "sent" };
    }
    return {
      delivered: false,
      status: data.status === "unconfigured" ? "unconfigured" : "failed",
      error: data.error,
    };
  } catch {
    return {
      delivered: false,
      status: "failed",
      error: "تعذر الاتصال بخادم الإشعارات.",
    };
  }
}

export async function triggerExpiryAlertOnce(
  user: User,
  tenant: TenantAccount,
  access: TenantAccessEvaluation,
  config: PlatformConfig
): Promise<void> {
  if (!user.emailVerified) return;
  if (!access.isExpiringSoon || !access.expiresAtMs) return;
  if (access.state !== "trialing" && access.state !== "active") return;

  const dayBucket = Math.floor(access.expiresAtMs / 86400000);
  const alertId = `exp_${user.uid}_${dayBucket}`.replace(/[^a-zA-Z0-9_\-]/g, "").slice(0, 128);
  const alertRef = doc(db, "expiry_alerts", alertId);
  const path = `expiry_alerts/${alertId}`;

  try {
    const existingSnap = await getDoc(alertRef);
    if (existingSnap.exists()) return;

    const isTrial = access.state === "trialing";
    const clampedHours = Math.max(0, Math.min(48, Math.round(access.hoursLeft)));

    await setDoc(alertRef, {
      tenantId: user.uid,
      ownerUid: user.uid,
      email: sanitizeStr((user.email || tenant.email).toLowerCase(), BLUEPRINT_LIMITS.emailMax),
      workshopName: sanitizeStr(tenant.workshopName || tenant.displayName, BLUEPRINT_LIMITS.nameMax),
      phone: sanitizeStr(tenant.phone || "", BLUEPRINT_LIMITS.phoneMax),
      alertType: isTrial ? "trial_expiring" : "subscription_expiring",
      expiresAt: Timestamp.fromMillis(access.expiresAtMs),
      hoursLeft: clampedHours,
      adminEmail: OWNER_ADMIN_EMAIL,
      emailStatus: "pending",
      acknowledged: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const expiresAtIso = new Date(access.expiresAtMs).toISOString().slice(0, 10);
    const content = buildExpiryReminderEmailContent({
      workshopName: tenant.workshopName || tenant.displayName || "ورشتي",
      userEmail: tenant.email,
      adminEmail: OWNER_ADMIN_EMAIL,
      phone: tenant.phone,
      isTrial,
      remainingLabel: access.remainingLabel,
      expiresAtIso,
      whatsappPhone: config.whatsappPhone || DEFAULT_WHATSAPP_PHONE,
    });

    const result = await dispatchExpiryNotificationViaServer(user, {
      alertId,
      tenantId: user.uid,
      adminEmail: OWNER_ADMIN_EMAIL,
      userEmail: tenant.email,
      workshopName: tenant.workshopName || tenant.displayName || "ورشتي",
      phone: tenant.phone || "",
      alertType: isTrial ? "trial_expiring" : "subscription_expiring",
      hoursLeft: clampedHours,
      remainingLabel: access.remainingLabel,
      expiresAtIso,
      subject: content.subject,
      userBody: content.userBody,
      adminBody: content.adminBody,
    });

    if (result.status !== "unconfigured") {
      await updateDoc(alertRef, {
        emailStatus: result.delivered ? "sent" : "failed",
        hoursLeft: clampedHours,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    try {
      handleFirestoreError(err, OperationType.WRITE, path);
    } catch {
      // مسجّل بالفعل بدون تعطيل الواجهة
    }
  }
}

export function subscribeAllExpiryAlerts(
  onData: (items: ExpiryAlertDoc[]) => void
): () => void {
  const path = "expiry_alerts";
  return onSnapshot(
    query(collection(db, "expiry_alerts")),
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ExpiryAlertDoc, "id">) }))
        .sort((a, b) => (tsToMs(b.createdAt) || 0) - (tsToMs(a.createdAt) || 0));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        onData([]);
      }
    }
  );
}

export async function adminDispatchExpiryEmail(
  adminUser: User,
  target: TenantAccount,
  access: TenantAccessEvaluation,
  config: PlatformConfig,
  privateConfig: PrivateNotificationConfig,
  existingAlertId?: string
): Promise<{
  sentViaServer: boolean;
  status: "sent" | "failed" | "unconfigured";
  error?: string;
  mailtoUrl: string;
}> {
  const adminEmail =
    sanitizeStr(privateConfig.adminAlertEmail || OWNER_ADMIN_EMAIL, BLUEPRINT_LIMITS.emailMax) ||
    OWNER_ADMIN_EMAIL;
  const isTrial = access.state === "trialing";
  const expiresAtIso = access.expiresAtMs
    ? new Date(access.expiresAtMs).toISOString().slice(0, 10)
    : "قريباً";

  const content = buildExpiryReminderEmailContent({
    workshopName: target.workshopName || target.displayName || "ورشتي",
    userEmail: target.email,
    adminEmail,
    phone: target.phone,
    isTrial,
    remainingLabel: access.remainingLabel,
    expiresAtIso,
    whatsappPhone: config.whatsappPhone || DEFAULT_WHATSAPP_PHONE,
  });

  const alertId =
    existingAlertId ||
    `exp_${target.ownerUid}_${Math.floor((access.expiresAtMs || Date.now()) / 86400000)}`;

  const result = await dispatchExpiryNotificationViaServer(adminUser, {
    alertId,
    tenantId: target.ownerUid,
    adminEmail,
    userEmail: target.email,
    workshopName: target.workshopName || target.displayName || "ورشتي",
    phone: target.phone || "",
    alertType: isTrial ? "trial_expiring" : "subscription_expiring",
    hoursLeft: Math.max(0, Math.min(48, Math.round(access.hoursLeft))),
    remainingLabel: access.remainingLabel,
    expiresAtIso,
    subject: content.subject,
    userBody: content.userBody,
    adminBody: content.adminBody,
    forceResend: true,
  });

  if (existingAlertId) {
    try {
      await updateDoc(doc(db, "expiry_alerts", existingAlertId), {
        emailStatus: result.delivered
          ? "sent"
          : result.status === "unconfigured"
            ? "manual"
            : "failed",
        acknowledged: true,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // تجاهل إن لم توجد الوثيقة
    }
  }

  await writeAuditLog(
    adminUser,
    "send_expiry_reminder_email",
    target.ownerUid,
    `إرسال تنبيه قرب الانتهاء إلى ${target.email} ونسخة إلى ${adminEmail} (${
      result.delivered ? "إرسال مؤكد من الخادم" : result.status === "unconfigured" ? "بريد يدوي" : "فشل الإرسال"
    })`
  );

  return {
    sentViaServer: result.delivered,
    status: result.status,
    error: result.error,
    mailtoUrl: content.mailtoUrl,
  };
}

export async function adminAcknowledgeExpiryAlert(
  _adminUser: User,
  alertId: string
): Promise<void> {
  const path = `expiry_alerts/${alertId}`;
  try {
    await updateDoc(doc(db, "expiry_alerts", alertId), {
      acknowledged: true,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
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
