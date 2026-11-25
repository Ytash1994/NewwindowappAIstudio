import { deleteApp, initializeApp } from "firebase/app";
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signOut,
  updatePassword,
  updateProfile,
} from "firebase/auth";
import type { User } from "firebase/auth";
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import { auth, db, handleFirestoreError, OperationType } from "../firebase";
import type { AppState, SavedProject } from "../types";
import {
  BLUEPRINT_LIMITS,
  DEFAULT_PLANS,
  DEFAULT_PLATFORM_CONFIG,
  DEFAULT_TRIAL_DAYS,
  DEFAULT_WHATSAPP_PHONE,
  OWNER_ADMIN_EMAIL,
  buildExpiryReminderEmailContent,
  isOwnerAdminEmail,
  sanitizeStr,
  tsToMs,
} from "./types";
import type {
  ActivationRequestDoc,
  AuditLogDoc,
  BillingCycle,
  ExpiryAlertDoc,
  PlatformConfig,
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

export async function ensureTenantAndDefaults(
  user: User,
  initialProfile?: { workshopName?: string; phone?: string }
): Promise<TenantAccount> {
  const tenantPath = `tenants/${user.uid}`;
  const tenantRef = doc(db, "tenants", user.uid);
  const isOwner = isOwnerAdminEmail(user.email) && Boolean(user.emailVerified);

  let snap;
  try {
    snap = await getDoc(tenantRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, tenantPath);
  }

  if (!snap.exists()) {
    const email = sanitizeStr(user.email || "", BLUEPRINT_LIMITS.emailMax);
    const displayName = sanitizeStr(
      initialProfile?.workshopName || user.displayName || email.split("@")[0] || "مستخدم",
      BLUEPRINT_LIMITS.nameMax
    );
    const workshopName = sanitizeStr(
      initialProfile?.workshopName || user.displayName || email.split("@")[0] || (isOwner ? "إدارة المنصة" : "ورشتي"),
      BLUEPRINT_LIMITS.nameMax
    );
    const phone = sanitizeStr(
      initialProfile?.phone || (isOwner ? DEFAULT_PLATFORM_CONFIG.whatsappPhone : ""),
      BLUEPRINT_LIMITS.phoneMax
    );

    const payload = isOwner
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
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

    try {
      await setDoc(tenantRef, payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, tenantPath);
    }
  }

  // If the primary owner logs in, ensure platform config and default plans exist in Firestore
  if (isOwner) {
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
      // Auto-migrate previously seeded starter plan so PDF/Excel export is disabled by default
      const starterSnap = existingPlans.docs.find((d) => d.id === "starter");
      if (starterSnap) {
        const sd = starterSnap.data() as SubscriptionPlan;
        const hasLegacyFeature =
          Array.isArray(sd.features) &&
          sd.features.some((f) => f.includes("تصدير PDF و Excel ومشاركة واتساب"));
        if (sd.allowExport === true && hasLegacyFeature) {
          const updatedStarter = DEFAULT_PLANS.find((p) => p.id === "starter");
          if (updatedStarter) {
            await setDoc(doc(db, "plans", "starter"), {
              ...sd,
              allowExport: false,
              features: updatedStarter.features,
              updatedAt: serverTimestamp(),
            });
          }
        }
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
        // surfaced via onError
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
        onData(snap.data() as PlatformConfig);
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
        // handled via onError
      }
    }
  );
}

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
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  const newId = makeSafeDocId("pj");
  const path = `tenants/${uid}/projects/${newId}`;
  try {
    await setDoc(doc(db, "tenants", uid, "projects", newId), {
      ownerUid: uid,
      name: safeName,
      windowType: safeType,
      unit: snapshot.unit,
      windowCount,
      snapshot: cleanSnapshot,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return newId;
  } catch (err) {
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

export async function deleteCloudProject(uid: string, projectId: string): Promise<void> {
  const path = `tenants/${uid}/projects/${projectId}`;
  try {
    await deleteDoc(doc(db, "tenants", uid, "projects", projectId));
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
  const reqId = makeSafeDocId("req");
  const path = `activation_requests/${reqId}`;
  try {
    await setDoc(doc(db, "activation_requests", reqId), {
      tenantId: user.uid,
      ownerUid: user.uid,
      email: sanitizeStr(user.email || "", BLUEPRINT_LIMITS.emailMax),
      workshopName: sanitizeStr(params.workshopName || "ورشتي", BLUEPRINT_LIMITS.nameMax) || "ورشتي",
      phone: sanitizeStr(params.phone, BLUEPRINT_LIMITS.phoneMax),
      planId: sanitizeStr(params.planId, BLUEPRINT_LIMITS.planIdMax) || "starter",
      billingCycle: params.billingCycle,
      cliqNote: sanitizeStr(params.cliqNote, BLUEPRINT_LIMITS.noteMax),
      status: "pending",
      reviewedBy: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
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

// ==================== ADMIN SERVICES ====================

async function writeAuditLog(
  adminUser: User,
  action: string,
  targetTenantId: string,
  details: string
): Promise<void> {
  const logId = makeSafeDocId("log");
  const path = `audit_logs/${logId}`;
  try {
    await setDoc(doc(db, "audit_logs", logId), {
      actorUid: adminUser.uid,
      actorEmail: sanitizeStr(adminUser.email || "", BLUEPRINT_LIMITS.emailMax),
      action: sanitizeStr(action, 80),
      targetTenantId: sanitizeStr(targetTenantId, BLUEPRINT_LIMITS.idMax),
      details: sanitizeStr(details, BLUEPRINT_LIMITS.adminNoteMax),
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
      onData(list.slice(0, 100));
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

export async function adminActivateTenant(
  adminUser: User,
  target: TenantAccount,
  opts: { planId: string; durationDays: number | null; adminNote?: string }
): Promise<void> {
  const path = `tenants/${target.ownerUid}`;
  const activeUntil =
    opts.durationDays === null
      ? null
      : Timestamp.fromMillis(Date.now() + opts.durationDays * 86400000);
  try {
    await updateDoc(doc(db, "tenants", target.ownerUid), {
      subscriptionStatus: "active",
      planId: sanitizeStr(opts.planId, BLUEPRINT_LIMITS.planIdMax) || "starter",
      activeUntil,
      adminNote: sanitizeStr(
        opts.adminNote ?? `تفعيل عبر كليك (${opts.durationDays === null ? "دائم" : `${opts.durationDays} يوم`})`,
        BLUEPRINT_LIMITS.adminNoteMax
      ),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
  await writeAuditLog(
    adminUser,
    "activate_subscription",
    target.ownerUid,
    `تفعيل ${target.email} على باقة ${opts.planId} لمدة ${opts.durationDays === null ? "دائمة" : `${opts.durationDays} يوم`}`
  );
}

export async function adminExtendTrial(
  adminUser: User,
  target: TenantAccount,
  extraDays: number
): Promise<void> {
  const path = `tenants/${target.ownerUid}`;
  const createdMs = tsToMs(target.createdAt) || Date.now();
  const elapsedDays = Math.max(0, Math.ceil((Date.now() - createdMs) / 86400000));
  const nextTrialDays = Math.min(3650, Math.max(target.trialDays + extraDays, elapsedDays + extraDays));

  try {
    await updateDoc(doc(db, "tenants", target.ownerUid), {
      subscriptionStatus: "trialing",
      trialDays: nextTrialDays,
      adminNote: sanitizeStr(`تمديد التجربة +${extraDays} يوم`, BLUEPRINT_LIMITS.adminNoteMax),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
  await writeAuditLog(
    adminUser,
    "extend_trial",
    target.ownerUid,
    `تمديد تجربة ${target.email} بمقدار ${extraDays} يوم`
  );
}

export async function adminSuspendTenant(
  adminUser: User,
  target: TenantAccount,
  reason: string
): Promise<void> {
  const path = `tenants/${target.ownerUid}`;
  try {
    await updateDoc(doc(db, "tenants", target.ownerUid), {
      subscriptionStatus: "suspended",
      adminNote: sanitizeStr(reason || "تم إيقاف الحساب من الإدارة", BLUEPRINT_LIMITS.adminNoteMax),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
  await writeAuditLog(
    adminUser,
    "suspend_tenant",
    target.ownerUid,
    `إيقاف حساب ${target.email}: ${reason || "عدم السداد"}`
  );
}

export async function adminReviewActivationRequest(
  adminUser: User,
  req: ActivationRequestDoc,
  targetTenant: TenantAccount | undefined,
  decision: "approved" | "rejected",
  durationDays: number | null
): Promise<void> {
  const reqPath = `activation_requests/${req.id}`;
  try {
    await updateDoc(doc(db, "activation_requests", req.id), {
      status: decision,
      reviewedBy: adminUser.uid,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, reqPath);
  }

  if (decision === "approved" && targetTenant) {
    await adminActivateTenant(adminUser, targetTenant, {
      planId: req.planId,
      durationDays,
      adminNote: `موافقة على طلب كليك #${req.id.slice(-6)}`,
    });
  } else {
    await writeAuditLog(
      adminUser,
      decision === "approved" ? "approve_request" : "reject_request",
      req.tenantId,
      `${decision === "approved" ? "قبول" : "رفض"} طلب تفعيل ${req.email} (${req.planId})`
    );
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

export async function adminSavePlatformConfig(
  adminUser: User,
  cfg: PlatformConfig
): Promise<void> {
  const path = "config/platform";
  const cleanWebhook = sanitizeStr(cfg.expiryWebhookUrl || "", 300);
  const safeWebhook =
    cleanWebhook && /^https:\/\/[^\s]+$/i.test(cleanWebhook) ? cleanWebhook : "";
  const cleanAdminEmail =
    sanitizeStr(cfg.adminAlertEmail || OWNER_ADMIN_EMAIL, BLUEPRINT_LIMITS.emailMax) ||
    OWNER_ADMIN_EMAIL;

  try {
    await setDoc(doc(db, "config", "platform"), {
      whatsappPhone: sanitizeStr(cfg.whatsappPhone, BLUEPRINT_LIMITS.phoneMax) || DEFAULT_PLATFORM_CONFIG.whatsappPhone,
      cliqAlias: sanitizeStr(cfg.cliqAlias, 100),
      cliqBankName: sanitizeStr(cfg.cliqBankName, 100),
      cliqHolderName: sanitizeStr(cfg.cliqHolderName, 120),
      trialDaysDefault: Math.max(0, Math.min(90, Math.round(Number(cfg.trialDaysDefault) || 7))),
      supportNote: sanitizeStr(cfg.supportNote, BLUEPRINT_LIMITS.adminNoteMax),
      adminAlertEmail: cleanAdminEmail,
      expiryWebhookUrl: safeWebhook,
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
    `تحديث إعدادات كليك وواتساب وتنبيهات الإيميل (${cfg.whatsappPhone})`
  );
}

async function postExpiryWebhook(
  webhookUrl: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  if (!webhookUrl || !/^https:\/\/[^\s]+$/i.test(webhookUrl)) return false;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    return true;
  } catch {
    return false;
  }
}

export async function triggerExpiryAlertOnce(
  user: User,
  tenant: TenantAccount,
  access: TenantAccessEvaluation,
  config: PlatformConfig
): Promise<void> {
  if (!access.isExpiringSoon || !access.expiresAtMs) return;
  if (access.state !== "trialing" && access.state !== "active") return;

  const dayBucket = Math.floor(access.expiresAtMs / 86400000);
  const alertId = `exp_${user.uid}_${dayBucket}`.replace(/[^a-zA-Z0-9_\-]/g, "").slice(0, 128);
  const alertRef = doc(db, "expiry_alerts", alertId);
  const path = `expiry_alerts/${alertId}`;

  try {
    const existingSnap = await getDoc(alertRef);
    if (existingSnap.exists()) return;

    const adminEmail =
      sanitizeStr(config.adminAlertEmail || OWNER_ADMIN_EMAIL, BLUEPRINT_LIMITS.emailMax) ||
      OWNER_ADMIN_EMAIL;
    const isTrial = access.state === "trialing";
    const clampedHours = Math.max(0, Math.min(48, Math.round(access.hoursLeft)));

    await setDoc(alertRef, {
      tenantId: user.uid,
      ownerUid: user.uid,
      email: sanitizeStr(user.email || tenant.email, BLUEPRINT_LIMITS.emailMax),
      workshopName: sanitizeStr(tenant.workshopName || tenant.displayName, BLUEPRINT_LIMITS.nameMax),
      phone: sanitizeStr(tenant.phone || "", BLUEPRINT_LIMITS.phoneMax),
      alertType: isTrial ? "trial_expiring" : "subscription_expiring",
      expiresAt: Timestamp.fromMillis(access.expiresAtMs),
      hoursLeft: clampedHours,
      adminEmail,
      emailStatus: "pending",
      acknowledged: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const webhookUrl = (config.expiryWebhookUrl || "").trim();
    if (webhookUrl) {
      const content = buildExpiryReminderEmailContent({
        workshopName: tenant.workshopName || tenant.displayName || "ورشتي",
        userEmail: tenant.email,
        adminEmail,
        phone: tenant.phone,
        isTrial,
        remainingLabel: access.remainingLabel,
        expiresAtIso: new Date(access.expiresAtMs).toISOString().slice(0, 10),
        whatsappPhone: config.whatsappPhone || DEFAULT_WHATSAPP_PHONE,
      });
      const sent = await postExpiryWebhook(webhookUrl, {
        adminEmail,
        userEmail: tenant.email,
        workshopName: tenant.workshopName || tenant.displayName || "ورشتي",
        phone: tenant.phone || "",
        alertType: isTrial ? "trial_expiring" : "subscription_expiring",
        hoursLeft: clampedHours,
        remainingLabel: access.remainingLabel,
        expiresAtIso: new Date(access.expiresAtMs).toISOString().slice(0, 10),
        subject: content.subject,
        userBody: content.userBody,
        adminBody: content.adminBody,
      });
      await updateDoc(alertRef, {
        emailStatus: sent ? "sent" : "failed",
        hoursLeft: clampedHours,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    // Non-blocking background alert — log cleanly without crashing the calculator
    try {
      handleFirestoreError(err, OperationType.WRITE, path);
    } catch {
      // already logged
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
  existingAlertId?: string
): Promise<{ sentViaWebhook: boolean; mailtoUrl: string }> {
  const adminEmail =
    sanitizeStr(config.adminAlertEmail || OWNER_ADMIN_EMAIL, BLUEPRINT_LIMITS.emailMax) ||
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

  const webhookUrl = (config.expiryWebhookUrl || "").trim();
  const sentViaWebhook = webhookUrl
    ? await postExpiryWebhook(webhookUrl, {
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
      })
    : false;

  if (existingAlertId) {
    try {
      await updateDoc(doc(db, "expiry_alerts", existingAlertId), {
        emailStatus: sentViaWebhook ? "sent" : "manual",
        acknowledged: true,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // ignore if alert doc doesn't exist yet
    }
  }

  await writeAuditLog(
    adminUser,
    "send_expiry_reminder_email",
    target.ownerUid,
    `إرسال تنبيه قرب الانتهاء إلى ${target.email} ونسخة إلى ${adminEmail} (${sentViaWebhook ? "تلقائي" : "بريد يدوي"})`
  );

  return { sentViaWebhook, mailtoUrl: content.mailtoUrl };
}

export async function adminAcknowledgeExpiryAlert(
  adminUser: User,
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

export async function adminSendPasswordResetLink(
  adminUser: User,
  target: TenantAccount
): Promise<void> {
  await sendPasswordResetEmail(auth, target.email);
  await writeAuditLog(
    adminUser,
    "send_password_reset",
    target.ownerUid,
    `إرسال رابط إعادة تعيين كلمة المرور إلى ${target.email}`
  );
}

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
  const cleanPhone = sanitizeStr(params.phone, BLUEPRINT_LIMITS.phoneMax);
  const secondaryName = `admin_create_${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, secondaryName);

  try {
    const secAuth = getAuth(secondaryApp);
    const secDb = getFirestore(secondaryApp, firebaseConfig.firestoreDatabaseId);
    const cred = await createUserWithEmailAndPassword(secAuth, cleanEmail, params.password);
    await updateProfile(cred.user, { displayName: cleanName });

    // Create the tenant doc under the newly created user's session (matches strict self-registration rule)
    await setDoc(doc(secDb, "tenants", cred.user.uid), {
      ownerUid: cred.user.uid,
      email: cleanEmail,
      displayName: cleanName,
      workshopName: cleanName,
      phone: cleanPhone,
      role: "owner",
      subscriptionStatus: "trialing",
      planId: "trial",
      trialDays: DEFAULT_TRIAL_DAYS,
      activeUntil: null,
      adminNote: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const newUid = cred.user.uid;
    await signOut(secAuth);
    await deleteApp(secondaryApp);

    // If admin selected a paid plan immediately, activate using primary admin credentials
    if (params.planId && params.planId !== "trial") {
      await updateDoc(doc(db, "tenants", newUid), {
        subscriptionStatus: "active",
        planId: sanitizeStr(params.planId, BLUEPRINT_LIMITS.planIdMax),
        activeUntil:
          params.durationDays === null
            ? null
            : Timestamp.fromMillis(Date.now() + params.durationDays * 86400000),
        adminNote: "تم إنشاء الحساب وتفعيله يدوياً من الإدارة",
        updatedAt: serverTimestamp(),
      });
    }

    await writeAuditLog(
      adminUser,
      "create_workshop_manual",
      newUid,
      `إنشاء حساب يدوي للورشة ${cleanName} (${cleanEmail}) — الباقة: ${params.planId}`
    );

    return { uid: newUid, email: cleanEmail };
  } catch (err) {
    try {
      await deleteApp(secondaryApp);
    } catch {
      // ignore cleanup errors
    }
    throw err;
  }
}

export async function sendOwnPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
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

