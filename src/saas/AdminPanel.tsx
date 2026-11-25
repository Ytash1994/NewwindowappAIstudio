import React, { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  BellRing,
  CheckCircle2,
  ClipboardList,
  Clock,
  Copy,
  ExternalLink,
  KeyRound,
  Mail,
  MessageCircle,
  RotateCcw,
  Save,
  Search,
  Settings,
  Shield,
  ShieldPlus,
  Trash2,
  UserPlus,
  Users,
  X,
  XCircle,
} from "lucide-react";
import firebaseConfig from "../../firebase-applet-config.json";
import {
  APPS_SCRIPT_EMAIL_TEMPLATE,
  BILLING_CYCLE_LABELS,
  DEFAULT_PRIVATE_NOTIFICATION_CONFIG,
  DEFAULT_WHATSAPP_PHONE,
  OWNER_ADMIN_EMAIL,
  buildExpiryReminderEmailContent,
  evaluateTenantAccess,
  isOwnerAdminEmail,
  normalizeJordanWhatsApp,
  tsToMs,
} from "./types";
import type {
  ActivationRequestDoc,
  AdminRecord,
  AuditLogDoc,
  ExpiryAlertDoc,
  PlatformConfig,
  PrivateNotificationConfig,
  SubscriptionPlan,
  TenantAccount,
} from "./types";
import {
  adminAcknowledgeExpiryAlert,
  adminActivateTenant,
  adminAddAdditionalAdmin,
  adminCreateWorkshopAccount,
  adminDispatchExpiryEmail,
  adminExtendTrial,
  adminReactivateTenant,
  adminRemoveAdditionalAdmin,
  adminReviewActivationRequest,
  adminSavePlan,
  adminSavePlatformConfig,
  adminSavePrivateNotificationConfig,
  adminSendPasswordResetLink,
  adminSuspendTenant,
  fetchNotificationWebhookStatus,
  subscribeAdditionalAdmins,
  subscribeAllActivationRequests,
  subscribeAllExpiryAlerts,
  subscribeAllTenants,
  subscribeAuditLogs,
  subscribePrivateNotificationConfig,
} from "./service";

interface AdminPanelProps {
  adminUser: User;
  plans: SubscriptionPlan[];
  config: PlatformConfig;
  serverNowMs: number;
  onClose: () => void;
  onToast: (msg: string, ms?: number) => void;
}

type AdminTab = "tenants" | "requests" | "alerts" | "settings" | "audit";

