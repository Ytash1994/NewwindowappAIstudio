import React, { useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  Check,
  Clock,
  Copy,
  CreditCard,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  MessageCircle,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  BILLING_CYCLE_LABELS,
  DEFAULT_PLANS,
  DEFAULT_WHATSAPP_PHONE,
  buildActivationMessage,
  buildWhatsAppActivationUrl,
  getPlanDefaultsById,
  resolvePlanLimits,
} from "./types";
import type {
  ActivationRequestDoc,
  BillingCycle,
  PlatformConfig,
  SubscriptionPlan,
  TenantAccount,
  TenantAccessEvaluation,
} from "./types";
import {
  changeOwnPassword,
  linkPasswordToAccount,
  sendOwnPasswordReset,
  submitActivationRequest,
  updateTenantProfile,
} from "./service";

interface SubscriptionModalProps {
  locked: boolean;
  user: User;
  tenant: TenantAccount;
  access: TenantAccessEvaluation;
  plans: SubscriptionPlan[];
  config: PlatformConfig;
  myRequests: ActivationRequestDoc[];
  onClose?: () => void;
  onSignOut: () => Promise<void>;
  onToast: (msg: string, ms?: number) => void;
}

export function SubscriptionModal({
  locked,
  user,
  tenant,
  access,
  plans,
  config,
  myRequests,
  onClose,
  onSignOut,
  onToast,
}: SubscriptionModalProps) {
  const activePlans = useMemo(
    () => (plans.length ? plans : DEFAULT_PLANS).filter((p) => p.active),
    [plans]
  );

  const [selectedPlanId, setSelectedPlanId] = useState<string>(
    activePlans.find((p) => p.id === tenant.planId)?.id || activePlans[1]?.id || activePlans[0]?.id || "starter"
  );
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [workshopName, setWorkshopName] = useState<string>(tenant.workshopName || tenant.displayName || "");
  const [phone, setPhone] = useState<string>(tenant.phone || "");
  const [cliqNote, setCliqNote] = useState<string>("");
  const [addonNote, setAddonNote] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submittingAddon, setSubmittingAddon] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [curPass, setCurPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmNewPass, setConfirmNewPass] = useState("");
  const [passBusy, setPassBusy] = useState(false);
  const [passwordLinkedNow, setPasswordLinkedNow] = useState(false);

  const hasPasswordProvider = useMemo(
    () =>
      passwordLinkedNow ||
      Boolean(user.providerData?.some((p) => p.providerId === "password")),
    [user.providerData, passwordLinkedNow]
  );

  const currentPlanObj = activePlans.find((p) => p.id === tenant.planId) || null;
  const currentLimits = useMemo(
    () => resolvePlanLimits(tenant, currentPlanObj, access.state === "owner_free"),
    [tenant, currentPlanObj, access.state]
  );

  const selectedPlan = activePlans.find((p) => p.id === selectedPlanId) || activePlans[0];
  const cycleInfo = BILLING_CYCLE_LABELS[billingCycle];
  const waPhoneDisplay = config.whatsappPhone || DEFAULT_WHATSAPP_PHONE;

  const waMessage = useMemo(
    () =>
      buildActivationMessage({
        workshopName: workshopName.trim() || tenant.workshopName || "ورشتي",
        email: tenant.email,
        planName: selectedPlan ? `${selectedPlan.name} (${selectedPlan.priceLabel})` : selectedPlanId,
        cycleLabel: cycleInfo.label,
        cliqNote: cliqNote.trim(),
        phone: phone.trim(),
      }),
    [workshopName, tenant.workshopName, tenant.email, selectedPlan, selectedPlanId, cycleInfo.label, cliqNote, phone]
  );

  const waUrl = useMemo(
    () => buildWhatsAppActivationUrl(waPhoneDisplay, waMessage),
    [waPhoneDisplay, waMessage]
  );

  const addonWaUrl = useMemo(() => {
    const lines = [
      "السلام عليكم، أرغب بطلب حزمة أنواع شبابيك إضافية (مرة واحدة مع الاشتراك الحالي):",
      `• الورشة: ${workshopName.trim() || tenant.workshopName || "ورشتي"}`,
      `• البريد: ${tenant.email}`,
      phone.trim() ? `• الهاتف: ${phone.trim()}` : "",
      `• الباقة الحالية: ${currentPlanObj?.name || tenant.planId}`,
      `• الحزمة المطلوبة: +${currentLimits.extraTypesPackSize} أنواع إضافية (${currentLimits.extraTypesPackPriceJod} دنانير — مرة واحدة مع الاشتراك)`,
      addonNote.trim() ? `• مرجع كليك: ${addonNote.trim()}` : "",
    ].filter(Boolean);
    return buildWhatsAppActivationUrl(waPhoneDisplay, lines.join("\n"));
  }, [
    workshopName,
    tenant.workshopName,
    tenant.email,
    phone,
    currentPlanObj?.name,
    tenant.planId,
    currentLimits.extraTypesPackSize,
    currentLimits.extraTypesPackPriceJod,
    addonNote,
    waPhoneDisplay,
  ]);

  const latestPending = myRequests.find(
    (r) => r.status === "pending" && r.requestType !== "extra_types_addon"
  );
  const latestPendingAddon = myRequests.find(
    (r) => r.status === "pending" && r.requestType === "extra_types_addon"
  );

  const handleRequestExtraTypesAddon = async () => {
    setSubmittingAddon(true);
    try {
      await submitActivationRequest(user, {
        workshopName: workshopName.trim() || tenant.workshopName || "ورشتي",
        phone: phone.trim(),
        planId: tenant.planId,
        billingCycle: "monthly",
        cliqNote:
          addonNote.trim() ||
          `طلب حزمة +${currentLimits.extraTypesPackSize} أنواع إضافية (${currentLimits.extraTypesPackPriceJod} دنانير)`,
        requestType: "extra_types_addon",
        extraTypesCount: currentLimits.extraTypesPackSize,
        addonPriceJod: currentLimits.extraTypesPackPriceJod,
      });
      setAddonNote("");
      onToast("تم تسجيل طلب حزمة الأنواع الإضافية بنجاح! سيتم إضافتها لحسابك فور تأكيد حوالة كليك ✓", 4200);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "تعذر تسجيل طلب الحزمة الإضافية", 3800);
    } finally {
      setSubmittingAddon(false);
    }
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      await updateTenantProfile(user.uid, {
        workshopName: workshopName.trim() || tenant.displayName || "ورشتي",
        phone: phone.trim(),
      });
      onToast("تم حفظ بيانات الورشة ✓");
    } catch {
      onToast("تعذر حفظ بيانات الورشة");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleRegisterRequest = async () => {
    setSubmitting(true);
    try {
      if (workshopName.trim() !== tenant.workshopName || phone.trim() !== tenant.phone) {
        await updateTenantProfile(user.uid, {
          workshopName: workshopName.trim() || tenant.workshopName || "ورشتي",
          phone: phone.trim(),
        });
      }
      await submitActivationRequest(user, {
        workshopName: workshopName.trim() || tenant.workshopName || "ورشتي",
        phone: phone.trim(),
        planId: selectedPlan?.id || "starter",
        billingCycle,
        cliqNote: cliqNote.trim(),
      });
      setCliqNote("");
      onToast("تم تسجيل طلب التفعيل في النظام! أرسله الآن عبر واتساب لتسريع التفعيل ✓", 4000);
    } catch {
      onToast("تعذر تسجيل طلب التفعيل، يرجى المحاولة مرة أخرى");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(waMessage);
      onToast("تم نسخ رسالة التفعيل ✓");
    } catch {
      onToast(`رقم الواتساب للتفعيل: ${waPhoneDisplay}`);
    }
  };

  const handleChangeOwnPassword = async () => {
    if (!curPass || newPass.length < 6) {
      onToast("أدخل كلمة المرور الحالية وكلمة مرور جديدة (6 أحرف على الأقل)", 3200);
      return;
    }
    setPassBusy(true);
    try {
      await changeOwnPassword(user, curPass, newPass);
      setCurPass("");
      setNewPass("");
      onToast("تم تغيير كلمة المرور بنجاح ✓");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("wrong-password") || msg.includes("invalid-credential")) {
        onToast("كلمة المرور الحالية غير صحيحة", 3200);
      } else {
        onToast("تعذر تغيير كلمة المرور، يمكنك استخدام رابط التعيين عبر الإيميل", 3500);
      }
    } finally {
      setPassBusy(false);
    }
  };

  const handleLinkPassword = async () => {
    if (newPass.length < 6) {
      onToast("كلمة المرور يجب أن تكون 6 أحرف على الأقل", 3200);
      return;
    }
    if (newPass !== confirmNewPass) {
      onToast("كلمتا المرور غير متطابقتين", 3200);
      return;
    }
    setPassBusy(true);
    try {
      await linkPasswordToAccount(user, newPass);
      setNewPass("");
      setConfirmNewPass("");
      setPasswordLinkedNow(true);
      onToast("تم تعيين كلمة مرور لحسابك بنجاح! يمكنك الآن الدخول بالإيميل وكلمة المرور ✓", 4200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("provider-already-linked")) {
        setPasswordLinkedNow(true);
        onToast("الحساب مرتبط بكلمة مرور مسبقاً، استخدم تغيير كلمة المرور", 3500);
      } else if (msg.includes("operation-not-allowed")) {
        onToast("خدمة الدخول بالبريد وكلمة المرور غير مفعّلة حالياً من إعدادات المنصة.", 4500);
      } else {
        onToast("تعذر ربط كلمة المرور حالياً، حاول مرة أخرى", 3500);
      }
    } finally {
      setPassBusy(false);
    }
  };

  const handleSendOwnReset = async () => {
    if (!tenant.email) return;
    setPassBusy(true);
    try {
      await sendOwnPasswordReset(tenant.email);
      onToast(
        `تم إرسال رابط التعيين إلى ${tenant.email}. افتح أحدث رسالة فقط (طلب رابط جديد يُلغي السابق) ✓`,
        4500
      );
    } catch {
      onToast("تعذر إرسال رابط التعيين حالياً", 3200);
    } finally {
      setPassBusy(false);
    }
  };

  const content = (
    <div className={`saas-sub-card${locked ? " is-locked" : ""}`} dir="rtl">
      <div className="saas-sub-head">
        <div className="saas-sub-title">
          {locked ? (
            <Lock className="ico saas-ico-bad" aria-hidden="true" />
          ) : (
            <CreditCard className="ico" aria-hidden="true" />
          )}
          <div>
            <h2>
              {locked
                ? access.state === "suspended"
                  ? "الحساب موقوف حالياً"
                  : access.state === "pending_payment"
                    ? "انتهت التجربة — طلب الدفع قيد المراجعة"
                    : "انتهت فترة التجربة المجانية"
                : "حساب الورشة والاشتراك"}
            </h2>
            <p>
              {locked
                ? access.state === "pending_payment"
                  ? "انتهت مدة التجربة ويبقى الحساب موقوفاً لحين تأكيد المدير لحوالة كليك (CliQ). جميع مشاريعك وبياناتك محفوظة بأمان وستعود فور تأكيد الدفع."
                  : "تم إغلاق استخدام الحاسبة والمشاريع السحابية لحين تفعيل الاشتراك عبر كليك (CliQ). حسابك ومشاريعك محفوظة بأمان ولن يتم حذفها."
                : access.state === "owner_free"
                  ? "حساب مالك المنصة — مجاني دائم بدون قيود."
                  : access.state === "active"
                    ? `اشتراك فعّال (${selectedPlan?.name || tenant.planId})${access.activeUntilMs ? ` · متبقي ${access.daysLeft} يوم` : " · دائم"}${access.hasPendingPayment ? " · طلب تجديد قيد المراجعة" : ""}`
                    : `تجربة مجانية فعالة · متبقي ${access.daysLeft} ${access.daysLeft === 1 ? "يوم" : "أيام"}${access.hasPendingPayment ? " · طلب دفع قيد المراجعة" : ""}`}
            </p>
          </div>
        </div>
        {!locked && onClose && (
          <button type="button" className="saas-close-btn" aria-label="إغلاق" onClick={onClose}>
            <X className="ico-sm" aria-hidden="true" />
          </button>
        )}
      </div>

      {tenant.adminNote && (
        <div className="saas-note-banner">
          <b>ملاحظة الإدارة:</b> {tenant.adminNote}
        </div>
      )}

      {(latestPending || access.hasPendingPayment) && (
        <div className="saas-pending-banner">
          <Clock className="ico-sm" aria-hidden="true" />
          <div>
            <b>لديك طلب دفع قيد المراجعة الإدارية</b>
            <small>
              {latestPending ? (
                <>
                  الباقة: {activePlans.find((p) => p.id === latestPending.planId)?.name || latestPending.planId} ·{" "}
                  {BILLING_CYCLE_LABELS[latestPending.billingCycle]?.label} —{" "}
                </>
              ) : null}
              تقديم الطلب لا يفعّل الاشتراك تلقائياً؛ عند تأكيد المدير لاستلام حوالة كليك تبدأ مدة
              الباقة من تاريخ التأكيد ويُفتح حسابك فوراً.
            </small>
          </div>
        </div>
      )}

      {/* بيانات الورشة */}
      <div className="saas-section">
        <h3>بيانات الورشة</h3>
        <div className="saas-form-row">
          <label>
            <span>اسم الورشة / الشركة</span>
            <input
              value={workshopName}
              maxLength={120}
              placeholder="مثال: ورشة الأمل للألمنيوم"
              onChange={(e) => setWorkshopName(e.target.value)}
            />
          </label>
          <label>
            <span>رقم الهاتف / واتساب الورشة</span>
            <input
              value={phone}
              maxLength={30}
              dir="ltr"
              placeholder="079xxxxxxx"
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
        </div>
        <div className="saas-profile-meta">
          <span>البريد: <b>{tenant.email}</b></span>
          <button
            type="button"
            className="btn sm"
            disabled={savingProfile}
            onClick={handleSaveProfile}
          >
            {savingProfile ? "جاري الحفظ..." : "حفظ بيانات الورشة"}
          </button>
        </div>

        <details className="saas-pass-details">
          <summary>
            <KeyRound className="ico-xs" aria-hidden="true" />
            <span>كلمة المرور والأمان</span>
          </summary>
          <div className="saas-pass-box">
            {hasPasswordProvider ? (
              <>
                <div className="saas-form-row">
                  <label>
                    <span>كلمة المرور الحالية</span>
                    <input
                      type="password"
                      dir="ltr"
                      value={curPass}
                      placeholder="••••••••"
                      onChange={(e) => setCurPass(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>كلمة المرور الجديدة (6 أحرف+)</span>
                    <input
                      type="password"
                      dir="ltr"
                      value={newPass}
                      placeholder="••••••••"
                      onChange={(e) => setNewPass(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="btn sm p"
                  disabled={passBusy}
                  onClick={() => void handleChangeOwnPassword()}
                >
                  {passBusy ? "جارٍ التحديث..." : "تحديث كلمة المرور"}
                </button>
              </>
            ) : (
              <>
                <p className="saas-cliq-note" style={{ marginBottom: 4 }}>
                  حسابك مسجّل عبر Google. يمكنك إضافة كلمة مرور مباشرة الآن للدخول بالبريد الإلكتروني
                  وكلمة المرور أيضاً بدون الحاجة لرابط بريد:
                </p>
                <div className="saas-form-row">
                  <label>
                    <span>كلمة المرور الجديدة (6 أحرف+)</span>
                    <input
                      type="password"
                      dir="ltr"
                      value={newPass}
                      placeholder="••••••••"
                      onChange={(e) => setNewPass(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>تأكيد كلمة المرور</span>
                    <input
                      type="password"
                      dir="ltr"
                      value={confirmNewPass}
                      placeholder="••••••••"
                      onChange={(e) => setConfirmNewPass(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="btn sm p"
                  disabled={passBusy}
                  onClick={() => void handleLinkPassword()}
                >
                  {passBusy ? "جارٍ التعيين..." : "تعيين كلمة مرور لحسابي الآن"}
                </button>
              </>
            )}
            <button
              type="button"
              className="btn sm"
              disabled={passBusy}
              onClick={() => void handleSendOwnReset()}
            >
              <Mail className="ico-xs" aria-hidden="true" />
              <span>إرسال رابط تعيين كلمة المرور إلى بريدي</span>
            </button>
          </div>
        </details>
      </div>

      {/* حزمة الأنواع الإضافية — خاصة بباقة الورش والمصانع الفعالة فقط */}
      {access.state === "active" && currentLimits.canRequestExtraTypesAddon && (
        <div className="saas-section saas-addon-box">
          <h3>حزمة أنواع شبابيك إضافية (خاصة بالباقة الأخيرة فقط)</h3>
          <p className="saas-cliq-note" style={{ marginBottom: 8 }}>
            حصتك الحالية في باقة <b>{currentPlanObj?.name || tenant.planId}</b>:{" "}
            <b>{currentLimits.baseMaxCustomTypes}</b> أنواع أساسية
            {currentLimits.extraTypesQuota > 0
              ? ` + ${currentLimits.extraTypesQuota} أنواع إضافية = ${currentLimits.maxCustomTypes} أنواع`
              : ""}.
            {" "}إذا احتجت لأكثر من ذلك، يمكنك طلب حزمة{" "}
            <b>+{currentLimits.extraTypesPackSize} أنواع إضافية</b> مقابل{" "}
            <b>{currentLimits.extraTypesPackPriceJod} دنانير</b> تُدفع مرة واحدة مع اشتراكك الحالي عبر كليك (CliQ).
          </p>

          {latestPendingAddon && (
            <div className="saas-pending-banner">
              <Clock className="ico-sm" aria-hidden="true" />
              <div>
                <b>لديك طلب حزمة أنواع إضافية قيد المراجعة (+{latestPendingAddon.extraTypesCount || currentLimits.extraTypesPackSize} أنواع)</b>
                <small>ستُضاف الحصة لحسابك فور تأكيد المدير لحوالة كليك دون انقطاع اشتراكك.</small>
              </div>
            </div>
          )}

          <label className="saas-note-input">
            <span>مرجع حوالة كليك لحزمة الأنواع الإضافية (اختياري)</span>
            <input
              value={addonNote}
              maxLength={300}
              placeholder="مثال: حوالة كليك لحزمة الأنواع الإضافية"
              onChange={(e) => setAddonNote(e.target.value)}
            />
          </label>

          <div className="saas-action-stack">
            <button
              type="button"
              className="btn p full"
              disabled={submittingAddon}
              onClick={() => void handleRequestExtraTypesAddon()}
            >
              <ShieldCheck className="ico-sm" aria-hidden="true" />
              <span>
                {submittingAddon
                  ? "جارٍ تسجيل الطلب..."
                  : `طلب +${currentLimits.extraTypesPackSize} أنواع إضافية (${currentLimits.extraTypesPackPriceJod} دنانير — مرة واحدة)`}
              </span>
            </button>
            <a
              href={addonWaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn g full"
            >
              <MessageCircle className="ico-sm" aria-hidden="true" />
              <span>إرسال طلب الحزمة عبر واتساب ({waPhoneDisplay})</span>
            </a>
          </div>
        </div>
      )}

      {/* اختيار الباقة والتفعيل عبر كليك وواتساب */}
      {access.state !== "owner_free" && (
        <>
          <div className="saas-section">
            <h3>1. اختر الباقة والمدة</h3>
            <div className="saas-plan-grid">
              {activePlans.map((pl) => {
                const isSel = pl.id === selectedPlan?.id;
                const plLim = getPlanDefaultsById(pl);
                const typesLine =
                  plLim.maxCustomTypes === 0
                    ? "بدون إضافة أنواع جديدة (الأنواع الـ 4 الأساسية فقط)"
                    : plLim.maxCustomTypes < 0
                      ? "إضافة أنواع جديدة غير محدودة"
                      : plLim.allowExtraTypesAddon
                        ? `إضافة حتى ${plLim.maxCustomTypes} أنواع جديدة (+ حزم إضافية مقابل ${plLim.extraTypesPackPriceJod} دينار/اشتراك)`
                        : `إضافة حتى ${plLim.maxCustomTypes} أنواع جديدة`;
                const fieldsLine =
                  plLim.maxCustomFieldsPerType < 0
                    ? "إضافة علاقات جديدة غير محدودة لكل نوع"
                    : `إضافة حتى ${plLim.maxCustomFieldsPerType} علاقات جديدة لكل نوع`;
                return (
                  <button
                    key={pl.id}
                    type="button"
                    className={`saas-plan-opt${isSel ? " sel" : ""}`}
                    onClick={() => setSelectedPlanId(pl.id)}
                  >
                    <div className="saas-plan-mini-top">
                      <b>{pl.name}</b>
                      <span className="saas-price-tag">{pl.priceLabel}</span>
                    </div>
                    <ul>
                      <li>
                        <Check className="ico-xs" aria-hidden="true" />
                        <span>{typesLine}</span>
                      </li>
                      <li>
                        <Check className="ico-xs" aria-hidden="true" />
                        <span>{fieldsLine}</span>
                      </li>
                      <li>
                        <Check className="ico-xs" aria-hidden="true" />
                        <span>تغيير ترتيب جميع العلاقات مسموح بالكامل</span>
                      </li>
                      <li>
                        <Check className="ico-xs" aria-hidden="true" />
                        <span>
                          {pl.maxProjects < 0
                            ? "مشاريع سحابية غير محدودة"
                            : `حتى ${pl.maxProjects} مشروعاً سحابياً`}{" "}
                          · {pl.allowExport ? "تصدير PDF و Excel" : "بدون تصدير PDF/Excel"}
                        </span>
                      </li>
                    </ul>
                  </button>
                );
              })}
            </div>

            <div className="saas-cycle-row">
              {(["monthly", "quarterly", "yearly"] as BillingCycle[]).map((cy) => (
                <button
                  key={cy}
                  type="button"
                  className={`saas-cycle-btn${billingCycle === cy ? " on" : ""}`}
                  onClick={() => setBillingCycle(cy)}
                >
                  {BILLING_CYCLE_LABELS[cy].label}
                </button>
              ))}
            </div>
          </div>

          <div className="saas-section saas-cliq-box">
            <h3>2. الدفع عبر كليك (CliQ) والتفعيل بالواتساب</h3>
            <div className="saas-cliq-details">
              <div><span>رقم واتساب التفعيل:</span> <b dir="ltr">{waPhoneDisplay}</b></div>
              <div><span>طريقة الدفع:</span> <b>{config.cliqBankName}</b></div>
              <div><span>الاسم المستعار / CliQ Alias:</span> <b>{config.cliqAlias}</b></div>
              <div><span>اسم المستفيد:</span> <b>{config.cliqHolderName}</b></div>
            </div>
            {config.supportNote && <p className="saas-cliq-note">{config.supportNote}</p>}

            <label className="saas-note-input">
              <span>ملاحظة أو رقم مرجع حوالة كليك (اختياري)</span>
              <input
                value={cliqNote}
                maxLength={300}
                placeholder="مثال: تم التحويل من حساب محمد - مرجع 12345"
                onChange={(e) => setCliqNote(e.target.value)}
              />
            </label>

            <div className="saas-action-stack">
              <button
                type="button"
                className="btn p full"
                disabled={submitting}
                onClick={handleRegisterRequest}
              >
                <ShieldCheck className="ico-sm" aria-hidden="true" />
                <span>{submitting ? "جاري تسجيل الطلب..." : "تسجيل طلب التفعيل في النظام"}</span>
              </button>

              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn g full"
                onClick={() => {
                  if (!latestPending) {
                    void handleRegisterRequest();
                  }
                }}
              >
                <MessageCircle className="ico-sm" aria-hidden="true" />
                <span>طلب التفعيل عبر واتساب ({waPhoneDisplay})</span>
              </a>

              <button type="button" className="btn sm full" onClick={handleCopyMessage}>
                <Copy className="ico-xs" aria-hidden="true" />
                <span>نسخ تفاصيل الطلب لإرسالها يدوياً على {waPhoneDisplay}</span>
              </button>
            </div>
          </div>
        </>
      )}

      <div className="saas-sub-footer">
        <button type="button" className="btn sm r" onClick={() => void onSignOut()}>
          <LogOut className="ico-xs" aria-hidden="true" />
          <span>تسجيل الخروج</span>
        </button>
        {!locked && onClose && (
          <button type="button" className="btn sm" onClick={onClose}>
            إغلاق
          </button>
        )}
      </div>
    </div>
  );

  if (locked) {
    return <div className="saas-gate-wrap">{content}</div>;
  }

  return (
    <div className="saas-modal-backdrop" onClick={onClose}>
      <div className="saas-modal-shell" onClick={(e) => e.stopPropagation()}>
        {content}
      </div>
    </div>
  );
}
