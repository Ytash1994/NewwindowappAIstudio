import React, { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { CheckCircle2, LogOut, MailCheck, RefreshCw, Send } from "lucide-react";
import appIconUrl from "../assets/app-icon.png";

interface EmailVerificationGateProps {
  user: User;
  onResendVerification: () => Promise<boolean>;
  onCheckVerified: () => Promise<boolean>;
  onSignOut: () => Promise<void>;
}

export function EmailVerificationGate({
  user,
  onResendVerification,
  onCheckVerified,
  onSignOut,
}: EmailVerificationGateProps) {
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => window.clearInterval(t);
  }, [cooldown]);

  // فحص تلقائي عند عودة المستخدم للتبويب بعد الضغط على رابط التوثيق
  useEffect(() => {
    const onFocus = () => {
      void onCheckVerified();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [onCheckVerified]);

  const handleCheck = async () => {
    setErrorMsg("");
    setStatusMsg("");
    setChecking(true);
    try {
      const ok = await onCheckVerified();
      if (!ok) {
        setErrorMsg(
          "لم يتم تأكيد توثيق البريد بعد. افتح رسالة التوثيق في بريدك (أو مجلد الرسائل غير المرغوب فيها) واضغط الرابط ثم أعد المحاولة."
        );
      }
    } catch {
      setErrorMsg("تعذر تحديث حالة التوثيق حالياً، يرجى المحاولة مرة أخرى.");
    } finally {
      setChecking(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setErrorMsg("");
    setStatusMsg("");
    setResending(true);
    try {
      const sent = await onResendVerification();
      if (sent) {
        setCooldown(60);
        setStatusMsg(
          `تم إرسال رسالة توثيق جديدة إلى ${user.email || "بريدك الإلكتروني"}. افتح أحدث رسالة واضغط رابط التفعيل.`
        );
      } else {
        setErrorMsg("تعذر إرسال رسالة التوثيق حالياً، يرجى الانتظار قليلاً والمحاولة مرة أخرى.");
      }
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="saas-gate-wrap" dir="rtl">
      <div className="saas-gate-card">
        <div className="saas-gate-brand">
          <img src={appIconUrl} alt="حاسبة القياسات" className="saas-gate-logo" />
          <div>
            <h1>توثيق البريد الإلكتروني مطلوب</h1>
            <p>خطوة أمنية سريعة قبل إنشاء حساب الورشة وبدء التجربة المجانية</p>
          </div>
        </div>

        <div className="saas-trial-highlight">
          <MailCheck className="ico" aria-hidden="true" />
          <div>
            <b>أرسلنا رابط التوثيق إلى بريدك الإلكتروني</b>
            <small>
              البريد المسجّل: <b dir="ltr">{user.email || "—"}</b>
              <br />
              لا يتم إنشاء حساب الورشة ولا تبدأ فترة التجربة المجانية (7 أيام) إلا بعد توثيق بريدك
              بنجاح. يرجى فحص البريد الوارد أو مجلد الرسائل غير المرغوب فيها (Spam).
            </small>
          </div>
        </div>

        {errorMsg && <div className="saas-err-box">{errorMsg}</div>}
        {statusMsg && <div className="saas-ok-box">{statusMsg}</div>}

        <div className="saas-action-stack">
          <button
            type="button"
            className="btn p full"
            disabled={checking || resending}
            onClick={() => void handleCheck()}
          >
            {checking ? (
              <RefreshCw className="ico-sm" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="ico-sm" aria-hidden="true" />
            )}
            <span>{checking ? "جارٍ التحقق من حالة التوثيق..." : "تحققت من بريدي — متابعة الدخول"}</span>
          </button>

          <button
            type="button"
            className="btn full"
            disabled={resending || checking || cooldown > 0}
            onClick={() => void handleResend()}
          >
            <Send className="ico-sm" aria-hidden="true" />
            <span>
              {resending
                ? "جارٍ إعادة الإرسال..."
                : cooldown > 0
                  ? `إعادة إرسال رسالة التوثيق بعد ${cooldown} ثانية`
                  : "إعادة إرسال رسالة التوثيق"}
            </span>
          </button>

          <button
            type="button"
            className="btn sm r full"
            disabled={checking || resending}
            onClick={() => void onSignOut()}
          >
            <LogOut className="ico-xs" aria-hidden="true" />
            <span>تسجيل الخروج واستخدام بريد آخر</span>
          </button>
        </div>
      </div>
    </div>
  );
}
