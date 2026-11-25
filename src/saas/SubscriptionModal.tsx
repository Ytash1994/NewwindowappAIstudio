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
  const [submitting, setSubmitting] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [curPass, setCurPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [passBusy, setPassBusy] = useState(false);

  const hasPasswordProvider = useMemo(
    () => Boolean(user.providerData?.some((p) => p.providerId === "password")),
    [user.providerData]
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

  const latestPending = myRequests.find((r) => r.status === "pending");

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

  const handleSendOwnReset = async () => {
    if (!tenant.email) return;
    setPassBusy(true);
    try {
      await sendOwnPasswordReset(tenant.email);
      onToast(`تم إرسال رابط تعيين كلمة المرور إلى ${tenant.email} ✓`, 3800);
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
                  : "انتهت فترة التجربة المجانية"
                : "حساب الورشة والاشتراك"}
            </h2>
            <p>
              {locked
                ? "تم إغلاق استخدام الحاسبة لحين تفعيل الاشتراك عبر كليك (CliQ). بياناتك ومشاريعك محفوظة بأمان وستعود فور التفعيل."
                : access.state === "owner_free"
                  ? "حساب مالك المنصة — مجاني دائم بدون قيود."
                  : access.state === "active"
                    ? `اشتراك فعّال (${selectedPlan?.name || tenant.planId})${access.activeUntilMs ? ` · متبقي ${access.daysLeft} يوم` : " · دائم"}`
                    : `تجربة مجانية فعالة · متبقي ${access.daysLeft} ${access.daysLeft === 1 ? "يوم" : "أيام"}`}
            </p>
          </div>
        </div>
        {!locked && onClose && (
          <button type="button" className="thm" aria-label="إغلاق" onClick={onClose}>
            <X className="ico-sm" aria-hidden="true" />
          </button>
        )}
      </div>

      {tenant.adminNote && (
        <div className="saas-note-banner">
          <b>ملاحظة الإدارة:</b> {tenant.adminNote}
        </div>
      )}

      {latestPending && (
        <div className="saas-pending-banner">
          <Clock className="ico-sm" aria-hidden="true" />
          <div>
            <b>لديك طلب تفعيل قيد المراجعة</b>
            <small>
              الباقة: {activePlans.find((p) => p.id === latestPending.planId)?.name || latestPending.planId} ·{" "}
              {BILLING_CYCLE_LABELS[latestPending.billingCycle]?.label} — بمجرد تأكيد حوالة كليك على
              الواتساب سيُفتح حسابك تلقائياً خلال لحظات.
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
            {hasPasswordProvider && (
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

      {/* اختيار الباقة والتفعيل عبر كليك وواتساب */}
      {access.state !== "owner_free" && (
        <>
          <div className="saas-section">
            <h3>1. اختر الباقة والمدة</h3>
            <div className="saas-plan-grid">
              {activePlans.map((pl) => {
                const isSel = pl.id === selectedPlan?.id;
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
                      {(pl.features || []).map((f, idx) => (
                        <li key={idx}>
                          <Check className="ico-xs" aria-hidden="true" />
                          <span>{f}</span>
                        </li>
                      ))}
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
