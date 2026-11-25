import type { Timestamp } from "firebase/firestore";
import type { AppState, UnitCode } from "../types";

export const OWNER_ADMIN_EMAIL = "xtashtoush@gmail.com";
export const DEFAULT_WHATSAPP_PHONE = "0798904182";
export const DEFAULT_TRIAL_DAYS = 7;

export type SubscriptionStatus = "trialing" | "active" | "expired" | "suspended";
export type BillingCycle = "monthly" | "quarterly" | "yearly";
export type ActivationStatus = "pending" | "approved" | "rejected";
export type TenantRole = "owner" | "admin";

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
  maxProjects: number; // -1 means unlimited
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
  createdAt: Timestamp | null;
}

export interface TenantAccessEvaluation {
  allowed: boolean;
  state: "owner_free" | "active" | "trialing" | "expired" | "suspended";
  daysLeft: number;
  hoursLeft: number;
  trialEndsAtMs: number | null;
  activeUntilMs: number | null;
}

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

export function evaluateTenantAccess(
  tenant: TenantAccount | null,
  nowMs = Date.now()
): TenantAccessEvaluation {
  if (!tenant) {
    return {
      allowed: false,
      state: "expired",
      daysLeft: 0,
      hoursLeft: 0,
      trialEndsAtMs: null,
      activeUntilMs: null,
    };
  }

  if (tenant.role === "admin" || isOwnerAdminEmail(tenant.email)) {
    return {
      allowed: true,
      state: "owner_free",
      daysLeft: 9999,
      hoursLeft: 9999,
      trialEndsAtMs: null,
      activeUntilMs: null,
    };
  }

  if (tenant.subscriptionStatus === "suspended") {
    return {
      allowed: false,
      state: "suspended",
      daysLeft: 0,
      hoursLeft: 0,
      trialEndsAtMs: null,
      activeUntilMs: tsToMs(tenant.activeUntil),
    };
  }

  if (tenant.subscriptionStatus === "active") {
    const activeUntilMs = tsToMs(tenant.activeUntil);
    if (activeUntilMs === null) {
      return {
        allowed: true,
        state: "active",
        daysLeft: 9999,
        hoursLeft: 9999,
        trialEndsAtMs: null,
        activeUntilMs: null,
      };
    }
    const diff = activeUntilMs - nowMs;
    if (diff > 0) {
      return {
        allowed: true,
        state: "active",
        daysLeft: Math.ceil(diff / 86400000),
        hoursLeft: Math.ceil(diff / 3600000),
        trialEndsAtMs: null,
        activeUntilMs,
      };
    }
    return {
      allowed: false,
      state: "expired",
      daysLeft: 0,
      hoursLeft: 0,
      trialEndsAtMs: null,
      activeUntilMs,
    };
  }

  if (tenant.subscriptionStatus === "trialing") {
    const trialDays = Math.max(0, Number(tenant.trialDays ?? DEFAULT_TRIAL_DAYS));
    const createdMs = tsToMs(tenant.createdAt);
    if (createdMs === null) {
      // Newly created doc whose serverTimestamp is still resolving locally
      return {
        allowed: trialDays > 0,
        state: trialDays > 0 ? "trialing" : "expired",
        daysLeft: trialDays,
        hoursLeft: trialDays * 24,
        trialEndsAtMs: nowMs + trialDays * 86400000,
        activeUntilMs: null,
      };
    }
    const trialEndsAtMs = createdMs + trialDays * 86400000;
    const diff = trialEndsAtMs - nowMs;
    if (diff > 0 && trialDays > 0) {
      const daysLeft = Math.min(trialDays, Math.max(1, Math.ceil(diff / 86400000)));
      const hoursLeft = Math.min(trialDays * 24, Math.max(1, Math.ceil(diff / 3600000)));
      return {
        allowed: true,
        state: "trialing",
        daysLeft,
        hoursLeft,
        trialEndsAtMs,
        activeUntilMs: null,
      };
    }
    return {
      allowed: false,
      state: "expired",
      daysLeft: 0,
      hoursLeft: 0,
      trialEndsAtMs,
      activeUntilMs: null,
    };
  }

  return {
    allowed: false,
    state: "expired",
    daysLeft: 0,
    hoursLeft: 0,
    trialEndsAtMs: null,
    activeUntilMs: tsToMs(tenant.activeUntil),
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
