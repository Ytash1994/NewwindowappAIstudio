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

// تهيئة Firebase App Check بشكل آمن ومشروط (يُفعّل تلقائياً عند ضبط مفتاح reCAPTCHA v3 — مجاني ضمن خطة Spark)
let appCheckInitialized = false;
if (typeof window !== "undefined") {
  const siteKey = (
    (import.meta.env?.VITE_RECAPTCHA_V3_SITE_KEY as string | undefined) ||
    firebaseConfig.recaptchaSiteKey ||
    ""
  ).trim();

  if (import.meta.env?.DEV && import.meta.env?.VITE_APPCHECK_DEBUG_TOKEN) {
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN =
      import.meta.env.VITE_APPCHECK_DEBUG_TOKEN === "true"
        ? true
        : String(import.meta.env.VITE_APPCHECK_DEBUG_TOKEN);
  }

  if (siteKey) {
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
      appCheckInitialized = true;
    } catch (err) {
      console.warn("تعذر تهيئة App Check:", err);
    }
  }
}

export const isAppCheckConfigured = appCheckInitialized;

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
