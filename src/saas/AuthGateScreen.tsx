import React, { useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  MessageCircle,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import appIconUrl from "../assets/app-icon.png";
import { DEFAULT_PLANS, DEFAULT_WHATSAPP_PHONE, normalizeJordanWhatsApp } from "./types";
import type { PlatformConfig, SubscriptionPlan } from "./types";

export interface EmailSignUpPayload {
  workshopName: string;
  phone: string;
  email: string;
  password: string;
}

interface AuthGateScreenProps {
  onGoogleSignIn: () => Promise<void>;
  onEmailSignIn: (email: string, password: string) => Promise<void>;
  onEmailSignUp: (payload: EmailSignUpPayload) => Promise<void>;
  onForgotPassword: (email: string) => Promise<boolean>;
  plans: SubscriptionPlan[];
  config: PlatformConfig;
  authError: string;
  onClearError: () => void;
}

type AuthMode = "login" | "register" | "forgot";

export function AuthGateScreen({
  onGoogleSignIn,
  onEmailSignIn,
  onEmailSignUp,
  onForgotPassword,
  plans,
  config,
  authError,
  onClearError,
}: AuthGateScreenProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [workshopName, setWorkshopName] = useState("");
  const [phone, setPhone] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [localError, setLocalError] = useState("");
  const [resetSentMsg, setResetSentMsg] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  React.useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = window.setInterval(() => {
      setResendCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => window.clearInterval(t);
  }, [resendCooldown]);

  const waNum = normalizeJordanWhatsApp(config.whatsappPhone || DEFAULT_WHATSAPP_PHONE);
  const visiblePlans = (plans.length ? plans : DEFAULT_PLANS).filter((p) => p.active);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setLocalError("");
    setResetSentMsg("");
    onClearError();
  };

  const handleGoogle = async () => {
    setLocalError("");
    setResetSentMsg("");
    setGoogleBusy(true);
    try {
      await onGoogleSignIn();
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");
    setResetSentMsg("");
    onClearError();

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setLocalError("يرجى إدخال بريد إلكتروني صحيح.");
      return;
    }

    if (mode === "forgot") {
      if (resendCooldown > 0) {
        setLocalError(`يرجى الانتظار ${resendCooldown} ثانية قبل طلب رابط جديد حتى لا يُلغى الرابط السابق.`);
        return;
      }
      setBusy(true);
      try {
        const ok = await onForgotPassword(trimmedEmail);
        if (ok) {
          setResendCooldown(60);
          setResetSentMsg(
            `تم إرسال رابط إعادة تعيين كلمة المرور إلى ${trimmedEmail}. افتح أحدث رسالة فقط خلال 10 دقائق (طلب رابط جديد يُلغي الرابط السابق فوراً).`
          );
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    if (password.length < 6) {
      setLocalError("كلمة المرور يجب أن تكون 6 أحرف على الأقل.");
      return;
    }

    if (mode === "register") {
      if (!workshopName.trim()) {
        setLocalError("يرجى إدخال اسم الورشة أو اسمك.");
        return;
      }
      if (password !== confirmPassword) {
        setLocalError("كلمتا المرور غير متطابقتين.");
        return;
      }
      setBusy(true);
      try {
        await onEmailSignUp({
          workshopName: workshopName.trim(),
          phone: phone.trim(),
          email: trimmedEmail,
          password,
        });
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      await onEmailSignIn(trimmedEmail, password);
    } finally {
      setBusy(false);
    }
  };

  const displayError = localError || authError;

  return (
    <div className="saas-gate-wrap" dir="rtl">
      <div className="saas-gate-card">
        <div className="saas-gate-brand">
          <img src={appIconUrl} alt="حاسبة القياسات" className="saas-gate-logo" />
          <div>
            <h1>حاسبة قياسات الشبابيك</h1>
            <p>منصة سحابية متكاملة لورش الألمنيوم والشبابيك</p>
          </div>
        </div>

        <div className="saas-trial-highlight">
          <ShieldCheck className="ico" aria-hidden="true" />
          <div>
            <b>تجربة مجانية لمدة {config.trialDaysDefault || 7} أيام بعد توثيق البريد الإلكتروني</b>
            <small>
              بعد إنشاء الحساب سنرسل رسالة توثيق لبريدك؛ وبمجرد التوثيق تبدأ تجربتك المجانية فوراً
              (تصدير ملفات PDF و Excel متاح بدءاً من الباقة الاحترافية). بعد انتهاء التجربة يُغلق
              الحساب تلقائياً مع حفظ كامل مشاريعك لحين التفعيل عبر كليك (CliQ).
            </small>
          </div>
        </div>

        {/* تبويبات تسجيل الدخول / إنشاء حساب */}
        <div className="saas-auth-tabs" role="tablist" aria-label="طريقة الدخول">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={mode === "login" ? "on" : ""}
            onClick={() => switchMode("login")}
          >
            <LogIn className="ico-xs" aria-hidden="true" />
            <span>تسجيل الدخول</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={mode === "register" ? "on" : ""}
            onClick={() => switchMode("register")}
          >
            <UserPlus className="ico-xs" aria-hidden="true" />
            <span>إنشاء حساب جديد</span>
          </button>
        </div>

        {displayError && <div className="saas-err-box">{displayError}</div>}
        {resetSentMsg && <div className="saas-ok-box">{resetSentMsg}</div>}

        <form className="saas-auth-form" onSubmit={handleSubmit}>
          {mode === "register" && (
            <div className="saas-form-row">
              <label>
                <span>اسم الورشة / المستخدم *</span>
                <input
                  value={workshopName}
                  maxLength={120}
                  placeholder="مثال: ورشة الأمل للألمنيوم"
                  autoComplete="organization"
                  onChange={(e) => setWorkshopName(e.target.value)}
                />
              </label>
              <label>
                <span>رقم الهاتف / واتساب (اختياري)</span>
                <input
                  value={phone}
                  maxLength={30}
                  dir="ltr"
                  placeholder="079xxxxxxx"
                  autoComplete="tel"
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
            </div>
          )}

          <label className="saas-note-input">
            <span>البريد الإلكتروني *</span>
            <input
              type="email"
              dir="ltr"
              value={email}
              maxLength={200}
              placeholder="name@example.com"
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          {mode !== "forgot" && (
            <label className="saas-note-input">
              <span>كلمة المرور *</span>
              <div className="saas-pass-wrap">
                <input
                  type={showPass ? "text" : "password"}
                  dir="ltr"
                  value={password}
                  minLength={6}
                  maxLength={128}
                  placeholder="••••••••"
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="saas-pass-eye"
                  aria-label={showPass ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                  onClick={() => setShowPass((v) => !v)}
                >
                  {showPass ? (
                    <EyeOff className="ico-xs" aria-hidden="true" />
                  ) : (
                    <Eye className="ico-xs" aria-hidden="true" />
                  )}
                </button>
              </div>
            </label>
          )}

          {mode === "register" && (
            <label className="saas-note-input">
              <span>تأكيد كلمة المرور *</span>
              <input
                type={showPass ? "text" : "password"}
                dir="ltr"
                value={confirmPassword}
                minLength={6}
                maxLength={128}
                placeholder="أعد كتابة كلمة المرور"
                autoComplete="new-password"
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </label>
          )}

          <button
            type="submit"
            className="btn p full"
            disabled={busy || googleBusy || (mode === "forgot" && resendCooldown > 0)}
          >
            {mode === "forgot" ? (
              <>
                <Mail className="ico-sm" aria-hidden="true" />
                <span>
                  {busy
                    ? "جارٍ الإرسال..."
                    : resendCooldown > 0
                      ? `تم الإرسال (إعادة الإرسال بعد ${resendCooldown} ثانية)`
                      : "إرسال رابط إعادة تعيين كلمة المرور"}
                </span>
              </>
            ) : mode === "register" ? (
              <>
                <UserPlus className="ico-sm" aria-hidden="true" />
                <span>{busy ? "جارٍ إنشاء الحساب..." : "إنشاء حساب وبدء تجربة 7 أيام"}</span>
              </>
            ) : (
              <>
                <LogIn className="ico-sm" aria-hidden="true" />
                <span>{busy ? "جارٍ تسجيل الدخول..." : "تسجيل الدخول"}</span>
              </>
            )}
          </button>

          <div className="saas-auth-aux">
            {mode === "login" ? (
              <button
                type="button"
                className="saas-link-btn"
                onClick={() => switchMode("forgot")}
              >
                <KeyRound className="ico-xs" aria-hidden="true" />
                <span>نسيت كلمة المرور؟</span>
              </button>
            ) : mode === "forgot" ? (
              <button
                type="button"
                className="saas-link-btn"
                onClick={() => switchMode("login")}
              >
                <span>العودة لتسجيل الدخول</span>
              </button>
            ) : null}
          </div>
        </form>

        <div className="saas-divider">
          <span>أو الدخول السريع عبر Google</span>
        </div>

        <button
          type="button"
          className="btn full saas-google-btn"
          disabled={busy || googleBusy}
          onClick={handleGoogle}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M21.35 11.1h-9.18v2.92h5.27c-.23 1.48-1.74 4.35-5.27 4.35-3.17 0-5.76-2.63-5.76-5.87s2.59-5.87 5.76-5.87c1.81 0 3.02.77 3.71 1.43l2.53-2.44C16.79 4.1 14.7 3.2 12.17 3.2 7.12 3.2 3 7.32 3 12.5s4.12 9.3 9.17 9.3c5.29 0 8.8-3.72 8.8-8.95 0-.6-.06-1.06-.15-1.75Z"
            />
          </svg>
          <span>{googleBusy ? "جارٍ تسجيل الدخول..." : "المتابعة بحساب Google"}</span>
        </button>

        <div className="saas-plans-preview">
          <h3>الباقات المتاحة بعد التجربة</h3>
          <div className="saas-plan-grid">
            {visiblePlans.map((pl) => (
              <div key={pl.id} className="saas-plan-mini">
                <div className="saas-plan-mini-top">
                  <b>{pl.name}</b>
                  <span className="saas-price-tag">{pl.priceLabel}</span>
                </div>
                <ul>
                  {(pl.features || []).slice(0, 3).map((f, idx) => (
                    <li key={idx}>
                      <Check className="ico-xs" aria-hidden="true" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="saas-gate-footer">
          <div className="saas-gate-locknote">
            <Lock className="ico-sm" aria-hidden="true" />
            <span>حساب كل ورشة ومشاريعها معزولة ومحمية بالكامل.</span>
          </div>
          <a
            href={`https://wa.me/${waNum}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn sm g"
          >
            <MessageCircle className="ico-sm" aria-hidden="true" />
            <span>تواصل للتفعيل واتساب ({config.whatsappPhone || DEFAULT_WHATSAPP_PHONE})</span>
          </a>
        </div>
      </div>
    </div>
  );
}
