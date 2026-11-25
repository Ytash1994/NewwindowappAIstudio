import React from "react";

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let msg = error?.message || "حدث خطأ غير متوقع";
    try {
      const parsed = JSON.parse(msg) as { error?: string };
      if (parsed?.error) msg = parsed.error;
    } catch {
      // plain error string
    }
    return { hasError: true, message: msg };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("App ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="saas-gate-wrap" dir="rtl">
          <div className="saas-gate-card">
            <h2>حدث خطأ مؤقت في التطبيق</h2>
            <p className="saas-gate-sub">
              تعذر إتمام العملية الحالية. يرجى إعادة تحميل الصفحة أو تسجيل الدخول مرة أخرى.
            </p>
            <div className="saas-err-box">{this.state.message}</div>
            <button
              type="button"
              className="btn p full"
              onClick={() => window.location.reload()}
            >
              إعادة تحميل التطبيق
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
