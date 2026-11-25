import { initializeApp } from "firebase/app";
import { ReCaptchaV3Provider, initializeAppCheck } from "firebase/app-check";
import { getAuth, GoogleAuthProvider, onAuthStateChanged } from "firebase/auth";
import { doc, getDocFromServer, getFirestore } from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// تهيئة Firebase App Check بشكل آمن ومجاني ضمن خطة Spark:
// - اختياري تماماً في التطوير المحلي (يدعم VITE_APPCHECK_DEBUG_TOKEN أثناء DEV فقط)
// - جاهز للإنتاج عبر مفتاح reCAPTCHA v3 العام (VITE_RECAPTCHA_V3_SITE_KEY) دون تخزين أي أسرار في الواجهة
// - ملاحظة: لا يصبح App Check فعّالاً فعلياً على الخادم إلا بعد تسجيل المفتاح وتفعيل Enforcement من Firebase Console
export type AppCheckMode = "active" | "debug" | "disabled";

let appCheckInitialized = false;
let resolvedAppCheckMode: AppCheckMode = "disabled";

if (typeof window !== "undefined") {
  const isDev = Boolean(import.meta.env?.DEV);
  const envSiteKey = (import.meta.env?.VITE_RECAPTCHA_V3_SITE_KEY as string | undefined) || "";
  const cfgSiteKey =
    typeof (firebaseConfig as { recaptchaSiteKey?: unknown }).recaptchaSiteKey === "string"
      ? ((firebaseConfig as { recaptchaSiteKey?: string }).recaptchaSiteKey as string)
      : "";
  const siteKey = (envSiteKey || cfgSiteKey).trim();

  const rawDebugToken = isDev
    ? ((import.meta.env?.VITE_APPCHECK_DEBUG_TOKEN as string | undefined) || "").trim()
    : "";

  if (isDev && rawDebugToken) {
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN =
      rawDebugToken === "true" ? true : rawDebugToken;
  }

  if (siteKey) {
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
      appCheckInitialized = true;
      resolvedAppCheckMode = isDev && rawDebugToken ? "debug" : "active";
    } catch (err) {
      console.warn("تعذر تهيئة App Check:", err);
    }
  } else if (!isDev) {
    console.warn(
      "App Check غير مفعّل بعد: أضف VITE_RECAPTCHA_V3_SITE_KEY (المفتاح العام فقط) قبل البناء وفعّل App Check من Firebase Console."
    );
  }
}

export const isAppCheckConfigured = appCheckInitialized;
export const appCheckMode: AppCheckMode = resolvedAppCheckMode;

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// فحص الاتصال لمرة واحدة فقط بعد تسجيل الدخول لتجنب القراءات المرفوضة للزوار غير المسجلين (توفير حصة Spark)
let connectionTested = false;
if (typeof window !== "undefined") {
  const unsubProbe = onAuthStateChanged(auth, (u) => {
    if (!u || connectionTested) return;
    connectionTested = true;
    unsubProbe();
    void getDocFromServer(doc(db, "test", "connection")).catch((error) => {
      if (error instanceof Error && error.message.includes("the client is offline")) {
        console.error("يرجى التحقق من اتصال Firebase.");
      }
    });
  });
}
