import type { Timestamp } from "firebase/firestore";
import type { AppState, UnitCode } from "../types";

export const OWNER_ADMIN_EMAIL = "xtashtoush@gmail.com";
export const DEFAULT_WHATSAPP_PHONE = "0798904182";
export const DEFAULT_TRIAL_DAYS = 7;
export const TRIAL_MAX_PROJECTS = 25;

export type SubscriptionStatus =
  | "trialing"
  | "pending_payment"
  | "active"
  | "expired"
  | "suspended";
export type BillingCycle = "monthly" | "quarterly" | "yearly";
export type ActivationStatus = "pending" | "approved" | "rejected";
export type TenantRole = "owner" | "admin";

export interface AdminRecord {
  uid: string;
  email: string;
  createdAt?: Timestamp | null;
}

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

/** إعدادات التنبيهات الخاصة بالمدير فقط (محمية في config_private/notifications) */
export interface PrivateNotificationConfig {
  adminAlertEmail: string;
  notificationsEnabled: boolean;
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
  activeUntil: Timestamp | null;
  adminNote: string;
  projectCount?: number;
  lastProjectActionId?: string;
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

export type ExpiryAlertType = "trial_expiring" | "subscription_expiring";
export type ExpiryEmailStatus = "pending" | "sent" | "manual" | "failed";

export interface ExpiryAlertDoc {
  id: string;
  tenantId: string;
  ownerUid: string;
  email: string;
  workshopName: string;
  phone: string;
  alertType: ExpiryAlertType;
  expiresAt: Timestamp | null;
  hoursLeft: number;
  adminEmail: string;
  emailStatus: ExpiryEmailStatus;
  acknowledged: boolean;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
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

export const DEFAULT_PRIVATE_NOTIFICATION_CONFIG: PrivateNotificationConfig = {
  adminAlertEmail: OWNER_ADMIN_EMAIL,
  notificationsEnabled: true,
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
    allowCustomTypes: true,
    active: true,
    sortOrder: 1,
    features: [
      "جميع أنظمة الشبابيك والمعادلات",
      "حفظ حتى 25 مشروعاً سحابياً",
      "نسخ ومشاركة نصية (بدون حفظ PDF/Excel)",
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
    active: true,
    sortOrder: 2,
    features: [
      "حفظ حتى 150 مشروعاً سحابياً",
      "إضافة أنواع وخانات مخصصة للورشة",
      "تصدير PDF و Excel ونسخ احتياطي كامل",
      "أولوية في الدعم والتفعيل",
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
    active: true,
    sortOrder: 3,
    features: [
      "مشاريع سحابية غير محدودة",
      "أنواع مخصصة ومعادلات غير محدودة",
      "تصدير PDF و Excel بدون قيود",
      "دعم مباشر عبر الواتساب",
    ],
  },
];

export const BILLING_CYCLE_LABELS: Record<BillingCycle, { label: string; months: number; days: number }> = {
  monthly: { label: "شهري (30 يوم)", months: 1, days: 30 },
  quarterly: { label: "3 أشهر (90 يوم)", months: 3, days: 90 },
  yearly: { label: "سنوي (365 يوم)", months: 12, days: 365 },
};

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

  // المدير يتطلب بريدًا موثّقًا (عند تمرير emailVerified) ولا نعتمد على البريد غير الموثّق
  const verifiedOrNotPassed = opts?.emailVerified !== false;
  if (verifiedOrNotPassed && (tenant.role === "admin" || isOwnerAdminEmail(tenant.email))) {
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
    const activeUntilMs = tsToMs(tenant.activeUntil);
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
    const activeUntilMs = tsToMs(tenant.activeUntil);
    if (activeUntilMs === null) {
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
    const diff = activeUntilMs - nowMs;
    if (diff > 0) {
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
    const activeUntilMs = tsToMs(tenant.activeUntil);

    // إن كان لديه اشتراك مدفوع سابق لم ينتهِ بعد
    if (activeUntilMs !== null) {
      const diff = activeUntilMs - nowMs;
      if (diff > 0) {
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
    const createdMs = tsToMs(tenant.createdAt);
    if (createdMs === null) {
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

    const trialEndsAtMs = createdMs + trialDays * 86400000;
    const diff = trialEndsAtMs - nowMs;
    if (diff > 0 && trialDays > 0) {
      const daysLeft = Math.min(trialDays, Math.max(1, Math.ceil(diff / 86400000)));
      const hoursLeft = Math.min(trialDays * 24, Math.max(1, Math.ceil(diff / 3600000)));
      const clampedDiff = Math.min(diff, trialDays * 86400000);
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

  const fallbackUntil = tsToMs(tenant.activeUntil);
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

export const APPS_SCRIPT_EMAIL_TEMPLATE = `function doPost(e) {
  var secret = PropertiesService.getScriptProperties().getProperty("EXPIRY_WEBHOOK_SECRET");
  var d = JSON.parse(e.postData.contents || "{}");
  if (secret && d.webhookSecret !== secret) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "unauthorized" }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (d.userEmail) {
    MailApp.sendEmail(d.userEmail, d.subject, d.userBody);
  }
  if (d.adminEmail) {
    MailApp.sendEmail(d.adminEmail, "[تنبيه الإدارة] " + d.subject, d.adminBody);
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}`;
