import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  Shield,
  UserPlus,
  Users,
  X,
  XCircle,
} from "lucide-react";
import firebaseConfig from "../../firebase-applet-config.json";
import {
  BILLING_CYCLE_LABELS,
  DEFAULT_EXTRA_TYPES_PACK_PRICE_JOD,
  DEFAULT_EXTRA_TYPES_PACK_SIZE,
  DEFAULT_TRIAL_DAYS,
  DEFAULT_WHATSAPP_PHONE,
  LAUNCH_MAX_CUSTOM_TYPES,
  OWNER_ADMIN_EMAIL,
  buildExpiryReminderEmailContent,
  evaluateTenantAccess,
  getPlanDefaultsById,
  normalizeJordanWhatsApp,
  tsToMs,
} from "./types";
import type {
  ActivationRequestDoc,
  AllowedSubscriptionDays,
  AllowedTrialExtensionDays,
  AuditLogDoc,
  PlatformConfig,
  SubscriptionPlan,
  TenantAccount,
} from "./types";
import {
  adminActivateTenant,
  adminCreateWorkshopAccount,
  adminExtendTrial,
  adminGrantExtraTypesQuota,
  adminReactivateTenant,
  adminReviewActivationRequest,
  adminSavePlan,
  adminSavePlatformConfig,
  adminSendPasswordResetLink,
  adminSuspendTenant,
  fetchAllActivationRequests,
  fetchAllTenants,
  fetchAuditLogs,
} from "./service";

interface AdminPanelProps {
  adminUser: User;
  plans: SubscriptionPlan[];
  config: PlatformConfig;
  serverNowMs: number;
  onClose: () => void;
  onPlatformDataChanged?: () => Promise<void>;
  onCountsUpdated?: (pendingReqs: number, expiringSoon: number) => void;
  onToast: (msg: string, ms?: number) => void;
}

type AdminTab = "tenants" | "requests" | "alerts" | "settings" | "audit";

