import type { Timestamp } from "firebase/firestore";
import type { AppState, UnitCode } from "../types";

export const OWNER_ADMIN_EMAIL = "xtashtoush@gmail.com";
export const DEFAULT_WHATSAPP_PHONE = "0798904182";
export const DEFAULT_TRIAL_DAYS = 7;
export const TRIAL_MAX_PROJECTS = 25;
export const TRIAL_MAX_CUSTOM_TYPES = 0;
export const TRIAL_MAX_CUSTOM_FIELDS_PER_TYPE = 2;
export const LAUNCH_MAX_CUSTOM_TYPES = 10;
export const DEFAULT_EXTRA_TYPES_PACK_SIZE = 5;
export const DEFAULT_EXTRA_TYPES_PACK_PRICE_JOD = 10;

export type SubscriptionStatus =
  | "trialing"
  | "pending_payment"
  | "active"
  | "expired"
  | "suspended";
export type BillingCycle = "monthly" | "quarterly" | "yearly";
export const ALLOWED_SUBSCRIPTION_DAYS = [30, 90, 365] as const;
export type AllowedSubscriptionDays = (typeof ALLOWED_SUBSCRIPTION_DAYS)[number];
export const ALLOWED_TRIAL_EXTENSION_DAYS = [3, 7, 14, 30] as const;
export type AllowedTrialExtensionDays = (typeof ALLOWED_TRIAL_EXTENSION_DAYS)[number];
export type ActivationStatus = "pending" | "approved" | "rejected";
export type ActivationRequestType = "subscription" | "extra_types_addon";
export type TenantRole = "owner" | "admin";

/** الإعدادات العامة المتاحة للمستخدمين الموثّقين (كليك وواتساب فقط — بدون أي أسرار أو روابط Webhook) */
export interface PlatformConfig {
  whatsappPhone: string;
  cliqAlias: string;
  cliqBankName: string;
  cliqHolderName: string;
  trialDaysDefault: number;
  supportNote: string;
  updatedBy: string;
  updatedAt?: Timestamp | null;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  priceLabel: string;
  priceMonthlyJod: number;
  maxProjects: number; // -1 يعني غير محدود
  allowExport: boolean;
  allowCustomTypes: boolean;
  maxCustomTypes?: number; // 0 ممنوع، -1 غير محدود
  maxCustomFieldsPerType?: number; // عدد العلاقات/الخانات الجديدة المسموحة لكل نوع (-1 غير محدود)
  allowExtraTypesAddon?: boolean; // متاح للباقة الأخيرة فقط (حزمة أنواع إضافية مرة واحدة مع الاشتراك)
  extraTypesPackSize?: number; // عدد الأنواع الإضافية في الحزمة الواحدة (افتراضياً 5)
  extraTypesPackPriceJod?: number; // السعر لمرة واحدة مع الاشتراك الحالي (افتراضياً 10 دينار)
  active: boolean;
  sortOrder: number;
  features: string[];
  updatedAt?: Timestamp | null;
}