export function AdminPanel({
  adminUser,
  plans,
  config,
  serverNowMs,
  onClose,
  onToast,
}: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>("tenants");
  const [tenants, setTenants] = useState<TenantAccount[]>([]);
  const [additionalAdmins, setAdditionalAdmins] = useState<AdminRecord[]>([]);
  const [requests, setRequests] = useState<ActivationRequestDoc[]>([]);
  const [expiryAlerts, setExpiryAlerts] = useState<ExpiryAlertDoc[]>([]);
  const [logs, setLogs] = useState<AuditLogDoc[]>([]);
  const [privateCfg, setPrivateCfg] = useState<PrivateNotificationConfig>(
    DEFAULT_PRIVATE_NOTIFICATION_CONFIG
  );
  const [webhookStatus, setWebhookStatus] = useState<{
    webhookConfigured: boolean;
    secretConfigured: boolean;
  }>({ webhookConfigured: false, secretConfigured: false });

  const [searchQ, setSearchQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "trialing" | "pending_payment" | "active" | "locked"
  >("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [planChoiceByTenant, setPlanChoiceByTenant] = useState<Record<string, string>>({});

  // نافذة إعادة تعيين كلمة المرور
  const [resetTarget, setResetTarget] = useState<TenantAccount | null>(null);
  const [resetLinkSent, setResetLinkSent] = useState(false);

  // إنشاء حساب يدوي
  const [createOpen, setCreateOpen] = useState(false);
  const [newWorkshop, setNewWorkshop] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [createdCreds, setCreatedCreds] = useState<{
    email: string;
    password: string;
    name: string;
  } | null>(null);

  // مسودات الإعدادات
  const [cfgDraft, setCfgDraft] = useState<PlatformConfig>(config);
  const [privDraft, setPrivDraft] = useState<PrivateNotificationConfig>(
    DEFAULT_PRIVATE_NOTIFICATION_CONFIG
  );
  const [plansDraft, setPlansDraft] = useState<SubscriptionPlan[]>(plans);

  const isPrimaryOwner = useMemo(
    () => isOwnerAdminEmail(adminUser.email) && Boolean(adminUser.emailVerified),
    [adminUser.email, adminUser.emailVerified]
  );

  useEffect(() => {
    setCfgDraft(config);
  }, [config]);

  useEffect(() => {
    setPrivDraft(privateCfg);
  }, [privateCfg]);

  useEffect(() => {
    setPlansDraft(plans);
  }, [plans]);

  useEffect(() => {
    const unsub1 = subscribeAllTenants(setTenants);
    const unsub2 = subscribeAllActivationRequests(setRequests);
    const unsub3 = subscribeAuditLogs(setLogs);
    const unsub4 = subscribeAllExpiryAlerts(setExpiryAlerts);
    const unsub5 = subscribePrivateNotificationConfig(setPrivateCfg);
    const unsub6 = isPrimaryOwner ? subscribeAdditionalAdmins(setAdditionalAdmins) : () => {};

    void fetchNotificationWebhookStatus(adminUser).then(setWebhookStatus);

    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
      unsub5();
      unsub6();
    };
  }, [adminUser, isPrimaryOwner]);

  const expiringTenants = useMemo(() => {
    return tenants
      .map((t) => ({
        tenant: t,
        access: evaluateTenantAccess(t, serverNowMs),
        alert: expiryAlerts.find((a) => a.ownerUid === t.ownerUid),
      }))
      .filter((item) => item.access.isExpiringSoon)
      .sort((a, b) => a.access.hoursLeft - b.access.hoursLeft);
  }, [tenants, expiryAlerts, serverNowMs]);

  const stats = useMemo(() => {
    let active = 0;
    let trialing = 0;
    let locked = 0;
    tenants.forEach((t) => {
      const ev = evaluateTenantAccess(t, serverNowMs);
      if (ev.state === "owner_free" || ev.state === "active") active++;
      else if (ev.state === "trialing") trialing++;
      else locked++;
    });
    const pendingReqs = requests.filter((r) => r.status === "pending").length;
    return {
      total: tenants.length,
      active,
      trialing,
      locked,
      pendingReqs,
      expiringSoon: expiringTenants.length,
    };
  }, [tenants, requests, expiringTenants.length, serverNowMs]);

  const filteredTenants = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return tenants.filter((t) => {
      const ev = evaluateTenantAccess(t, serverNowMs);
      if (statusFilter === "trialing" && ev.state !== "trialing") return false;
      if (
        statusFilter === "pending_payment" &&
        !ev.hasPendingPayment &&
        t.subscriptionStatus !== "pending_payment"
      ) {
        return false;
      }
      if (statusFilter === "active" && ev.state !== "active" && ev.state !== "owner_free") {
        return false;
      }
      if (statusFilter === "locked" && ev.allowed) return false;
      if (!q) return true;
      return (
        t.email.toLowerCase().includes(q) ||
        t.workshopName.toLowerCase().includes(q) ||
        t.phone.toLowerCase().includes(q) ||
        t.ownerUid.toLowerCase().includes(q)
      );
    });
  }, [tenants, searchQ, statusFilter, serverNowMs]);

  const adminUidSet = useMemo(
    () => new Set(additionalAdmins.map((a) => a.uid)),
    [additionalAdmins]
  );

  const handleActivate = async (t: TenantAccount, durationDays: number | null) => {
    setBusyId(t.ownerUid);
    try {
      const chosenPlan =
        planChoiceByTenant[t.ownerUid] ||
        (t.planId !== "trial" ? t.planId : plans[0]?.id || "starter");
      await adminActivateTenant(
        adminUser,
        t,
        {
          planId: chosenPlan,
          durationDays,
        },
        serverNowMs
      );
      onToast(`تم تفعيل حساب ${t.workshopName || t.email} بنجاح ✓`);
    } catch {
      onToast("تعذر تفعيل الحساب");
    } finally {
      setBusyId(null);
    }
  };

  const handleExtend = async (t: TenantAccount, days: number) => {
    setBusyId(t.ownerUid);
    try {
      await adminExtendTrial(adminUser, t, days, serverNowMs);
      onToast(`تم تمديد التجربة +${days} أيام لـ ${t.workshopName || t.email} ✓`);
    } catch {
      onToast("تعذر تمديد التجربة");
    } finally {
      setBusyId(null);
    }
  };

  const handleSuspend = async (t: TenantAccount) => {
    setBusyId(t.ownerUid);
    try {
      await adminSuspendTenant(adminUser, t, "تم إغلاق الحساب من الإدارة");
      onToast(`تم إيقاف حساب ${t.workshopName || t.email} فوراً`);
    } catch {
      onToast("تعذر إيقاف الحساب");
    } finally {
      setBusyId(null);
    }
  };

  const handleReactivate = async (t: TenantAccount) => {
    setBusyId(t.ownerUid);
    try {
      await adminReactivateTenant(adminUser, t, serverNowMs);
      onToast(`تمت إعادة تفعيل حساب ${t.workshopName || t.email} ✓`);
    } catch {
      onToast("تعذر إعادة تفعيل الحساب");
    } finally {
      setBusyId(null);
    }
  };

  const handleReviewReq = async (req: ActivationRequestDoc, decision: "approved" | "rejected") => {
    setBusyId(req.id);
    try {
      const duration = BILLING_CYCLE_LABELS[req.billingCycle]?.days || 30;
      await adminReviewActivationRequest(adminUser, req, decision, duration, serverNowMs);
      onToast(decision === "approved" ? "تم تأكيد الدفع وتفعيل الاشتراك فوراً ✓" : "تم رفض الطلب");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      onToast(msg || "تعذر تنفيذ العملية على الطلب", 3800);
    } finally {
      setBusyId(null);
    }
  };

  const handleGrantAdmin = async (t: TenantAccount) => {
    setBusyId(`adm_${t.ownerUid}`);
    try {
      await adminAddAdditionalAdmin(adminUser, t);
      onToast(`تم منح صلاحية مدير إضافي لـ ${t.email} ✓`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "تعذر منح الصلاحية");
    } finally {
      setBusyId(null);
    }
  };

  const handleRevokeAdmin = async (adm: AdminRecord) => {
    setBusyId(`adm_${adm.uid}`);
    try {
      await adminRemoveAdditionalAdmin(adminUser, adm.uid, adm.email);
      onToast(`تم سحب صلاحية المدير من ${adm.email} ✓`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "تعذر سحب الصلاحية");
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveConfig = async () => {
    setBusyId("cfg");
    try {
      await adminSavePlatformConfig(adminUser, cfgDraft);
      await adminSavePrivateNotificationConfig(adminUser, privDraft);
      onToast("تم حفظ إعدادات كليك وواتساب وإعدادات الإدارة الخاصة ✓");
    } catch {
      onToast("تعذر حفظ الإعدادات");
    } finally {
      setBusyId(null);
    }
  };

  const handleSavePlanItem = async (pl: SubscriptionPlan) => {
    setBusyId(`plan_${pl.id}`);
    try {
      await adminSavePlan(adminUser, pl);
      onToast(`تم تحديث باقة «${pl.name}» ✓`);
    } catch {
      onToast("تعذر تحديث الباقة");
    } finally {
      setBusyId(null);
    }
  };

  const handleSendResetEmail = async (t: TenantAccount) => {
    setBusyId(`reset_${t.ownerUid}`);
    try {
      await adminSendPasswordResetLink(adminUser, t);
      setResetLinkSent(true);
      onToast(`تم إرسال رابط إعادة تعيين كلمة المرور إلى ${t.email} ✓`, 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("user-not-found")) {
        onToast("هذا البريد غير مسجل بكلمة مرور (قد يكون مسجلاً عبر Google فقط)", 4000);
      } else {
        onToast("تعذر إرسال رابط إعادة التعيين، يرجى التحقق من إعدادات المصادقة.", 4200);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleManualCreateWorkshop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkshop.trim() || !newEmail.trim() || newPassword.length < 6) {
      onToast("أدخل اسم الورشة والبريد وكلمة مرور (6 أحرف على الأقل)", 3200);
      return;
    }
    setBusyId("create_manual");
    try {
      await adminCreateWorkshopAccount(adminUser, {
        workshopName: newWorkshop.trim(),
        email: newEmail.trim(),
        phone: newPhone.trim(),
        password: newPassword,
        planId: "trial",
        durationDays: null,
      });
      setCreatedCreds({
        email: newEmail.trim().toLowerCase(),
        password: newPassword,
        name: newWorkshop.trim(),
      });
      setNewWorkshop("");
      setNewEmail("");
      setNewPhone("");
      setNewPassword("");
      onToast(
        "تم إنشاء حساب الدخول وإرسال رسالة توثيق البريد. سيبدأ حساب الورشة فور توثيق العميل لبريده ✓",
        4500
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("email-already-in-use")) {
        onToast("هذا البريد مستخدم بالفعل. يمكنك إرسال رابط استعادة كلمة السر له.", 4200);
      } else {
        onToast("تعذر إنشاء الحساب، تحقق من البريد وكلمة المرور.", 3600);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleDispatchExpiryEmail = async (
    target: TenantAccount,
    access: ReturnType<typeof evaluateTenantAccess>,
    existingAlertId?: string
  ) => {
    setBusyId(`exp_${target.ownerUid}`);
    try {
      const res = await adminDispatchExpiryEmail(
        adminUser,
        target,
        access,
        config,
        privateCfg,
        existingAlertId
      );
      if (res.sentViaServer) {
        onToast(`تم تأكيد إرسال بريد التنبيه عبر الخادم إلى ${target.email} وبريد الإدارة ✓`, 4000);
      } else if (res.status === "unconfigured") {
        onToast("الخادم غير مربوط بـ Webhook بعد؛ تم تجهيز رسالة البريد اليدوية ✓", 3800);
        window.location.href = res.mailtoUrl;
      } else {
        onToast(res.error || "فشل تسليم البريد عبر الخادم — يمكنك استخدام البريد اليدوي", 4200);
      }
    } catch {
      onToast("تعذر إرسال تنبيه البريد");
    } finally {
      setBusyId(null);
    }
  };

  const handleAckAlert = async (alertId: string) => {
    setBusyId(`ack_${alertId}`);
    try {
      await adminAcknowledgeExpiryAlert(adminUser, alertId);
      onToast("تم تأكيد مراجعة التنبيه ✓");
    } catch {
      onToast("تعذر تحديث حالة التنبيه");
    } finally {
      setBusyId(null);
    }
  };

  const firebaseAuthConsoleUrl = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/users`;

  const fmtDate = (ms: number | null) => {
    if (!ms) return "—";
    return new Date(ms).toISOString().slice(0, 10);
  };

  const actionLabelAr = (action: string): string => {
    const map: Record<string, string> = {
      approve_payment_request: "تأكيد دفع كليك وتفعيل اشتراك",
      reject_payment_request: "رفض طلب دفع",
      activate_subscription: "تفعيل/تعديل اشتراك",
      extend_trial: "تمديد فترة التجربة",
      suspend_tenant: "إيقاف حساب",
      reactivate_tenant: "إعادة تفعيل حساب",
      grant_admin: "منح صلاحية مدير إضافي",
      revoke_admin: "سحب صلاحية مدير إضافي",
      save_plan: "تعديل باقة اشتراك",
      update_platform_config: "تحديث إعدادات كليك وواتساب",
      update_private_notifications_config: "تحديث إعدادات تنبيهات الإدارة",
      send_expiry_reminder_email: "إرسال تنبيه قرب انتهاء",
      send_password_reset: "إرسال رابط تعيين كلمة مرور",
      create_workshop_manual: "إنشاء حساب ورشة يدوياً",
    };
    return map[action] || action;
  };

  return (
    <div className="saas-modal-backdrop" onClick={onClose}>
      <div className="saas-admin-shell" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="saas-sub-head">
          <div className="saas-sub-title">
            <Shield className="ico" aria-hidden="true" />
            <div>
              <h2>لوحة إدارة المنصة ({isPrimaryOwner ? "المالك الأساسي" : "مدير"})</h2>
              <p>تحكم آمن ومؤرّخ باشتراكات الورش، طلبات كليك، الباقات، وسجل التدقيق</p>
            </div>
          </div>
          <button type="button" className="thm" aria-label="إغلاق" onClick={onClose}>
            <X className="ico-sm" aria-hidden="true" />
          </button>
        </div>

        {/* مؤشرات سريعة */}
        <div className="saas-kpi-grid">
          <div className="saas-kpi">
            <small>إجمالي الورش</small>
            <b>{stats.total}</b>
          </div>
          <div className="saas-kpi ok">
            <small>مشتركون فعّالون</small>
            <b>{stats.active}</b>
          </div>
          <div className="saas-kpi warn">
            <small>في التجربة</small>
            <b>{stats.trialing}</b>
          </div>
          <div className="saas-kpi bad">
            <small>حسابات مقفلة</small>
            <b>{stats.locked}</b>
          </div>
          <div className="saas-kpi pri">
            <small>طلبات كليك معلقة</small>
            <b>{stats.pendingReqs}</b>
          </div>
          <div className="saas-kpi warn">
            <small>قارب الانتهاء (&lt; يومين)</small>
            <b>{stats.expiringSoon}</b>
          </div>
        </div>

        {/* التبويبات */}
        <div className="saas-admin-tabs">
          <button type="button" className={tab === "tenants" ? "on" : ""} onClick={() => setTab("tenants")}>
            <Users className="ico-xs" aria-hidden="true" />
            <span>الورش ({stats.total})</span>
          </button>
          <button type="button" className={tab === "requests" ? "on" : ""} onClick={() => setTab("requests")}>
            <MessageCircle className="ico-xs" aria-hidden="true" />
            <span>طلبات كليك {stats.pendingReqs > 0 ? `(${stats.pendingReqs})` : ""}</span>
          </button>
          <button type="button" className={tab === "alerts" ? "on" : ""} onClick={() => setTab("alerts")}>
            <BellRing className="ico-xs" aria-hidden="true" />
            <span>تنبيهات الانتهاء {stats.expiringSoon > 0 ? `(${stats.expiringSoon})` : ""}</span>
          </button>
          <button type="button" className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
            <Settings className="ico-xs" aria-hidden="true" />
            <span>الباقات والإعدادات والمدراء</span>
          </button>
          <button type="button" className={tab === "audit" ? "on" : ""} onClick={() => setTab("audit")}>
            <ClipboardList className="ico-xs" aria-hidden="true" />
            <span>سجل التدقيق</span>
          </button>
        </div>

        <div className="saas-admin-body">
          {/* 1. الورش والاشتراكات */}
          {tab === "tenants" && (
            <>
              <div className="saas-filter-bar">
                <div className="saas-search-box">
                  <Search className="ico-xs" aria-hidden="true" />
                  <input
                    value={searchQ}
                    placeholder="ابحث باسم الورشة أو البريد أو الهاتف..."
                    onChange={(e) => setSearchQ(e.target.value)}
                  />
                </div>
                <div className="saas-filter-pills">
                  {(
                    [
                      ["all", "الكل"],
                      ["trialing", "تجربة"],
                      ["pending_payment", "طلب دفع"],
                      ["active", "فعّال"],
                      ["locked", "مقفل"],
                    ] as const
                  ).map(([k, lbl]) => (
                    <button
                      key={k}
                      type="button"
                      className={statusFilter === k ? "on" : ""}
                      onClick={() => setStatusFilter(k)}
                    >
                      {lbl}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`saas-add-manual-btn${createOpen ? " on" : ""}`}
                    onClick={() => {
                      setCreateOpen((v) => !v);
                      setCreatedCreds(null);
                    }}
                  >
                    <UserPlus className="ico-xs" aria-hidden="true" />
                    <span>إنشاء حساب يدوياً</span>
                  </button>
                </div>
              </div>

              {createOpen && (
                <form className="saas-section saas-manual-create" onSubmit={handleManualCreateWorkshop}>
                  <h3>إنشاء حساب دخول لورشة (يتطلب توثيق البريد قبل بدء التجربة)</h3>
                  <div className="saas-form-row">
                    <label>
                      <span>اسم الورشة *</span>
                      <input
                        value={newWorkshop}
                        maxLength={120}
                        placeholder="ورشة الأمل"
                        onChange={(e) => setNewWorkshop(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>البريد الإلكتروني *</span>
                      <input
                        type="email"
                        dir="ltr"
                        value={newEmail}
                        maxLength={200}
                        placeholder="workshop@example.com"
                        onChange={(e) => setNewEmail(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="saas-form-row">
                    <label>
                      <span>كلمة المرور اليدوية (6 أحرف+) *</span>
                      <input
                        type="text"
                        dir="ltr"
                        value={newPassword}
                        minLength={6}
                        maxLength={64}
                        placeholder="مثال: Workshop@2026"
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>رقم الهاتف / واتساب (اختياري)</span>
                      <input
                        dir="ltr"
                        value={newPhone}
                        maxLength={30}
                        placeholder="079xxxxxxx"
                        onChange={(e) => setNewPhone(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="saas-tenant-acts" style={{ marginBottom: 8 }}>
                    <button
                      type="submit"
                      className="btn sm g"
                      disabled={busyId === "create_manual"}
                    >
                      <UserPlus className="ico-xs" aria-hidden="true" />
                      <span>
                        {busyId === "create_manual"
                          ? "جارٍ الإنشاء..."
                          : "إنشاء الحساب وإرسال رسالة التوثيق"}
                      </span>
                    </button>
                  </div>
                  {createdCreds && (
                    <div className="saas-ok-box">
                      <div>
                        <b>تم إنشاء حساب الدخول لـ {createdCreds.name} وإرسال رسالة التوثيق:</b>{" "}
                        <span dir="ltr">{createdCreds.email}</span> | كلمة المرور:{" "}
                        <b dir="ltr">{createdCreds.password}</b>
                      </div>
                      <button
                        type="button"
                        className="btn sm"
                        style={{ marginTop: 6 }}
                        onClick={() => {
                          const txt = `بيانات الدخول لحاسبة القياسات (${createdCreds.name}):\nالبريد: ${createdCreds.email}\nكلمة المرور: ${createdCreds.password}\nملاحظة: يرجى توثيق البريد الإلكتروني من الرسالة المرسلة قبل الاستخدام.`;
                          navigator.clipboard?.writeText(txt);
                          onToast("تم نسخ بيانات الدخول ✓");
                        }}
                      >
                        <Copy className="ico-xs" aria-hidden="true" />
                        <span>نسخ بيانات الدخول لإرسالها للعميل</span>
                      </button>
                    </div>
                  )}
                </form>
              )}

              <div className="saas-admin-list">
                {filteredTenants.map((t) => {
                  const ev = evaluateTenantAccess(t, serverNowMs);
                  const isBusy = busyId === t.ownerUid || busyId === `adm_${t.ownerUid}`;
                  const chosenPlan =
                    planChoiceByTenant[t.ownerUid] ||
                    (t.planId && t.planId !== "trial" && t.planId !== "owner_free"
                      ? t.planId
                      : plans[0]?.id || "starter");

                  return (
                    <div key={t.ownerUid} className="saas-tenant-card">
                      <div className="saas-tenant-top">
                        <div>
                          <b>{t.workshopName || t.displayName || "بدون اسم"}</b>
                          <div className="saas-tenant-sub">
                            <span>{t.email}</span>
                            {t.phone && <span> · {t.phone}</span>}
                          </div>
                        </div>
                        <span className={`saas-status-tag st-${ev.state}`}>
                          {ev.state === "owner_free"
                            ? "مدير (دائم)"
                            : ev.state === "active"
                              ? `مشترك (${ev.activeUntilMs ? `${ev.daysLeft} يوم` : "دائم"})`
                              : ev.state === "trialing"
                                ? `تجربة (متبقي ${ev.daysLeft} يوم)${ev.hasPendingPayment ? " · طلب دفع" : ""}`
                                : ev.state === "pending_payment"
                                  ? "مقفل — طلب دفع قيد المراجعة"
                                  : ev.state === "suspended"
                                    ? "موقوف إدارياً"
                                    : "منتهي — مقفل"}
                        </span>
                      </div>

                      <div className="saas-tenant-meta">
                        <span>الباقة: <b>{plans.find((p) => p.id === t.planId)?.name || t.planId}</b></span>
                        <span>المشاريع: <b>{t.projectCount ?? 0}</b></span>
                        <span>التسجيل: <b>{fmtDate(tsToMs(t.createdAt))}</b></span>
                        {ev.activeUntilMs && <span>ينتهي: <b>{fmtDate(ev.activeUntilMs)}</b></span>}
                        {ev.trialEndsAtMs && <span>نهاية التجربة: <b>{fmtDate(ev.trialEndsAtMs)}</b></span>}
                      </div>

                      {ev.state !== "owner_free" && (
                        <div className="saas-tenant-acts">
                          <select
                            value={chosenPlan}
                            onChange={(e) =>
                              setPlanChoiceByTenant((prev) => ({ ...prev, [t.ownerUid]: e.target.value }))
                            }
                          >
                            {plans.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn sm g"
                            disabled={isBusy}
                            onClick={() => void handleActivate(t, 30)}
                          >
                            تفعيل شهر
                          </button>
                          <button
                            type="button"
                            className="btn sm g"
                            disabled={isBusy}
                            onClick={() => void handleActivate(t, 90)}
                          >
                            3 أشهر
                          </button>
                          <button
                            type="button"
                            className="btn sm p"
                            disabled={isBusy}
                            onClick={() => void handleActivate(t, 365)}
                          >
                            سنة
                          </button>
                          <button
                            type="button"
                            className="btn sm w"
                            disabled={isBusy}
                            onClick={() => void handleExtend(t, 7)}
                          >
                            +7 أيام تجربة
                          </button>
                          <button
                            type="button"
                            className="btn sm"
                            disabled={isBusy}
                            onClick={() => {
                              setResetTarget(t);
                              setResetLinkSent(false);
                            }}
                          >
                            <KeyRound className="ico-xs" aria-hidden="true" />
                            <span>كلمة السر</span>
                          </button>
                          {t.subscriptionStatus === "suspended" ? (
                            <button
                              type="button"
                              className="btn sm g"
                              disabled={isBusy}
                              onClick={() => void handleReactivate(t)}
                            >
                              <RotateCcw className="ico-xs" aria-hidden="true" />
                              <span>إعادة التفعيل</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn sm r"
                              disabled={isBusy}
                              onClick={() => void handleSuspend(t)}
                            >
                              إيقاف الحساب
                            </button>
                          )}
                          {isPrimaryOwner && !adminUidSet.has(t.ownerUid) && (
                            <button
                              type="button"
                              className="btn sm"
                              disabled={isBusy}
                              onClick={() => void handleGrantAdmin(t)}
                            >
                              <ShieldPlus className="ico-xs" aria-hidden="true" />
                              <span>ترقية كمدير</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {!filteredTenants.length && <p className="saas-empty">لا توجد ورش مطابقة للبحث.</p>}
              </div>
            </>
          )}

          {/* 2. طلبات التفعيل عبر كليك */}
          {tab === "requests" && (
            <div className="saas-admin-list">
              {requests.map((req) => {
                const isBusy = busyId === req.id;
                const planName = plans.find((p) => p.id === req.planId)?.name || req.planId;
                const waReply = req.phone
                  ? `https://wa.me/${normalizeJordanWhatsApp(req.phone)}?text=${encodeURIComponent(
                      `مرحباً ${req.workshopName}، تم تأكيد حوالة كليك وتفعيل اشتراكك في حاسبة القياسات (${planName}) بنجاح.`
                    )}`
                  : null;

                return (
                  <div key={req.id} className="saas-tenant-card">
                    <div className="saas-tenant-top">
                      <div>
                        <b>{req.workshopName}</b>
                        <div className="saas-tenant-sub">
                          <span>{req.email}</span>
                          {req.phone && <span> · {req.phone}</span>}
                        </div>
                      </div>
                      <span
                        className={`saas-status-tag ${
                          req.status === "approved"
                            ? "st-active"
                            : req.status === "rejected"
                              ? "st-suspended"
                              : "st-trialing"
                        }`}
                      >
                        {req.status === "pending"
                          ? "قيد المراجعة"
                          : req.status === "approved"
                            ? "تم التأكيد والتفعيل"
                            : "مرفوض"}
                      </span>
                    </div>

                    <div className="saas-tenant-meta">
                      <span>الباقة: <b>{planName}</b></span>
                      <span>المدة: <b>{BILLING_CYCLE_LABELS[req.billingCycle]?.label || req.billingCycle}</b></span>
                      <span>التاريخ: <b>{fmtDate(tsToMs(req.createdAt))}</b></span>
                    </div>

                    {req.cliqNote && (
                      <div className="saas-note-banner">
                        <b>ملاحظة كليك:</b> {req.cliqNote}
                      </div>
                    )}

                    <div className="saas-tenant-acts">
                      {req.status === "pending" && (
                        <>
                          <button
                            type="button"
                            className="btn sm g"
                            disabled={isBusy}
                            onClick={() => void handleReviewReq(req, "approved")}
                          >
                            <CheckCircle2 className="ico-xs" aria-hidden="true" />
                            <span>تأكيد الدفع وتفعيل الاشتراك فوراً</span>
                          </button>
                          <button
                            type="button"
                            className="btn sm r"
                            disabled={isBusy}
                            onClick={() => void handleReviewReq(req, "rejected")}
                          >
                            <XCircle className="ico-xs" aria-hidden="true" />
                            <span>رفض الطلب</span>
                          </button>
                        </>
                      )}
                      {waReply && (
                        <a
                          href={waReply}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn sm"
                        >
                          <MessageCircle className="ico-xs" aria-hidden="true" />
                          <span>مراسلة الورشة واتساب</span>
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
              {!requests.length && <p className="saas-empty">لا توجد طلبات دفع عبر كليك حتى الآن.</p>}
            </div>
          )}

          {/* 3. تنبيهات قرب الانتهاء (< يومين) */}
          {tab === "alerts" && (
            <div className="saas-admin-list">
              <div className="saas-note-banner">
                <b>تنبيهات الحسابات المتبقي لها أقل من يومين (تجريبية أو مدفوعة):</b>{" "}
                بريد الإدارة الخاص المستلم:{" "}
                <b dir="ltr">{privateCfg.adminAlertEmail || OWNER_ADMIN_EMAIL}</b> —{" "}
                {webhookStatus.webhookConfigured
                  ? `الإرسال الآمن عبر الخادم مفعّل ومؤكّد ✓ ${
                      webhookStatus.secretConfigured ? "(محمي بمفتاح سري)" : ""
                    }`
                  : "خادم الإشعارات غير مربوط بـ EXPIRY_WEBHOOK_URL بعد؛ يمكنك الإرسال يدوياً بنقرة واحدة أو ضبط متغير البيئة في الخادم."}
              </div>

              {expiringTenants.map(({ tenant: t, access: ev, alert }) => {
                const isBusy = busyId === `exp_${t.ownerUid}` || busyId === t.ownerUid;
                const isTrial = ev.state === "trialing";
                const expiresAtIso = fmtDate(ev.expiresAtMs);
                const emailPkg = buildExpiryReminderEmailContent({
                  workshopName: t.workshopName || t.displayName || "ورشتي",
                  userEmail: t.email,
                  adminEmail: privateCfg.adminAlertEmail || OWNER_ADMIN_EMAIL,
                  phone: t.phone,
                  isTrial,
                  remainingLabel: ev.remainingLabel,
                  expiresAtIso,
                  whatsappPhone: config.whatsappPhone || DEFAULT_WHATSAPP_PHONE,
                });
                const waReminder = t.phone
                  ? `https://wa.me/${normalizeJordanWhatsApp(t.phone)}?text=${encodeURIComponent(
                      `مرحباً ${t.workshopName || ""}، نذكّرك بأنه متبقي أقل من يومين (${ev.remainingLabel}) على انتهاء ${
                        isTrial ? "فترتك التجريبية" : "اشتراكك"
                      } في حاسبة القياسات. للتفعيل أو التجديد عبر كليك تواصل معنا الآن.`
                    )}`
                  : null;

                return (
                  <div key={t.ownerUid} className="saas-tenant-card">
                    <div className="saas-tenant-top">
                      <div>
                        <b>{t.workshopName || t.displayName || "بدون اسم"}</b>
                        <div className="saas-tenant-sub">
                          <span>{t.email}</span>
                          {t.phone && <span> · {t.phone}</span>}
                        </div>
                      </div>
                      <span className="saas-status-tag st-trialing">
                        <Clock className="ico-xs" aria-hidden="true" />{" "}
                        {isTrial ? "تجربة" : "مدفوع"} · متبقي {ev.remainingLabel}
                      </span>
                    </div>

                    <div className="saas-tenant-meta">
                      <span>تاريخ الانتهاء: <b>{expiresAtIso}</b></span>
                      <span>
                        حالة بريد التنبيه:{" "}
                        <b>
                          {alert?.emailStatus === "sent"
                            ? "تم التسليم المؤكّد من الخادم ✓"
                            : alert?.emailStatus === "manual"
                              ? "تم التجهيز للبريد اليدوي ✓"
                              : alert?.emailStatus === "failed"
                                ? "فشل التسليم — أعد المحاولة"
                                : "بانتظار الإرسال"}
                        </b>
                      </span>
                    </div>

                    <div className="saas-tenant-acts">
                      <button
                        type="button"
                        className="btn sm p"
                        disabled={isBusy}
                        onClick={() => void handleDispatchExpiryEmail(t, ev, alert?.id)}
                      >
                        <Mail className="ico-xs" aria-hidden="true" />
                        <span>
                          {webhookStatus.webhookConfigured
                            ? "إرسال تنبيه عبر الخادم (للمستخدم + الإدارة)"
                            : "إرسال إيميل تنبيه يدوي (للمستخدم + نسخة للإدارة)"}
                        </span>
                      </button>
                      {webhookStatus.webhookConfigured && (
                        <a href={emailPkg.mailtoUrl} className="btn sm">
                          <Mail className="ico-xs" aria-hidden="true" />
                          <span>فتح في تطبيق البريد</span>
                        </a>
                      )}
                      {waReminder && (
                        <a
                          href={waReminder}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn sm g"
                        >
                          <MessageCircle className="ico-xs" aria-hidden="true" />
                          <span>تذكير واتساب</span>
                        </a>
                      )}
                      <button
                        type="button"
                        className="btn sm g"
                        disabled={isBusy}
                        onClick={() => void handleActivate(t, 30)}
                      >
                        تجديد شهر
                      </button>
                      {alert && !alert.acknowledged && (
                        <button
                          type="button"
                          className="btn sm"
                          disabled={busyId === `ack_${alert.id}`}
                          onClick={() => void handleAckAlert(alert.id)}
                        >
                          <CheckCircle2 className="ico-xs" aria-hidden="true" />
                          <span>تمت المراجعة</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {!expiringTenants.length && (
                <p className="saas-empty">
                  لا توجد حالياً حسابات تجريبية أو مدفوعة متبقي لها أقل من يومين.
                </p>
              )}
            </div>
          )}

          {/* 4. الباقات وإعدادات كليك والإعدادات الخاصة وإدارة المدراء */}
          {tab === "settings" && (
            <div className="saas-admin-list">
              <div className="saas-section">
                <h3>إعدادات الدفع العامة (كليك وواتساب)</h3>
                <div className="saas-form-row">
                  <label>
                    <span>رقم واتساب التفعيل</span>
                    <input
                      dir="ltr"
                      value={cfgDraft.whatsappPhone}
                      maxLength={30}
                      onChange={(e) => setCfgDraft({ ...cfgDraft, whatsappPhone: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>الاسم المستعار في كليك (CliQ Alias)</span>
                    <input
                      value={cfgDraft.cliqAlias}
                      maxLength={100}
                      onChange={(e) => setCfgDraft({ ...cfgDraft, cliqAlias: e.target.value })}
                    />
                  </label>
                </div>
                <div className="saas-form-row">
                  <label>
                    <span>اسم البنك / المحفظة</span>
                    <input
                      value={cfgDraft.cliqBankName}
                      maxLength={100}
                      onChange={(e) => setCfgDraft({ ...cfgDraft, cliqBankName: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>اسم صاحب الحساب</span>
                    <input
                      value={cfgDraft.cliqHolderName}
                      maxLength={120}
                      onChange={(e) => setCfgDraft({ ...cfgDraft, cliqHolderName: e.target.value })}
                    />
                  </label>
                </div>
                <label className="saas-note-input">
                  <span>تعليمات التحويل للعملاء</span>
                  <input
                    value={cfgDraft.supportNote}
                    maxLength={500}
                    onChange={(e) => setCfgDraft({ ...cfgDraft, supportNote: e.target.value })}
                  />
                </label>

                <hr style={{ borderColor: "var(--bd)", margin: "12px 0" }} />
                <h3>إعدادات التنبيهات الخاصة بالإدارة (معزولة ولا يراها العملاء)</h3>
                <div className="saas-form-row">
                  <label>
                    <span>بريد الإدارة المستلم لتنبيهات الانتهاء</span>
                    <input
                      type="email"
                      dir="ltr"
                      value={privDraft.adminAlertEmail}
                      maxLength={200}
                      onChange={(e) =>
                        setPrivDraft({ ...privDraft, adminAlertEmail: e.target.value })
                      }
                    />
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 22 }}>
                    <input
                      type="checkbox"
                      checked={privDraft.notificationsEnabled}
                      onChange={(e) =>
                        setPrivDraft({ ...privDraft, notificationsEnabled: e.target.checked })
                      }
                    />
                    <span>تفعيل تنبيهات قرب الانتهاء</span>
                  </label>
                </div>

                <div className="saas-note-banner" style={{ marginBottom: 10 }}>
                  <b>أمان رابط Webhook:</b> لحماية النظام، لا يُخزّن رابط الإشعارات في قاعدة البيانات
                  العامة ولا يظهر للمتصفح. يتم ضبط <b>EXPIRY_WEBHOOK_URL</b> و{" "}
                  <b>EXPIRY_WEBHOOK_SECRET</b> في متغيرات بيئة الخادم فقط.
                  <br />
                  الحالة الحالية:{" "}
                  <b>
                    {webhookStatus.webhookConfigured
                      ? "مربوط ومؤمّن على الخادم ✓"
                      : "غير مضبوط بعد في متغيرات الخادم"}
                  </b>
                </div>

                <details className="saas-pass-details" style={{ marginBottom: 10 }}>
                  <summary>
                    <Mail className="ico-xs" aria-hidden="true" />
                    <span>كود Google Apps Script الآمن للربط عبر متغيرات الخادم</span>
                  </summary>
                  <div className="saas-script-box">
                    <p className="saas-cliq-note">
                      ضع المفتاح السري في <b>Script Properties</b> باسم{" "}
                      <b>EXPIRY_WEBHOOK_SECRET</b> ثم ضع رابط النشر في متغير بيئة الخادم{" "}
                      <b>EXPIRY_WEBHOOK_URL</b>:
                    </p>
                    <pre dir="ltr">{APPS_SCRIPT_EMAIL_TEMPLATE}</pre>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        navigator.clipboard?.writeText(APPS_SCRIPT_EMAIL_TEMPLATE);
                        onToast("تم نسخ كود Google Apps Script الآمن ✓");
                      }}
                    >
                      <Copy className="ico-xs" aria-hidden="true" />
                      <span>نسخ الكود</span>
                    </button>
                  </div>
                </details>

                <button
                  type="button"
                  className="btn p sm"
                  disabled={busyId === "cfg"}
                  onClick={() => void handleSaveConfig()}
                >
                  <Save className="ico-xs" aria-hidden="true" />
                  <span>{busyId === "cfg" ? "جارٍ الحفظ..." : "حفظ الإعدادات العامة والخاصة"}</span>
                </button>
              </div>

              {/* إدارة المدراء الإضافيين (للمالك الأساسي فقط) */}
              {isPrimaryOwner && (
                <div className="saas-section">
                  <h3>إدارة المدراء الإضافيين (خاصة بمالك المنصة الأساسي)</h3>
                  <p className="saas-cliq-note">
                    مالك المنصة الأساسي: <b dir="ltr">{OWNER_ADMIN_EMAIL}</b> (لا يمكن إزالته).
                    لترقية مستخدم موثّق كمدير إضافي، استخدم زر «ترقية كمدير» من تبويب الورش.
                  </p>
                  {additionalAdmins.length > 0 ? (
                    <div className="saas-admin-list" style={{ marginTop: 8 }}>
                      {additionalAdmins.map((adm) => (
                        <div key={adm.uid} className="saas-audit-item">
                          <div>
                            <b dir="ltr">{adm.email}</b> — <span>معرّف: {adm.uid.slice(0, 10)}...</span>
                          </div>
                          {!isOwnerAdminEmail(adm.email) && (
                            <button
                              type="button"
                              className="btn sm r"
                              disabled={busyId === `adm_${adm.uid}`}
                              onClick={() => void handleRevokeAdmin(adm)}
                            >
                              <Trash2 className="ico-xs" aria-hidden="true" />
                              <span>سحب الصلاحية</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="saas-empty">لا يوجد مدراء إضافيون حالياً.</p>
                  )}
                </div>
              )}

              <div className="saas-section">
                <h3>تعديل الباقات والأسعار وحدود الاستخدام</h3>
                {plansDraft.map((pl, idx) => (
                  <div key={pl.id} className="saas-plan-edit-row">
                    <div className="saas-form-row">
                      <label>
                        <span>اسم الباقة ({pl.id})</span>
                        <input
                          value={pl.name}
                          maxLength={80}
                          onChange={(e) => {
                            const next = plansDraft.slice();
                            next[idx] = { ...pl, name: e.target.value };
                            setPlansDraft(next);
                          }}
                        />
                      </label>
                      <label>
                        <span>نص السعر المعروض</span>
                        <input
                          value={pl.priceLabel}
                          maxLength={60}
                          onChange={(e) => {
                            const next = plansDraft.slice();
                            next[idx] = { ...pl, priceLabel: e.target.value };
                            setPlansDraft(next);
                          }}
                        />
                      </label>
                    </div>
                    <div className="saas-form-row">
                      <label>
                        <span>السعر الشهري (دينار)</span>
                        <input
                          type="number"
                          dir="ltr"
                          value={pl.priceMonthlyJod}
                          onChange={(e) => {
                            const next = plansDraft.slice();
                            next[idx] = { ...pl, priceMonthlyJod: Number(e.target.value) || 0 };
                            setPlansDraft(next);
                          }}
                        />
                      </label>
                      <label>
                        <span>حد المشاريع (-1 غير محدود)</span>
                        <input
                          type="number"
                          dir="ltr"
                          value={pl.maxProjects}
                          onChange={(e) => {
                            const next = plansDraft.slice();
                            next[idx] = { ...pl, maxProjects: Number(e.target.value) };
                            setPlansDraft(next);
                          }}
                        />
                      </label>
                    </div>
                    <div className="saas-plan-checks">
                      <label>
                        <input
                          type="checkbox"
                          checked={pl.allowExport}
                          onChange={(e) => {
                            const next = plansDraft.slice();
                            next[idx] = { ...pl, allowExport: e.target.checked };
                            setPlansDraft(next);
                          }}
                        />
                        <span>السماح بتنزيل PDF/Excel</span>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={pl.allowCustomTypes}
                          onChange={(e) => {
                            const next = plansDraft.slice();
                            next[idx] = { ...pl, allowCustomTypes: e.target.checked };
                            setPlansDraft(next);
                          }}
                        />
                        <span>السماح بالأنواع المخصصة</span>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={pl.active}
                          onChange={(e) => {
                            const next = plansDraft.slice();
                            next[idx] = { ...pl, active: e.target.checked };
                            setPlansDraft(next);
                          }}
                        />
                        <span>الباقة مفعّلة</span>
                      </label>
                      <button
                        type="button"
                        className="btn sm g"
                        disabled={busyId === `plan_${pl.id}`}
                        onClick={() => void handleSavePlanItem(pl)}
                      >
                        <Save className="ico-xs" aria-hidden="true" />
                        <span>حفظ الباقة</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 5. سجل التدقيق غير القابل للتعديل أو الحذف */}
          {tab === "audit" && (
            <div className="saas-admin-list">
              {logs.map((lg) => (
                <div key={lg.id} className="saas-audit-item">
                  <div>
                    <b>{actionLabelAr(lg.action)}</b> — <span>{lg.details}</span>
                    {(lg.beforeState || lg.afterState) && (
                      <div style={{ fontSize: "0.78rem", opacity: 0.85, marginTop: 4 }} dir="ltr">
                        {lg.beforeState ? `قبل: ${lg.beforeState}` : ""}
                        {lg.beforeState && lg.afterState ? "  →  " : ""}
                        {lg.afterState ? `بعد: ${lg.afterState}` : ""}
                      </div>
                    )}
                  </div>
                  <small>
                    {lg.actorEmail} · {fmtDate(tsToMs(lg.createdAt))}
                  </small>
                </div>
              ))}
              {!logs.length && <p className="saas-empty">لا توجد عمليات إدارية مسجلة بعد.</p>}
            </div>
          )}
        </div>

        {/* نافذة إعادة تعيين كلمة المرور */}
        {resetTarget && (
          <div
            className="saas-modal-backdrop"
            style={{ zIndex: 130 }}
            onClick={() => setResetTarget(null)}
          >
            <div
              className="saas-sub-card"
              style={{ maxWidth: 500, width: "100%" }}
              dir="rtl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="saas-sub-head">
                <div className="saas-sub-title">
                  <KeyRound className="ico" aria-hidden="true" />
                  <div>
                    <h2>إعادة تعيين كلمة المرور</h2>
                    <p>
                      {resetTarget.workshopName || resetTarget.displayName} —{" "}
                      <span dir="ltr">{resetTarget.email}</span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="thm"
                  aria-label="إغلاق"
                  onClick={() => setResetTarget(null)}
                >
                  <X className="ico-sm" aria-hidden="true" />
                </button>
              </div>

              <div className="saas-section">
                <h3>1. إرسال رابط إعادة التعيين عبر الإيميل</h3>
                <p className="saas-cliq-note">
                  يُرسل رابطاً رسمياً وآمناً مباشرةً لبريد المستخدم ليضع كلمة مرور جديدة بنفسه.
                </p>
                {resetLinkSent && (
                  <div className="saas-ok-box">
                    تم إرسال رابط إعادة تعيين كلمة المرور إلى{" "}
                    <b dir="ltr">{resetTarget.email}</b> بنجاح.
                  </div>
                )}
                <div className="saas-action-stack">
                  <button
                    type="button"
                    className="btn p full"
                    disabled={busyId === `reset_${resetTarget.ownerUid}`}
                    onClick={() => void handleSendResetEmail(resetTarget)}
                  >
                    <Mail className="ico-sm" aria-hidden="true" />
                    <span>
                      {busyId === `reset_${resetTarget.ownerUid}`
                        ? "جارٍ الإرسال..."
                        : "إرسال رابط تعيين كلمة السر للإيميل الآن"}
                    </span>
                  </button>
                  {resetTarget.phone && (
                    <a
                      href={`https://wa.me/${normalizeJordanWhatsApp(resetTarget.phone)}?text=${encodeURIComponent(
                        `مرحباً ${resetTarget.workshopName || ""}، تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني (${resetTarget.email}). يرجى فحص البريد الوارد أو الرسائل غير المرغوب فيها.`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn sm g full"
                    >
                      <MessageCircle className="ico-xs" aria-hidden="true" />
                      <span>إشعار الورشة على واتساب بإرسال الرابط</span>
                    </a>
                  )}
                </div>
              </div>

              <div className="saas-section">
                <h3>2. الإدارة المباشرة عبر لوحة المصادقة</h3>
                <div className="saas-action-stack">
                  <a
                    href={firebaseAuthConsoleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn sm full"
                  >
                    <ExternalLink className="ico-xs" aria-hidden="true" />
                    <span>فتح إدارة المستخدمين في لوحة Firebase</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