export function AdminPanel({
  adminUser,
  plans,
  config,
  serverNowMs,
  onClose,
  onPlatformDataChanged,
  onCountsUpdated,
  onToast,
}: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>("tenants");
  const [tenants, setTenants] = useState<TenantAccount[]>([]);
  const [requests, setRequests] = useState<ActivationRequestDoc[]>([]);
  const [logs, setLogs] = useState<AuditLogDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const auditLoadedRef = useRef(false);

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
  const [plansDraft, setPlansDraft] = useState<SubscriptionPlan[]>(plans);

  useEffect(() => {
    setCfgDraft(config);
  }, [config]);

  useEffect(() => {
    setPlansDraft(plans);
  }, [plans]);

  const loadCoreData = useCallback(async () => {
    setLoading(true);
    try {
      const [allTenants, allReqs] = await Promise.all([
        fetchAllTenants(),
        fetchAllActivationRequests(),
      ]);
      setTenants(allTenants);
      setRequests(allReqs);
      const pending = allReqs.filter((r) => r.status === "pending").length;
      const expiring = allTenants.filter(
        (t) => evaluateTenantAccess(t, serverNowMs).isExpiringSoon
      ).length;
      onCountsUpdated?.(pending, expiring);
    } catch {
      onToast("تعذر تحميل بيانات الإدارة حالياً");
    } finally {
      setLoading(false);
    }
  }, [serverNowMs, onCountsUpdated, onToast]);

  const loadAuditData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchAuditLogs(80);
      setLogs(list);
      auditLoadedRef.current = true;
    } catch {
      onToast("تعذر تحميل سجل التدقيق حالياً");
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  // تحميل مرة واحدة عند فتح لوحة الإدارة فقط (بدون مستمعات onSnapshot مستمرة لتوفير حصة Spark)
  useEffect(() => {
    void loadCoreData();
  }, [loadCoreData]);

  // تحميل سجل التدقيق عند الطلب فقط عند فتح تبويب السجل
  useEffect(() => {
    if (tab === "audit" && !auditLoadedRef.current) {
      void loadAuditData();
    }
  }, [tab, loadAuditData]);

  const handleManualRefresh = async () => {
    await loadCoreData();
    if (tab === "audit") {
      await loadAuditData();
    } else {
      auditLoadedRef.current = false;
    }
    if (tab === "settings") {
      await onPlatformDataChanged?.();
    }
    onToast("تم تحديث بيانات لوحة الإدارة ✓");
  };

  const expiringTenants = useMemo(() => {
    return tenants
      .map((t) => ({
        tenant: t,
        access: evaluateTenantAccess(t, serverNowMs),
      }))
      .filter((item) => item.access.isExpiringSoon)
      .sort((a, b) => a.access.hoursLeft - b.access.hoursLeft);
  }, [tenants, serverNowMs]);

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

  // تقرير قراءة فقط للحسابات القديمة التي تحمل حصة extraCustomTypesQuota تتجاوز سقف الإطلاق (10 أنواع) أو على باقة لا تدعم الحزم الإضافية
  const legacyQuotaReview = useMemo(() => {
    return tenants
      .map((t) => {
        const storedExtra =
          typeof t.extraCustomTypesQuota === "number" && t.extraCustomTypesQuota > 0
            ? Math.round(t.extraCustomTypesQuota)
            : 0;
        if (storedExtra <= 0) return null;
        const planObj = plans.find((p) => p.id === t.planId) || { id: t.planId };
        const pDef = getPlanDefaultsById(planObj);
        const baseMax = Math.max(0, Math.min(LAUNCH_MAX_CUSTOM_TYPES, pDef.maxCustomTypes));
        const storedTotal = baseMax + storedExtra;
        const exceedsCap = storedTotal > LAUNCH_MAX_CUSTOM_TYPES;
        const unsupportedPlan = !pDef.allowExtraTypesAddon;
        if (!exceedsCap && !unsupportedPlan) return null;
        return {
          tenant: t,
          planName: plans.find((p) => p.id === t.planId)?.name || t.planId,
          baseMax,
          storedExtra,
          storedTotal,
          effectiveCap: unsupportedPlan ? baseMax : LAUNCH_MAX_CUSTOM_TYPES,
          reason: unsupportedPlan
            ? "حصة إضافية مسجّلة على باقة لا تدعم الحزم الإضافية"
            : `الإجمالي المسجّل (${storedTotal}) يتجاوز سقف الإطلاق (${LAUNCH_MAX_CUSTOM_TYPES})`,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [tenants, plans]);

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

  const handleActivate = async (t: TenantAccount, durationDays: AllowedSubscriptionDays) => {
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
        }
      );
      auditLoadedRef.current = false;
      await loadCoreData();
      onToast(`تم تفعيل حساب ${t.workshopName || t.email} بنجاح ✓`);
    } catch {
      onToast("تعذر تفعيل الحساب");
    } finally {
      setBusyId(null);
    }
  };

  const handleExtend = async (t: TenantAccount, days: AllowedTrialExtensionDays) => {
    setBusyId(t.ownerUid);
    try {
      await adminExtendTrial(adminUser, t, days);
      auditLoadedRef.current = false;
      await loadCoreData();
      onToast(`تم تمديد التجربة +${days} أيام لـ ${t.workshopName || t.email} ✓`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      onToast(msg || "تعذر تمديد التجربة", 3800);
    } finally {
      setBusyId(null);
    }
  };

  const handleSuspend = async (t: TenantAccount) => {
    setBusyId(t.ownerUid);
    try {
      await adminSuspendTenant(adminUser, t, "تم إغلاق الحساب من الإدارة");
      auditLoadedRef.current = false;
      await loadCoreData();
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
      await adminReactivateTenant(adminUser, t);
      auditLoadedRef.current = false;
      await loadCoreData();
      onToast(`تمت إعادة تفعيل حساب ${t.workshopName || t.email} ✓`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      onToast(msg || "تعذر إعادة تفعيل الحساب", 3800);
    } finally {
      setBusyId(null);
    }
  };

  const handleGrantExtraTypes = async (t: TenantAccount, delta: number) => {
    setBusyId(t.ownerUid);
    try {
      await adminGrantExtraTypesQuota(adminUser, t, delta);
      auditLoadedRef.current = false;
      await loadCoreData();
      onToast(`تمت إضافة +${delta} أنواع مخصصة للورشة ${t.workshopName || t.email} ✓`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      onToast(msg || "تعذر إضافة حصة الأنواع المخصصة", 3800);
    } finally {
      setBusyId(null);
    }
  };

  const handleReviewReq = async (req: ActivationRequestDoc, decision: "approved" | "rejected") => {
    setBusyId(req.id);
    try {
      const duration = BILLING_CYCLE_LABELS[req.billingCycle]?.days || 30;
      await adminReviewActivationRequest(adminUser, req, decision, duration);
      auditLoadedRef.current = false;
      await loadCoreData();
      const isAddon = req.requestType === "extra_types_addon";
      onToast(
        decision === "approved"
          ? isAddon
            ? `تم تأكيد الدفع وإضافة +${req.extraTypesCount || DEFAULT_EXTRA_TYPES_PACK_SIZE} أنواع مخصصة فوراً ✓`
            : "تم تأكيد الدفع وتفعيل الاشتراك فوراً ✓"
          : "تم رفض الطلب"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      onToast(msg || "تعذر تنفيذ العملية على الطلب", 3800);
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveConfig = async () => {
    setBusyId("cfg");
    try {
      await adminSavePlatformConfig(adminUser, cfgDraft);
      auditLoadedRef.current = false;
      await onPlatformDataChanged?.();
      onToast("تم حفظ إعدادات كليك وواتساب ✓");
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
      auditLoadedRef.current = false;
      await onPlatformDataChanged?.();
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
      auditLoadedRef.current = false;
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
      auditLoadedRef.current = false;
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

  const firebaseAuthConsoleUrl = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/users`;

  const fmtDate = (ms: number | null) => {
    if (!ms) return "—";
    return new Date(ms).toISOString().slice(0, 10);
  };

  const actionLabelAr = (action: string): string => {
    const map: Record<string, string> = {
      approve_payment_request: "تأكيد دفع كليك وتفعيل اشتراك",
      approve_extra_types_addon: "تأكيد دفع حزمة أنواع مخصصة إضافية",
      grant_extra_types: "منح حصة أنواع مخصصة إضافية",
      reject_payment_request: "رفض طلب دفع",
      activate_subscription: "تفعيل/تعديل اشتراك",
      extend_trial: "تمديد فترة التجربة",
      suspend_tenant: "إيقاف حساب",
      reactivate_tenant: "إعادة تفعيل حساب",
      save_plan: "تعديل باقة اشتراك",
      update_platform_config: "تحديث إعدادات كليك وواتساب",
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
              <h2>لوحة إدارة المنصة (المالك الأساسي)</h2>
              <p>تحكم آمن ومؤرّخ باشتراكات الورش، طلبات كليك، الباقات، وسجل التدقيق</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="btn sm"
              disabled={loading}
              aria-label="تحديث البيانات"
              onClick={() => void handleManualRefresh()}
            >
              <RefreshCw className="ico-xs" aria-hidden="true" />
              <span>{loading ? "تحديث..." : "تحديث"}</span>
            </button>
            <button type="button" className="saas-close-btn" aria-label="إغلاق" onClick={onClose}>
              <X className="ico-sm" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* التبويبات (ثابتة وملتفّة بشكل واضح دون قصّ نص) */}
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
            <span>الباقات والإعدادات</span>
          </button>
          <button type="button" className={tab === "audit" ? "on" : ""} onClick={() => setTab("audit")}>
            <ClipboardList className="ico-xs" aria-hidden="true" />
            <span>سجل التدقيق</span>
          </button>
        </div>

        <div className="saas-admin-body">
          {/* مؤشرات سريعة داخل منطقة التمرير حتى لا تضغط الشاشة على الهاتف */}
          {tab === "tenants" && (
            <div className="saas-kpi-grid">
              <div className="saas-kpi">
                <small>إجمالي الورش</small>
                <b>{stats.total}</b>
              </div>
              <div className="saas-kpi ok">
                <small>فعّالون</small>
                <b>{stats.active}</b>
              </div>
              <div className="saas-kpi warn">
                <small>تجربة</small>
                <b>{stats.trialing}</b>
              </div>
              <div className="saas-kpi bad">
                <small>مقفلة</small>
                <b>{stats.locked}</b>
              </div>
              <div className="saas-kpi pri">
                <small>طلبات كليك</small>
                <b>{stats.pendingReqs}</b>
              </div>
              <div className="saas-kpi warn">
                <small>&lt; يومين</small>
                <b>{stats.expiringSoon}</b>
              </div>
            </div>
          )}

          {/* 1. الورش والاشتراكات */}
          {tab === "tenants" && (
            <>
              {legacyQuotaReview.length > 0 && (
                <div className="saas-section" style={{ borderColor: "rgba(245, 158, 11, 0.45)", marginBottom: 12 }}>
                  <h3>
                    تنبيه مراجعة الحصص القديمة ({legacyQuotaReview.length} حساب يتجاوز سقف {LAUNCH_MAX_CUSTOM_TYPES} أنواع)
                  </h3>
                  <p className="rtip" style={{ marginBottom: 8 }}>
                    لا يتم حذف أو خفض حصة أي عميل تلقائياً. هذه الحسابات محكومة فعلياً بسقف{" "}
                    <b>{LAUNCH_MAX_CUSTOM_TYPES} أنواع مخصصة</b> عند الحفظ السحابي، وتحتاج مراجعة يدوية وموافقتك قبل أي تعديل:
                  </p>
                  <div className="saas-admin-list" style={{ gap: 6 }}>
                    {legacyQuotaReview.map((item) => (
                      <div key={item.tenant.ownerUid} className="saas-tenant-card" style={{ padding: "8px 10px" }}>
                        <div className="saas-tenant-top">
                          <b>{item.tenant.workshopName || item.tenant.displayName || "ورشة"}</b>
                          <span className="saas-status-tag st-trialing">
                            مسجّل +{item.storedExtra} · الحد الفعّال {item.effectiveCap}
                          </span>
                        </div>
                        <div className="saas-tenant-meta">
                          <span>الباقة: <b>{item.planName}</b></span>
                          <span>الحالة: <b>{item.reason}</b></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
                  const isBusy = busyId === t.ownerUid;
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
                            ? "المالك (دائم)"
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
                        {(t.extraCustomTypesQuota || 0) > 0 && (
                          <span>أنواع إضافية: <b>+{t.extraCustomTypesQuota}</b></span>
                        )}
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
                          {ev.state === "active" &&
                            (() => {
                              const pDef = getPlanDefaultsById(
                                plans.find((p) => p.id === t.planId) || { id: t.planId }
                              );
                              if (!pDef.allowExtraTypesAddon) return null;
                              const baseMax = Math.max(
                                0,
                                Math.min(LAUNCH_MAX_CUSTOM_TYPES, pDef.maxCustomTypes)
                              );
                              const curExtra = t.extraCustomTypesQuota || 0;
                              const remaining = Math.max(
                                0,
                                LAUNCH_MAX_CUSTOM_TYPES - (baseMax + curExtra)
                              );
                              const grantDelta = Math.min(pDef.extraTypesPackSize, remaining);
                              return (
                                <button
                                  type="button"
                                  className="btn sm p"
                                  disabled={isBusy || remaining <= 0}
                                  onClick={() => void handleGrantExtraTypes(t, grantDelta)}
                                >
                                  {remaining > 0
                                    ? `+${grantDelta} أنواع إضافية`
                                    : `الحد الأقصى (${LAUNCH_MAX_CUSTOM_TYPES})`}
                                </button>
                              );
                            })()}
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
                        </div>
                      )}
                    </div>
                  );
                })}
                {!filteredTenants.length && (
                  <p className="saas-empty">
                    {loading ? "جارٍ تحميل الورش..." : "لا توجد ورش مطابقة للبحث."}
                  </p>
                )}
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
                      {req.requestType === "extra_types_addon" ? (
                        <>
                          <span>
                            نوع الطلب: <b>حزمة أنواع إضافية (+{req.extraTypesCount || DEFAULT_EXTRA_TYPES_PACK_SIZE} أنواع)</b>
                          </span>
                          <span>
                            المبلغ (مرة واحدة): <b>{req.addonPriceJod ?? DEFAULT_EXTRA_TYPES_PACK_PRICE_JOD} دنانير</b>
                          </span>
                          <span>الباقة: <b>{planName}</b></span>
                        </>
                      ) : (
                        <>
                          <span>الباقة: <b>{planName}</b></span>
                          <span>المدة: <b>{BILLING_CYCLE_LABELS[req.billingCycle]?.label || req.billingCycle}</b></span>
                        </>
                      )}
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
                            <span>
                              {req.requestType === "extra_types_addon"
                                ? `تأكيد الدفع وإضافة +${req.extraTypesCount || DEFAULT_EXTRA_TYPES_PACK_SIZE} أنواع فوراً`
                                : "تأكيد الدفع وتفعيل الاشتراك فوراً"}
                            </span>
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
              {!requests.length && (
                <p className="saas-empty">
                  {loading ? "جارٍ تحميل طلبات كليك..." : "لا توجد طلبات دفع عبر كليك حتى الآن."}
                </p>
              )}
            </div>
          )}

          {/* 3. تنبيهات قرب الانتهاء (< يومين) — محسوبة محلياً دون استهلاك قراءات أو كتابات إضافية */}
          {tab === "alerts" && (
            <div className="saas-admin-list">
              <div className="saas-note-banner">
                <b>الحسابات المتبقي لها أقل من يومين (تجريبية أو مدفوعة):</b>{" "}
                تظهر التنبيهات للمستخدم تلقائياً داخل التطبيق، ويمكنك هنا تذكير الورشة فوراً عبر
                البريد الإلكتروني أو واتساب مجاناً ضمن خطة Spark بدون أي خادم مدفوع.
              </div>

              {expiringTenants.map(({ tenant: t, access: ev }) => {
                const isBusy = busyId === t.ownerUid;
                const isTrial = ev.state === "trialing";
                const expiresAtIso = fmtDate(ev.expiresAtMs);
                const emailPkg = buildExpiryReminderEmailContent({
                  workshopName: t.workshopName || t.displayName || "ورشتي",
                  userEmail: t.email,
                  adminEmail: OWNER_ADMIN_EMAIL,
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
                      <span>الباقة: <b>{plans.find((p) => p.id === t.planId)?.name || t.planId}</b></span>
                    </div>

                    <div className="saas-tenant-acts">
                      <a href={emailPkg.mailtoUrl} className="btn sm p">
                        <Mail className="ico-xs" aria-hidden="true" />
                        <span>إرسال تذكير بالبريد الإلكتروني</span>
                      </a>
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

          {/* 4. الباقات وإعدادات كليك وواتساب */}
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
                <label className="saas-note-input">
                  <span>مدة التجربة المجانية (للعرض فقط — ثابتة في الإطلاق التجريبي)</span>
                  <input
                    value={`${DEFAULT_TRIAL_DAYS} أيام (ثابتة ولا يمكن تعديلها من الواجهة أو العميل)`}
                    readOnly
                    disabled
                  />
                </label>

                <button
                  type="button"
                  className="btn p sm"
                  disabled={busyId === "cfg"}
                  onClick={() => void handleSaveConfig()}
                >
                  <Save className="ico-xs" aria-hidden="true" />
                  <span>{busyId === "cfg" ? "جارٍ الحفظ..." : "حفظ إعدادات الدفع"}</span>
                </button>
              </div>

              <div className="saas-section">
                <h3>أمان الإدارة في المرحلة المجانية</h3>
                <p className="saas-cliq-note">
                  جميع صلاحيات الإدارة مقفولة حصراً على بريد المالك الأساسي الموثّق{" "}
                  <b dir="ltr">{OWNER_ADMIN_EMAIL}</b> داخل قواعد أمان Firestore (دون مدراء إضافيين
                  في هذه المرحلة لضمان أعلى أمان بأقل استهلاك قراءات على خطة Spark المجانية).
                </p>
              </div>

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
                    {(() => {
                      const def = getPlanDefaultsById(pl);
                      return (
                        <>
                          <div className="saas-form-row">
                            <label>
                              <span>حد الأنواع الجديدة (0 ممنوع، الحد الأقصى {LAUNCH_MAX_CUSTOM_TYPES})</span>
                              <input
                                type="number"
                                dir="ltr"
                                min={0}
                                max={LAUNCH_MAX_CUSTOM_TYPES}
                                value={pl.maxCustomTypes ?? def.maxCustomTypes}
                                onChange={(e) => {
                                  const val = Math.max(
                                    0,
                                    Math.min(LAUNCH_MAX_CUSTOM_TYPES, Number(e.target.value) || 0)
                                  );
                                  const next = plansDraft.slice();
                                  next[idx] = {
                                    ...pl,
                                    maxCustomTypes: val,
                                    allowCustomTypes: val !== 0,
                                  };
                                  setPlansDraft(next);
                                }}
                              />
                            </label>
                            <label>
                              <span>حد العلاقات الجديدة لكل نوع (-1 مفتوح)</span>
                              <input
                                type="number"
                                dir="ltr"
                                value={pl.maxCustomFieldsPerType ?? def.maxCustomFieldsPerType}
                                onChange={(e) => {
                                  const next = plansDraft.slice();
                                  next[idx] = { ...pl, maxCustomFieldsPerType: Number(e.target.value) };
                                  setPlansDraft(next);
                                }}
                              />
                            </label>
                          </div>

                          {(pl.allowExtraTypesAddon ?? def.allowExtraTypesAddon) && (
                            <div className="saas-form-row">
                              <label>
                                <span>عدد الأنواع في الحزمة الإضافية</span>
                                <input
                                  type="number"
                                  dir="ltr"
                                  value={pl.extraTypesPackSize ?? def.extraTypesPackSize}
                                  onChange={(e) => {
                                    const next = plansDraft.slice();
                                    next[idx] = { ...pl, extraTypesPackSize: Number(e.target.value) || 5 };
                                    setPlansDraft(next);
                                  }}
                                />
                              </label>
                              <label>
                                <span>سعر الحزمة (دينار / مرة واحدة مع الاشتراك)</span>
                                <input
                                  type="number"
                                  dir="ltr"
                                  value={pl.extraTypesPackPriceJod ?? def.extraTypesPackPriceJod}
                                  onChange={(e) => {
                                    const next = plansDraft.slice();
                                    next[idx] = { ...pl, extraTypesPackPriceJod: Number(e.target.value) || 0 };
                                    setPlansDraft(next);
                                  }}
                                />
                              </label>
                            </div>
                          )}

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
                              <span>السماح باستيراد وتصدير الأنواع والقياسات (PDF/Excel/JSON)</span>
                            </label>
                            <label>
                              <input
                                type="checkbox"
                                checked={pl.allowExtraTypesAddon ?? def.allowExtraTypesAddon}
                                onChange={(e) => {
                                  const next = plansDraft.slice();
                                  next[idx] = { ...pl, allowExtraTypesAddon: e.target.checked };
                                  setPlansDraft(next);
                                }}
                              />
                              <span>تفعيل حزم الأنواع الإضافية المدفوعة (لآخر باقة)</span>
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
                        </>
                      );
                    })()}
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
              {!logs.length && (
                <p className="saas-empty">
                  {loading ? "جارٍ تحميل سجل التدقيق..." : "لا توجد عمليات إدارية مسجلة بعد."}
                </p>
              )}
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
                  className="saas-close-btn"
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