export interface TenantAccount {
  ownerUid: string;
  email: string;
  displayName: string;
  workshopName: string;
  phone: string;
  role: TenantRole;
  subscriptionStatus: SubscriptionStatus;
  planId: string;
  trialDays: number;
  /** وقت بداية التمديد الإداري للتجربة المعتمد من الخادم (serverTimestamp / request.time) */
  trialExtendedAt?: Timestamp | null;
  /** مدة التمديد الإداري للتجربة بالأيام المعتمدة في القواعد: 3 أو 7 أو 14 أو 30 */
  trialExtensionDays?: AllowedTrialExtensionDays | number | null;
  /** وقت التفعيل الرسمي المعتمد من الخادم (serverTimestamp / request.time) للحسابات الجديدة والمجددة */
  activatedAt?: Timestamp | null;
  /** مدة الاشتراك بالأيام المعتمدة في القواعد: 30 أو 90 أو 365 */
  subscriptionDays?: AllowedSubscriptionDays | number | null;
  /** حقل قديم للتوافق مع الحسابات السابقة فقط — يُصفّر إلى null عند كل تفعيل أو تجديد جديد */
  activeUntil: Timestamp | null;
  adminNote: string;
  projectCount?: number;
  lastProjectActionId?: string;
  /** حصة الأنواع الإضافية المدفوعة للاشتراك الحالي فقط (تنطبق على الباقة الأخيرة وتُصفّر عند التجديد) */
  extraCustomTypesQuota?: number;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface CloudProjectDoc {
  id: string;
  ownerUid: string;
  name: string;
  windowType: string;
  unit: UnitCode;
  windowCount: number;
  snapshot: Omit<AppState, "raw">;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface ActivationRequestDoc {
  id: string;
  tenantId: string;
  ownerUid: string;
  email: string;
  workshopName: string;
  phone: string;
  planId: string;
  billingCycle: BillingCycle;
  cliqNote: string;
  status: ActivationStatus;
  reviewedBy: string;
  requestType?: ActivationRequestType;
  extraTypesCount?: number;
  addonPriceJod?: number;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface AuditLogDoc {
  id: string;
  actorUid: string;
  actorEmail: string;
  action: string;
  targetTenantId: string;
  details: string;
  beforeState?: string;
  afterState?: string;
  createdAt: Timestamp | null;
}

export interface TenantAccessEvaluation {
  allowed: boolean;
  state: "owner_free" | "active" | "trialing" | "pending_payment" | "expired" | "suspended";
  hasPendingPayment: boolean;
  daysLeft: number;
  hoursLeft: number;
  trialEndsAtMs: number | null;
  activeUntilMs: number | null;
  expiresAtMs: number | null;
  isExpiringSoon: boolean;
  remainingLabel: string;
}

export interface ResolvedPlanLimits {
  baseMaxCustomTypes: number; // -1 غير محدود
  extraTypesQuota: number;
  maxCustomTypes: number; // -1 غير محدود
  maxCustomFieldsPerType: number; // -1 غير محدود
  allowReorder: true; // تغيير الترتيب مسموح دائماً لجميع العلاقات في كل الباقات
  allowImportExport: boolean; // استيراد وتصدير الأنواع والقياسات (مقفل في التجربة والباقة الأولى، ومسموح بدءاً من الباقة الثانية)
  canRequestExtraTypesAddon: boolean;
  extraTypesPackSize: number;
  extraTypesPackPriceJod: number;
}

export const EXPIRY_WARNING_MS = 2 * 86400000; // أقل من يومين (48 ساعة)

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  whatsappPhone: DEFAULT_WHATSAPP_PHONE,
  cliqAlias: "يُطلب عبر واتساب قبل التحويل",
  cliqBankName: "تحويل فوري عبر كليك (CliQ)",
  cliqHolderName: "إدارة حاسبة القياسات",
  trialDaysDefault: DEFAULT_TRIAL_DAYS,
  supportNote: "بعد التحويل عبر كليك أرسل صورة الحوالة وبريد حسابك على الواتساب ليتم التفعيل فوراً.",
  updatedBy: "system",
};

export const DEFAULT_PLANS: SubscriptionPlan[] = [
  {
    id: "starter",
    name: "الباقة الأساسية",
    priceLabel: "10 دينار / شهرياً",
    priceMonthlyJod: 10,
    maxProjects: 25,
    allowExport: false,
    allowCustomTypes: false,
    maxCustomTypes: 0,
    maxCustomFieldsPerType: 2,
    allowExtraTypesAddon: false,
    extraTypesPackSize: 0,
    extraTypesPackPriceJod: 0,
    active: true,
    sortOrder: 1,
    features: [
      "الأنواع الأساسية الأربعة الموجودة فقط (بدون إضافة أنواع جديدة)",
      "إضافة علاقتين (خانتين) جديدتين كحد أقصى لكل نوع",
      "تغيير ترتيب جميع العلاقات مسموح بالكامل",
      "حفظ حتى 25 مشروعاً سحابياً · نسخ ولصق القياسات فقط (بدون استيراد أو تصدير للأنواع أو القياسات)",
    ],
  },
  {
    id: "pro",
    name: "الباقة الاحترافية",
    priceLabel: "20 دينار / شهرياً",
    priceMonthlyJod: 20,
    maxProjects: 150,
    allowExport: true,
    allowCustomTypes: true,
    maxCustomTypes: 2,
    maxCustomFieldsPerType: 5,
    allowExtraTypesAddon: false,
    extraTypesPackSize: 0,
    extraTypesPackPriceJod: 0,
    active: true,
    sortOrder: 2,
    features: [
      "إضافة حتى نوعين شبابيك جديدين مخصصين للورشة",
      "إضافة حتى 5 علاقات (خانات) جديدة لكل نوع",
      "تغيير ترتيب جميع العلاقات مسموح بالكامل",
      "حفظ حتى 150 مشروعاً سحابياً + استيراد وتصدير الأنواع والقياسات (PDF و Excel و JSON)",
    ],
  },
  {
    id: "business",
    name: "باقة الورش والمصانع",
    priceLabel: "35 دينار / شهرياً",
    priceMonthlyJod: 35,
    maxProjects: -1,
    allowExport: true,
    allowCustomTypes: true,
    maxCustomTypes: 5,
    maxCustomFieldsPerType: -1,
    allowExtraTypesAddon: true,
    extraTypesPackSize: DEFAULT_EXTRA_TYPES_PACK_SIZE,
    extraTypesPackPriceJod: DEFAULT_EXTRA_TYPES_PACK_PRICE_JOD,
    active: true,
    sortOrder: 3,
    features: [
      "إضافة حتى 5 أنواع شبابيك جديدة (+ طلب حزم إضافية مقابل 10 دنانير لمرة واحدة مع الاشتراك)",
      "إضافة علاقات وخانات جديدة غير محدودة لكل نوع",
      "تغيير ترتيب جميع العلاقات مسموح بالكامل",
      "مشاريع سحابية غير محدودة + استيراد وتصدير الأنواع والقياسات (PDF و Excel و JSON) ودعم واتساب",
    ],
  },
];

/** استنتاج حدود الباقة بدقة مع توافق كامل للوثائق القديمة التي لا تحتوي الحقول الجديدة بعد */
export function getPlanDefaultsById(plan?: Partial<SubscriptionPlan> | null): {
  maxCustomTypes: number;
  maxCustomFieldsPerType: number;
  allowExtraTypesAddon: boolean;
  extraTypesPackSize: number;
  extraTypesPackPriceJod: number;
} {
  const id = (plan?.id || "").trim().toLowerCase();
  const fallback =
    DEFAULT_PLANS.find((p) => p.id === id) ||
    (id === "trial"
      ? {
          maxCustomTypes: TRIAL_MAX_CUSTOM_TYPES,
          maxCustomFieldsPerType: TRIAL_MAX_CUSTOM_FIELDS_PER_TYPE,
          allowExtraTypesAddon: false,
          extraTypesPackSize: 0,
          extraTypesPackPriceJod: 0,
        }
      : {
          maxCustomTypes: plan?.allowCustomTypes === false ? 0 : 2,
          maxCustomFieldsPerType: 5,
          allowExtraTypesAddon: false,
          extraTypesPackSize: DEFAULT_EXTRA_TYPES_PACK_SIZE,
          extraTypesPackPriceJod: DEFAULT_EXTRA_TYPES_PACK_PRICE_JOD,
        });

  const maxCustomTypes =
    typeof plan?.maxCustomTypes === "number" && Number.isFinite(plan.maxCustomTypes)
      ? Math.round(plan.maxCustomTypes)
      : fallback.maxCustomTypes ?? 0;

  const maxCustomFieldsPerType =
    typeof plan?.maxCustomFieldsPerType === "number" && Number.isFinite(plan.maxCustomFieldsPerType)
      ? Math.round(plan.maxCustomFieldsPerType)
      : fallback.maxCustomFieldsPerType ?? 2;

  const allowExtraTypesAddon =
    typeof plan?.allowExtraTypesAddon === "boolean"
      ? plan.allowExtraTypesAddon
      : Boolean(fallback.allowExtraTypesAddon);

  const extraTypesPackSize =
    typeof plan?.extraTypesPackSize === "number" && plan.extraTypesPackSize > 0
      ? Math.round(plan.extraTypesPackSize)
      : fallback.extraTypesPackSize || DEFAULT_EXTRA_TYPES_PACK_SIZE;

  const extraTypesPackPriceJod =
    typeof plan?.extraTypesPackPriceJod === "number" && plan.extraTypesPackPriceJod >= 0
      ? plan.extraTypesPackPriceJod
      : fallback.extraTypesPackPriceJod ?? DEFAULT_EXTRA_TYPES_PACK_PRICE_JOD;

  return {
    maxCustomTypes,
    maxCustomFieldsPerType,
    allowExtraTypesAddon,
    extraTypesPackSize,
    extraTypesPackPriceJod,
  };
}

/** حساب صلاحيات الأنواع المخصصة والعلاقات الجديدة للورشة الحالية */
export function resolvePlanLimits(
  tenant: TenantAccount | null,
  plan: SubscriptionPlan | null,
  isAdmin: boolean
): ResolvedPlanLimits {
  if (isAdmin || (tenant && isOwnerAdminEmail(tenant.email))) {
    return {
      baseMaxCustomTypes: LAUNCH_MAX_CUSTOM_TYPES,
      extraTypesQuota: 0,
      maxCustomTypes: LAUNCH_MAX_CUSTOM_TYPES,
      maxCustomFieldsPerType: -1,
      allowReorder: true,
      allowImportExport: true,
      canRequestExtraTypesAddon: false,
      extraTypesPackSize: DEFAULT_EXTRA_TYPES_PACK_SIZE,
      extraTypesPackPriceJod: DEFAULT_EXTRA_TYPES_PACK_PRICE_JOD,
    };
  }

  if (!tenant || tenant.planId === "trial" || tenant.subscriptionStatus !== "active") {
    return {
      baseMaxCustomTypes: TRIAL_MAX_CUSTOM_TYPES,
      extraTypesQuota: 0,
      maxCustomTypes: TRIAL_MAX_CUSTOM_TYPES,
      maxCustomFieldsPerType: TRIAL_MAX_CUSTOM_FIELDS_PER_TYPE,
      allowReorder: true,
      allowImportExport: false,
      canRequestExtraTypesAddon: false,
      extraTypesPackSize: DEFAULT_EXTRA_TYPES_PACK_SIZE,
      extraTypesPackPriceJod: DEFAULT_EXTRA_TYPES_PACK_PRICE_JOD,
    };
  }

  const resolved = getPlanDefaultsById(plan || { id: tenant.planId });
  const fallbackPlan = DEFAULT_PLANS.find((p) => p.id === (plan?.id || tenant.planId));
  const allowImportExport =
    typeof plan?.allowExport === "boolean"
      ? plan.allowExport
      : Boolean(fallbackPlan?.allowExport);
  const baseMaxCustomTypes =
    resolved.maxCustomTypes < 0
      ? LAUNCH_MAX_CUSTOM_TYPES
      : Math.min(LAUNCH_MAX_CUSTOM_TYPES, Math.max(0, resolved.maxCustomTypes));

  const rawExtraQuota =
    resolved.allowExtraTypesAddon &&
    typeof tenant.extraCustomTypesQuota === "number" &&
    tenant.extraCustomTypesQuota > 0
      ? Math.round(tenant.extraCustomTypesQuota)
      : 0;

  const maxExtraAllowed = Math.max(0, LAUNCH_MAX_CUSTOM_TYPES - baseMaxCustomTypes);
  const extraTypesQuota = Math.min(rawExtraQuota, maxExtraAllowed);
  const maxCustomTypes = Math.min(LAUNCH_MAX_CUSTOM_TYPES, baseMaxCustomTypes + extraTypesQuota);
  const remainingAddonSlots = Math.max(0, LAUNCH_MAX_CUSTOM_TYPES - maxCustomTypes);
  const effectivePackSize =
    remainingAddonSlots > 0
      ? Math.min(resolved.extraTypesPackSize, remainingAddonSlots)
      : 0;

  return {
    baseMaxCustomTypes,
    extraTypesQuota,
    maxCustomTypes,
    maxCustomFieldsPerType: resolved.maxCustomFieldsPerType,
    allowReorder: true,
    allowImportExport,
    canRequestExtraTypesAddon: resolved.allowExtraTypesAddon && remainingAddonSlots > 0,
    extraTypesPackSize: effectivePackSize || resolved.extraTypesPackSize,
    extraTypesPackPriceJod: resolved.extraTypesPackPriceJod,
  };
}

export const BILLING_CYCLE_LABELS: Record<
  BillingCycle,
  { label: string; months: number; days: AllowedSubscriptionDays }
> = {
  monthly: { label: "شهري (30 يوم)", months: 1, days: 30 },
  quarterly: { label: "3 أشهر (90 يوم)", months: 3, days: 90 },
  yearly: { label: "سنوي (365 يوم)", months: 12, days: 365 },
};

export function isAllowedSubscriptionDays(days: unknown): days is AllowedSubscriptionDays {
  return (
    typeof days === "number" &&
    Number.isInteger(days) &&
    (days === 30 || days === 90 || days === 365)
  );
}

export function isAllowedTrialExtensionDays(days: unknown): days is AllowedTrialExtensionDays {
  return (
    typeof days === "number" &&
    Number.isInteger(days) &&
    (days === 3 || days === 7 || days === 14 || days === 30)
  );
}

export const BLUEPRINT_LIMITS = {
  idMax: 128,
  planIdMax: 40,
  emailMax: 200,
  nameMax: 120,
  phoneMax: 30,
  noteMax: 300,
  adminNoteMax: 500,
  windowTypeMax: 100,
  stateSnapMax: 600,
};

export function sanitizeStr(val: string, maxLen: number): string {
  return String(val || "").replace(/[\u0000-\u001F]/g, "").trim().slice(0, maxLen);
}

export function isOwnerAdminEmail(email?: string | null): boolean {
  return Boolean(email && email.trim().toLowerCase() === OWNER_ADMIN_EMAIL.toLowerCase());
}

export function tsToMs(ts?: Timestamp | null): number | null {
  if (!ts) return null;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  return null;
}

/**
 * استخراج وقت انتهاء الاشتراك المدفوع بالمللي ثانية:
 * - الحسابات الجديدة/المجددة (activatedAt + subscriptionDays): تُحسب حصراً من activatedAt + subscriptionDays
 *   وتتجاهل activeUntil القديم بالكامل لمنع أي تجاوز.
 * - الحسابات القديمة (دون activatedAt/subscriptionDays): تستمر عبر activeUntil للتوافق الخلفي.
 */
export function getSubscriptionExpiryMs(
  tenant: Pick<TenantAccount, "activatedAt" | "subscriptionDays" | "activeUntil">
): {
  endMs: number | null;
  isServerTimed: boolean;
} {
  const hasActivatedField = tenant.activatedAt !== undefined && tenant.activatedAt !== null;
  const hasDaysField = tenant.subscriptionDays !== undefined && tenant.subscriptionDays !== null;

  const activatedMs = tsToMs(tenant.activatedAt);
  if (activatedMs !== null && isAllowedSubscriptionDays(tenant.subscriptionDays)) {
    return {
      endMs: activatedMs + tenant.subscriptionDays * 86400000,
      isServerTimed: true,
    };
  }

  // بنية جزئية أو غير صالحة لـ activatedAt/subscriptionDays: إغلاق آمن بدون رجوع إلى activeUntil
  if (hasActivatedField || hasDaysField) {
    return {
      endMs: 0,
      isServerTimed: true,
    };
  }

  return {
    endMs: tsToMs(tenant.activeUntil),
    isServerTimed: false,
  };
}

/**
 * استخراج وقت انتهاء الفترة التجريبية بالمللي ثانية:
 * يأخذ الحد الأقصى بين نهاية التجربة الأصلية (createdAt + trialDays)
 * ونهاية التمديد الإداري الخادمي (trialExtendedAt + trialExtensionDays) إن وُجد.
 */
export function getTrialExpiryMs(
  tenant: Pick<TenantAccount, "createdAt" | "trialDays" | "trialExtendedAt" | "trialExtensionDays">
): {
  trialEndsAtMs: number | null;
  hasExtension: boolean;
  maxDisplayDays: number;
} {
  const trialDays = Math.max(0, Number(tenant.trialDays ?? DEFAULT_TRIAL_DAYS));
  const createdMs = tsToMs(tenant.createdAt);
  const baseEndsMs = createdMs !== null && trialDays > 0 ? createdMs + trialDays * 86400000 : null;

  const extStartMs = tsToMs(tenant.trialExtendedAt);
  const hasValidExt =
    extStartMs !== null && isAllowedTrialExtensionDays(tenant.trialExtensionDays);
  const extDays = hasValidExt ? (tenant.trialExtensionDays as AllowedTrialExtensionDays) : 0;
  const extEndsMs = hasValidExt ? extStartMs + extDays * 86400000 : null;

  const maxDisplayDays = Math.max(trialDays, extDays);

  if (baseEndsMs !== null && extEndsMs !== null) {
    return { trialEndsAtMs: Math.max(baseEndsMs, extEndsMs), hasExtension: true, maxDisplayDays };
  }
  if (extEndsMs !== null) {
    return { trialEndsAtMs: extEndsMs, hasExtension: true, maxDisplayDays };
  }
  return { trialEndsAtMs: baseEndsMs, hasExtension: false, maxDisplayDays };
}

/**
 * تحديد الحالة المرشحة لإعادة التفعيل أو رفض طلب الدفع بناءً على البنية فقط
 * (دون أي اعتماد على ساعة جهاز المدير أو serverNowMs):
 * الخادم عبر Firestore Rules (request.time) هو الحكم الوحيد الذي يقبل الحالة الفعّالة أو يرفضها.
 */
export function resolveServerVerifiedStatusCandidates(
  tenant: Pick<TenantAccount, "planId" | "activatedAt" | "subscriptionDays" | "activeUntil">
): {
  primaryStatus: "active" | "trialing";
  fallbackStatus: "expired";
  isPaidAccount: boolean;
} {
  const isPaidAccount =
    tenant.planId !== "trial" ||
    (tenant.activatedAt !== undefined && tenant.activatedAt !== null) ||
    (tenant.subscriptionDays !== undefined && tenant.subscriptionDays !== null) ||
    tenant.activeUntil !== null;

  return {
    primaryStatus: isPaidAccount ? "active" : "trialing",
    fallbackStatus: "expired",
    isPaidAccount,
  };
}

export function formatRemainingArabic(diffMs: number): string {
  if (diffMs <= 0) return "انتهت المدة";
  const totalHours = Math.max(1, Math.ceil(diffMs / 3600000));
  if (totalHours < 24) {
    if (totalHours === 1) return "ساعة واحدة";
    if (totalHours === 2) return "ساعتان";
    if (totalHours <= 10) return `${totalHours} ساعات`;
    return `${totalHours} ساعة`;
  }
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  const dayWord = days === 1 ? "يوم" : days === 2 ? "يومان" : days <= 10 ? `${days} أيام` : `${days} يوم`;
  if (remHours > 0) {
    const hourWord = remHours === 1 ? "ساعة" : remHours === 2 ? "ساعتين" : remHours <= 10 ? `${remHours} ساعات` : `${remHours} ساعة`;
    return `${dayWord} و ${hourWord}`;
  }
  return dayWord;
}

export function evaluateTenantAccess(
  tenant: TenantAccount | null,
  nowMs = Date.now(),
  opts?: { emailVerified?: boolean }
): TenantAccessEvaluation {
  if (!tenant) {
    return {
      allowed: false,
      state: "expired",
      hasPendingPayment: false,
      daysLeft: 0,
      hoursLeft: 0,
      trialEndsAtMs: null,
      activeUntilMs: null,
      expiresAtMs: null,
      isExpiringSoon: false,
      remainingLabel: "انتهت المدة",
    };
  }

  // صلاحية المدير محصورة في المالك الأساسي الموثّق فقط (Xtashtoush@gmail.com)
  const verifiedOrNotPassed = opts?.emailVerified !== false;
  if (verifiedOrNotPassed && isOwnerAdminEmail(tenant.email)) {
    return {
      allowed: true,
      state: "owner_free",
      hasPendingPayment: false,
      daysLeft: 9999,
      hoursLeft: 9999,
      trialEndsAtMs: null,
      activeUntilMs: null,
      expiresAtMs: null,
      isExpiringSoon: false,
      remainingLabel: "دائم",
    };
  }

  if (tenant.subscriptionStatus === "suspended") {
    const { endMs: activeUntilMs } = getSubscriptionExpiryMs(tenant);
    return {
      allowed: false,
      state: "suspended",
      hasPendingPayment: false,
      daysLeft: 0,
      hoursLeft: 0,
      trialEndsAtMs: null,
      activeUntilMs,
      expiresAtMs: activeUntilMs,
      isExpiringSoon: false,
      remainingLabel: "موقوف",
    };
  }

  if (tenant.subscriptionStatus === "active") {
    const { endMs: activeUntilMs, isServerTimed } = getSubscriptionExpiryMs(tenant);
    if (tenant.planId === "trial") {
      return {
        allowed: false,
        state: "expired",
        hasPendingPayment: false,
        daysLeft: 0,
        hoursLeft: 0,
        trialEndsAtMs: null,
        activeUntilMs,
        expiresAtMs: activeUntilMs,
        isExpiringSoon: false,
        remainingLabel: "انتهت المدة",
      };
    }
    if (!isServerTimed && activeUntilMs === null) {
      return {
        allowed: true,
        state: "active",
        hasPendingPayment: false,
        daysLeft: 9999,
        hoursLeft: 9999,
        trialEndsAtMs: null,
        activeUntilMs: null,
        expiresAtMs: null,
        isExpiringSoon: false,
        remainingLabel: "دائم",
      };
    }
    const diff = activeUntilMs !== null ? activeUntilMs - nowMs : -1;
    if (activeUntilMs !== null && diff > 0) {
      const daysLeft = Math.max(1, Math.ceil(diff / 86400000));
      const hoursLeft = Math.max(1, Math.ceil(diff / 3600000));
      return {
        allowed: true,
        state: "active",
        hasPendingPayment: false,
        daysLeft,
        hoursLeft,
        trialEndsAtMs: null,
        activeUntilMs,
        expiresAtMs: activeUntilMs,
        isExpiringSoon: diff < EXPIRY_WARNING_MS,
        remainingLabel: formatRemainingArabic(diff),
      };
    }
    return {
      allowed: false,
      state: "expired",
      hasPendingPayment: false,
      daysLeft: 0,
      hoursLeft: 0,
      trialEndsAtMs: null,
      activeUntilMs,
      expiresAtMs: activeUntilMs,
      isExpiringSoon: false,
      remainingLabel: "انتهت المدة",
    };
  }

  // حالة pending_payment أو trialing: يجب دائماً مراعاة انتهاء مدة التجربة (أو الباقة السابقة)
  // إذا انتهت التجربة أثناء وجود طلب دفع قيد المراجعة، يُقفل الحساب حتى يؤكد المدير الدفع!
  if (
    tenant.subscriptionStatus === "trialing" ||
    tenant.subscriptionStatus === "pending_payment"
  ) {
    const isPendingPayment = tenant.subscriptionStatus === "pending_payment";
    const { endMs: activeUntilMs, isServerTimed } = getSubscriptionExpiryMs(tenant);

    if (isPendingPayment && tenant.planId !== "trial" && !isServerTimed && activeUntilMs === null) {
      return {
        allowed: true,
        state: "active",
        hasPendingPayment: true,
        daysLeft: 9999,
        hoursLeft: 9999,
        trialEndsAtMs: null,
        activeUntilMs: null,
        expiresAtMs: null,
        isExpiringSoon: false,
        remainingLabel: "دائم",
      };
    }

    if (isServerTimed || activeUntilMs !== null) {
      const diff = activeUntilMs !== null ? activeUntilMs - nowMs : -1;
      if (activeUntilMs !== null && diff > 0) {
        const daysLeft = Math.max(1, Math.ceil(diff / 86400000));
        const hoursLeft = Math.max(1, Math.ceil(diff / 3600000));
        return {
          allowed: true,
          state: "active",
          hasPendingPayment: isPendingPayment,
          daysLeft,
          hoursLeft,
          trialEndsAtMs: null,
          activeUntilMs,
          expiresAtMs: activeUntilMs,
          isExpiringSoon: diff < EXPIRY_WARNING_MS,
          remainingLabel: formatRemainingArabic(diff),
        };
      }
      return {
        allowed: false,
        state: isPendingPayment ? "pending_payment" : "expired",
        hasPendingPayment: isPendingPayment,
        daysLeft: 0,
        hoursLeft: 0,
        trialEndsAtMs: null,
        activeUntilMs,
        expiresAtMs: activeUntilMs,
        isExpiringSoon: false,
        remainingLabel: "انتهت المدة",
      };
    }

    const trialDays = Math.max(0, Number(tenant.trialDays ?? DEFAULT_TRIAL_DAYS));
    const { trialEndsAtMs, hasExtension, maxDisplayDays } = getTrialExpiryMs(tenant);
    if (trialEndsAtMs === null) {
      const approxEnds = nowMs + trialDays * 86400000;
      const approxDiff = trialDays * 86400000;
      return {
        allowed: trialDays > 0,
        state: trialDays > 0 ? "trialing" : isPendingPayment ? "pending_payment" : "expired",
        hasPendingPayment: isPendingPayment,
        daysLeft: trialDays,
        hoursLeft: trialDays * 24,
        trialEndsAtMs: approxEnds,
        activeUntilMs: null,
        expiresAtMs: approxEnds,
        isExpiringSoon: trialDays > 0 && approxDiff < EXPIRY_WARNING_MS,
        remainingLabel: formatRemainingArabic(approxDiff),
      };
    }

    const diff = trialEndsAtMs - nowMs;
    if (diff > 0 && (trialDays > 0 || hasExtension)) {
      const capDays = Math.max(1, maxDisplayDays);
      const daysLeft = Math.min(capDays, Math.max(1, Math.ceil(diff / 86400000)));
      const hoursLeft = Math.min(capDays * 24, Math.max(1, Math.ceil(diff / 3600000)));
      const clampedDiff = Math.min(diff, capDays * 86400000);
      return {
        allowed: true,
        state: "trialing",
        hasPendingPayment: isPendingPayment,
        daysLeft,
        hoursLeft,
        trialEndsAtMs,
        activeUntilMs: null,
        expiresAtMs: trialEndsAtMs,
        isExpiringSoon: clampedDiff < EXPIRY_WARNING_MS,
        remainingLabel: formatRemainingArabic(clampedDiff),
      };
    }

    return {
      allowed: false,
      state: isPendingPayment ? "pending_payment" : "expired",
      hasPendingPayment: isPendingPayment,
      daysLeft: 0,
      hoursLeft: 0,
      trialEndsAtMs,
      activeUntilMs: null,
      expiresAtMs: trialEndsAtMs,
      isExpiringSoon: false,
      remainingLabel: "انتهت المدة",
    };
  }

  const { endMs: fallbackUntil } = getSubscriptionExpiryMs(tenant);
  return {
    allowed: false,
    state: "expired",
    hasPendingPayment: false,
    daysLeft: 0,
    hoursLeft: 0,
    trialEndsAtMs: null,
    activeUntilMs: fallbackUntil,
    expiresAtMs: fallbackUntil,
    isExpiringSoon: false,
    remainingLabel: "انتهت المدة",
  };
}

export function normalizeJordanWhatsApp(phone: string): string {
  const digits = String(phone || DEFAULT_WHATSAPP_PHONE).replace(/[^0-9]/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("962")) return digits;
  if (digits.startsWith("07") && digits.length === 10) return `962${digits.slice(1)}`;
  if (digits.startsWith("7") && digits.length === 9) return `962${digits}`;
  return digits || "962798904182";
}

export function buildActivationMessage(params: {
  workshopName: string;
  email: string;
  planName: string;
  cycleLabel: string;
  cliqNote?: string;
  phone?: string;
}): string {
  const lines = [
    "السلام عليكم، أرغب بتفعيل اشتراك حاسبة القياسات عبر كليك (CliQ):",
    `• اسم الورشة: ${params.workshopName || "—"}`,
    `• البريد الإلكتروني للحساب: ${params.email}`,
    `• الباقة المطلوبة: ${params.planName}`,
    `• المدة: ${params.cycleLabel}`,
  ];
  if (params.phone) lines.push(`• رقم التواصل: ${params.phone}`);
  if (params.cliqNote) lines.push(`• مرجع/ملاحظة الحوالة: ${params.cliqNote}`);
  lines.push("يرجى تزويدي ببيانات كليك أو تأكيد التفعيل، وشكراً.");
  return lines.join("\n");
}

export function buildWhatsAppActivationUrl(
  whatsappPhone: string,
  message: string
): string {
  const waNum = normalizeJordanWhatsApp(whatsappPhone);
  return `https://wa.me/${waNum}?text=${encodeURIComponent(message)}`;
}

export function buildExpiryReminderEmailContent(params: {
  workshopName: string;
  userEmail: string;
  adminEmail: string;
  phone?: string;
  isTrial: boolean;
  remainingLabel: string;
  expiresAtIso: string;
  whatsappPhone: string;
}): {
  subject: string;
  userBody: string;
  adminBody: string;
  mailtoUrl: string;
} {
  const kind = params.isTrial ? "الفترة التجريبية" : "الاشتراك المدفوع";
  const actionVerb = params.isTrial ? "التفعيل" : "التجديد";
  const subject = `تنبيه: متبقي ${params.remainingLabel} على انتهاء ${kind} في حاسبة القياسات`;
  const userBody = [
    `مرحباً ${params.workshopName || "عميلنا العزيز"}،`,
    "",
    `نود تذكيرك بأنه متبقي أقل من يومين (${params.remainingLabel}) على انتهاء ${kind} لحسابك (${params.userEmail}) في حاسبة قياسات الشبابيك.`,
    `تاريخ الانتهاء: ${params.expiresAtIso}`,
    "",
    `لتفادي توقف الحساب، يرجى التواصل الآن عبر واتساب (${params.whatsappPhone}) لإتمام ${actionVerb} عبر كليك (CliQ).`,
    "ملاحظة: جميع مشاريعك وبياناتك محفوظة بأمان.",
  ].join("\n");

  const adminBody = [
    `تنبيه للإدارة — حساب قارب على الانتهاء (أقل من يومين):`,
    `• الورشة: ${params.workshopName || "—"}`,
    `• بريد المستخدم: ${params.userEmail}`,
    `• الهاتف: ${params.phone || "غير مضاف"}`,
    `• النوع: ${kind}`,
    `• المتبقي: ${params.remainingLabel} (ينتهي في ${params.expiresAtIso})`,
    `• الإجراء المقترح: التواصل مع الورشة لتذكيرها بـ${actionVerb}.`,
  ].join("\n");

  const mailtoUrl = `mailto:${encodeURIComponent(params.userEmail)}?cc=${encodeURIComponent(
    params.adminEmail || OWNER_ADMIN_EMAIL
  )}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(userBody)}`;

  return { subject, userBody, adminBody, mailtoUrl };
}
