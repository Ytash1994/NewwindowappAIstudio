import React, { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  CheckCircle2,
  ClipboardList,
  Copy,
  ExternalLink,
  KeyRound,
  Mail,
  MessageCircle,
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
  evaluateTenantAccess,
  normalizeJordanWhatsApp,
  tsToMs,
} from "./types";
import type {
  ActivationRequestDoc,
  AuditLogDoc,
  PlatformConfig,
  SubscriptionPlan,
  TenantAccount,
} from "./types";
import {
  adminActivateTenant,
  adminCreateWorkshopAccount,
  adminExtendTrial,
  adminReviewActivationRequest,
  adminSavePlan,
  adminSavePlatformConfig,
  adminSendPasswordResetLink,
  adminSuspendTenant,
  subscribeAllActivationRequests,
  subscribeAllTenants,
  subscribeAuditLogs,
} from "./service";

interface AdminPanelProps {
  adminUser: User;
  plans: SubscriptionPlan[];
  config: PlatformConfig;
  onClose: () => void;
  onToast: (msg: string, ms?: number) => void;
}

type AdminTab = "tenants" | "requests" | "settings" | "audit";

export function AdminPanel({
  adminUser,
  plans,
  config,
  onClose,
  onToast,
}: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>("tenants");
  const [tenants, setTenants] = useState<TenantAccount[]>([]);
  const [requests, setRequests] = useState<ActivationRequestDoc[]>([]);
  const [logs, setLogs] = useState<AuditLogDoc[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "trialing" | "active" | "locked">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [planChoiceByTenant, setPlanChoiceByTenant] = useState<Record<string, string>>({});

  // Password reset modal target
  const [resetTarget, setResetTarget] = useState<TenantAccount | null>(null);
  const [resetLinkSent, setResetLinkSent] = useState(false);

  // Manual account creation state (admin picks email + password)
  const [createOpen, setCreateOpen] = useState(false);
  const [newWorkshop, setNewWorkshop] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPlanId, setNewPlanId] = useState("trial");
  const [newDuration, setNewDuration] = useState<number>(30);
  const [createdCreds, setCreatedCreds] = useState<{ email: string; password: string; name: string } | null>(null);

  // Editable config state
  const [cfgDraft, setCfgDraft] = useState<PlatformConfig>(config);
  const [plansDraft, setPlansDraft] = useState<SubscriptionPlan[]>(plans);

  useEffect(() => {
    setCfgDraft(config);
  }, [config]);

  useEffect(() => {
    setPlansDraft(plans);
  }, [plans]);

  useEffect(() => {
    const unsub1 = subscribeAllTenants(setTenants);
    const unsub2 = subscribeAllActivationRequests(setRequests);
    const unsub3 = subscribeAuditLogs(setLogs);
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, []);

  const stats = useMemo(() => {
    let active = 0;
    let trialing = 0;
    let locked = 0;
    tenants.forEach((t) => {
      const ev = evaluateTenantAccess(t);
      if (ev.state === "owner_free" || ev.state === "active") active++;
      else if (ev.state === "trialing") trialing++;
      else locked++;
    });
    const pendingReqs = requests.filter((r) => r.status === "pending").length;
    return { total: tenants.length, active, trialing, locked, pendingReqs };
  }, [tenants, requests]);

  const filteredTenants = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return tenants.filter((t) => {
      const ev = evaluateTenantAccess(t);
      if (statusFilter === "trialing" && ev.state !== "trialing") return false;
      if (statusFilter === "active" && ev.state !== "active" && ev.state !== "owner_free") return false;
      if (statusFilter === "locked" && ev.allowed) return false;
      if (!q) return true;
      return (
        t.email.toLowerCase().includes(q) ||
        t.workshopName.toLowerCase().includes(q) ||
        t.phone.toLowerCase().includes(q) ||
        t.ownerUid.toLowerCase().includes(q)
      );
    });
  }, [tenants, searchQ, statusFilter]);

  const handleActivate = async (t: TenantAccount, durationDays: number | null) => {
    setBusyId(t.ownerUid);
    try {
      const chosenPlan = planChoiceByTenant[t.ownerUid] || (t.planId !== "trial" ? t.planId : plans[0]?.id || "starter");
      await adminActivateTenant(adminUser, t, {
        planId: chosenPlan,
        durationDays,
      });
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
      await adminExtendTrial(adminUser, t, days);
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
      await adminSuspendTenant(adminUser, t, "تم إغلاق الحساب لعدم السداد");
      onToast(`تم إغلاق حساب ${t.workshopName || t.email} فوراً`);
    } catch {
      onToast("تعذر إغلاق الحساب");
    } finally {
      setBusyId(null);
    }
  };

  const handleReviewReq = async (req: ActivationRequestDoc, decision: "approved" | "rejected") => {
    setBusyId(req.id);
    try {
      const target = tenants.find((t) => t.ownerUid === req.tenantId);
      const duration = BILLING_CYCLE_LABELS[req.billingCycle]?.days || 30;
      await adminReviewActivationRequest(adminUser, req, target, decision, duration);
      onToast(decision === "approved" ? "تمت الموافقة وتفعيل الحساب فوراً ✓" : "تم رفض الطلب");
    } catch {
      onToast("تعذر تنفيذ العملية على الطلب");
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveConfig = async () => {
    setBusyId("cfg");
    try {
      await adminSavePlatformConfig(adminUser, cfgDraft);
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
        onToast("تعذر إرسال رابط إعادة التعيين. تأكد من تفعيل Email/Password في Firebase Console.", 4200);
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
        planId: newPlanId,
        durationDays: newPlanId === "trial" ? null : newDuration,
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
      onToast("تم إنشاء حساب الورشة بكلمة المرور المحددة بنجاح ✓", 3800);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("email-already-in-use")) {
        onToast("هذا البريد مستخدم بالفعل. يمكنك إرسال رابط استعادة كلمة السر له.", 4200);
      } else if (msg.includes("operation-not-allowed")) {
        onToast("يرجى تفعيل مزوّد Email/Password في Firebase Console أولاً.", 4500);
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

  return (
    <div className="saas-modal-backdrop" onClick={onClose}>
      <div className="saas-admin-shell" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="saas-sub-head">
          <div className="saas-sub-title">
            <Shield className="ico" aria-hidden="true" />
            <div>
              <h2>لوحة إدارة المنصة (المالك)</h2>
              <p>تحكم كامل باشتراكات الورش، طلبات كليك، الباقات، وإغلاق الحسابات المنتهية</p>
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
          <button type="button" className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
            <Settings className="ico-xs" aria-hidden="true" />
            <span>الباقات وكليك</span>
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
                  <h3>إنشاء حساب ورشة بكلمة مرور يحددها الأدمن</h3>
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
                    <select value={newPlanId} onChange={(e) => setNewPlanId(e.target.value)}>
                      <option value="trial">تجربة مجانية (7 أيام)</option>
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          تفعيل مباشر: {p.name}
                        </option>
                      ))}
                    </select>
                    {newPlanId !== "trial" && (
                      <select
                        value={newDuration}
                        onChange={(e) => setNewDuration(Number(e.target.value) || 30)}
                      >
                        <option value={30}>30 يوم (شهر)</option>
                        <option value={90}>90 يوم (3 أشهر)</option>
                        <option value={365}>365 يوم (سنة)</option>
                      </select>
                    )}
                    <button
                      type="submit"
                      className="btn sm g"
                      disabled={busyId === "create_manual"}
                    >
                      <UserPlus className="ico-xs" aria-hidden="true" />
                      <span>{busyId === "create_manual" ? "جارٍ الإنشاء..." : "إنشاء الحساب الآن"}</span>
                    </button>
                  </div>
                  {createdCreds && (
                    <div className="saas-ok-box">
                      <div>
                        <b>تم إنشاء الحساب لـ {createdCreds.name}:</b>{" "}
                        <span dir="ltr">{createdCreds.email}</span> | كلمة المرور:{" "}
                        <b dir="ltr">{createdCreds.password}</b>
                      </div>
                      <button
                        type="button"
                        className="btn sm"
                        style={{ marginTop: 6 }}
                        onClick={() => {
                          const txt = `بيانات الدخول لحاسبة القياسات (${createdCreds.name}):\nالبريد: ${createdCreds.email}\nكلمة المرور: ${createdCreds.password}`;
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
                  const ev = evaluateTenantAccess(t);
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
                            ? "مالك (مجاني دائم)"
                            : ev.state === "active"
                              ? `مشترك (${ev.activeUntilMs ? `${ev.daysLeft} يوم` : "دائم"})`
                              : ev.state === "trialing"
                                ? `تجربة (متبقي ${ev.daysLeft} يوم)`
                                : ev.state === "suspended"
                                  ? "موقوف"
                                  : "منتهي - مقفل"}
                        </span>
                      </div>

                      <div className="saas-tenant-meta">
                        <span>الباقة: <b>{plans.find((p) => p.id === t.planId)?.name || t.planId}</b></span>
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
                          <button
                            type="button"
                            className="btn sm r"
                            disabled={isBusy}
                            onClick={() => void handleSuspend(t)}
                          >
                            إغلاق الحساب
                          </button>
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
                      `مرحباً ${req.workshopName}، تم تفعيل اشتراكك في حاسبة القياسات (${planName}) بنجاح.`
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
                          ? "قيد الانتظار"
                          : req.status === "approved"
                            ? "تم التفعيل"
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
                            <span>موافقة وتفعيل الاشتراك فوراً</span>
                          </button>
                          <button
                            type="button"
                            className="btn sm r"
                            disabled={isBusy}
                            onClick={() => void handleReviewReq(req, "rejected")}
                          >
                            <XCircle className="ico-xs" aria-hidden="true" />
                            <span>رفض</span>
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
              {!requests.length && <p className="saas-empty">لا توجد طلبات تفعيل عبر كليك حتى الآن.</p>}
            </div>
          )}

          {/* 3. الباقات وإعدادات الدفع كليك */}
          {tab === "settings" && (
            <div className="saas-admin-list">
              <div className="saas-section">
                <h3>إعدادات الدفع عبر كليك (CliQ) وواتساب التفعيل</h3>
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
                <button
                  type="button"
                  className="btn p sm"
                  disabled={busyId === "cfg"}
                  onClick={() => void handleSaveConfig()}
                >
                  <Save className="ico-xs" aria-hidden="true" />
                  <span>{busyId === "cfg" ? "جاري الحفظ..." : "حفظ إعدادات كليك وواتساب"}</span>
                </button>
              </div>

              <div className="saas-section">
                <h3>تعديل الباقات والأسعار</h3>
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

          {/* 4. سجل التدقيق */}
          {tab === "audit" && (
            <div className="saas-admin-list">
              {logs.map((lg) => (
                <div key={lg.id} className="saas-audit-item">
                  <div>
                    <b>{lg.action}</b> — <span>{lg.details}</span>
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

        {/* نافذة إعادة تعيين كلمة المرور (إيميل + خيارات يدوية للأدمن) */}
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
                <h3>1. إرسال رابط إعادة التعيين عبر الإيميل (فوري ومجاني)</h3>
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
                        `مرحباً ${resetTarget.workshopName || ""}، تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني (${resetTarget.email}). يرجى فحص البريد الوارد أو الرسائل غير المرغوب فيها (Spam).`
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
                <h3>2. التعيين اليدوي من الأدمن</h3>
                <p className="saas-cliq-note">
                  على الخطة المجانية (Firebase Starter Tier بدون خادم Admin SDK) لا يسمح Firebase
                  باستبدال كلمة مرور مستخدم قائم مباشرةً من المتصفح، ولكن يمكنك تنفيذ التعيين اليدوي
                  عبر:
                </p>
                <div className="saas-action-stack">
                  <a
                    href={firebaseAuthConsoleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn sm full"
                  >
                    <ExternalLink className="ico-xs" aria-hidden="true" />
                    <span>فتح إدارة المستخدمين في Firebase Console</span>
                  </a>
                  <button
                    type="button"
                    className="btn sm full"
                    onClick={() => {
                      const target = resetTarget;
                      setResetTarget(null);
                      setCreateOpen(true);
                      setNewWorkshop(target.workshopName || target.displayName || "");
                      setNewPhone(target.phone || "");
                      setNewEmail("");
                      setNewPassword("");
                    }}
                  >
                    <UserPlus className="ico-xs" aria-hidden="true" />
                    <span>إنشاء حساب جديد بكلمة مرور يحددها الأدمن يدوياً</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
