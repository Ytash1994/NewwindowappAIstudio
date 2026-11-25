import { CKEY, KEY, PKEY, RKEY } from "../engine/calc";
import type { AppState, SavedProject } from "../types";

const LEGACY_MIGRATION_MARKER = "winCalcLegacyMigratedByUid";
const PENDING_PROFILE_PREFIX = "winCalcPendingProfile::";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function getScopedKey(baseKey: string, uid: string): string {
  const safeUid = String(uid || "").replace(/[^a-zA-Z0-9_\-]/g, "");
  return `${baseKey}::${safeUid}`;
}

function getLocalStorageSafe(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function getSessionStorageSafe(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * ترحيل آمن لمرة واحدة للبيانات القديمة غير المقيّدة بـ uid إلى أول مستخدم موثّق فقط،
 * ثم حذف المفاتيح العالمية القديمة لمنع تسربها لأي مستخدم آخر على نفس الجهاز.
 */
export function migrateLegacyKeysOnceForUser(uid: string, storage?: StorageLike): boolean {
  const ls = getLocalStorageSafe(storage);
  if (!ls || !uid) return false;

  try {
    const alreadyMigratedBy = ls.getItem(LEGACY_MIGRATION_MARKER);
    const hasLegacy =
      ls.getItem(KEY) !== null ||
      ls.getItem(RKEY) !== null ||
      ls.getItem(CKEY) !== null ||
      ls.getItem(PKEY) !== null;

    if (!hasLegacy) return false;

    if (!alreadyMigratedBy) {
      const pairs: [string, string][] = [
        [KEY, getScopedKey(KEY, uid)],
        [RKEY, getScopedKey(RKEY, uid)],
        [CKEY, getScopedKey(CKEY, uid)],
        [PKEY, getScopedKey(PKEY, uid)],
      ];
      for (const [legacyKey, scopedKey] of pairs) {
        const val = ls.getItem(legacyKey);
        if (val !== null && ls.getItem(scopedKey) === null) {
          ls.setItem(scopedKey, val);
        }
        ls.removeItem(legacyKey);
      }
      ls.setItem(LEGACY_MIGRATION_MARKER, uid);
      return true;
    }

    // تنظيف أي مفاتيح عالمية متبقية بعد الترحيل
    ls.removeItem(KEY);
    ls.removeItem(RKEY);
    ls.removeItem(CKEY);
    ls.removeItem(PKEY);
    return false;
  } catch {
    return false;
  }
}

export function readScopedRawState(uid: string, storage?: StorageLike): Record<string, unknown> {
  const ls = getLocalStorageSafe(storage);
  if (!ls || !uid) return {};

  migrateLegacyKeysOnceForUser(uid, ls);

  let raw: Record<string, unknown> = {};
  try {
    const o = JSON.parse(ls.getItem(getScopedKey(KEY, uid)) || "null");
    if (o && typeof o === "object") raw = o;
  } catch {
    // تجاهل القيم التالفة
  }
  try {
    const r = JSON.parse(ls.getItem(getScopedKey(RKEY, uid)) || "null");
    if (r && typeof r === "object" && !Array.isArray(r)) raw.rel = r;
  } catch {
    // تجاهل
  }
  try {
    const c = JSON.parse(ls.getItem(getScopedKey(CKEY, uid)) || "null");
    if (c && typeof c === "object") {
      if (c.custom && typeof c.custom === "object") raw.custom = c.custom;
      if (c.cn) raw.cn = Math.max(Number(raw.cn) || 0, Number(c.cn) || 0);
      if (Array.isArray(c.utypes)) raw.utypes = c.utypes;
    }
  } catch {
    // تجاهل
  }
  return raw;
}

export function saveScopedAppState(uid: string | null | undefined, s: AppState, storage?: StorageLike): void {
  const ls = getLocalStorageSafe(storage);
  if (!ls || !uid) return;
  try {
    ls.setItem(
      getScopedKey(KEY, uid),
      JSON.stringify({
        type: s.type,
        rows: s.rows,
        sel: s.sel,
        inc: s.inc,
        dec: s.dec,
        rel: s.rel,
        rnd: s.rnd,
        gr: s.gr,
        custom: s.custom,
        cn: s.cn,
        utypes: s.utypes,
        cascade: s.cascade,
        view: s.view,
        layout: s.layout,
        unit: s.unit,
        step: s.step,
      })
    );
    ls.setItem(getScopedKey(RKEY, uid), JSON.stringify(s.rel || {}));
    ls.setItem(
      getScopedKey(CKEY, uid),
      JSON.stringify({ custom: s.custom, cn: s.cn, utypes: s.utypes })
    );
  } catch {
    // تجاهل امتلاء التخزين
  }
}

export function loadScopedProjects(uid: string | null | undefined, storage?: StorageLike): SavedProject[] {
  const ls = getLocalStorageSafe(storage);
  if (!ls || !uid) return [];
  migrateLegacyKeysOnceForUser(uid, ls);
  try {
    const raw = JSON.parse(ls.getItem(getScopedKey(PKEY, uid)) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((p): p is SavedProject => Boolean(p && p.id && p.name && p.data));
  } catch {
    return [];
  }
}

export function saveScopedProjects(
  uid: string | null | undefined,
  projects: SavedProject[],
  storage?: StorageLike
): void {
  const ls = getLocalStorageSafe(storage);
  if (!ls || !uid) return;
  try {
    ls.setItem(getScopedKey(PKEY, uid), JSON.stringify(projects));
  } catch {
    // تجاهل
  }
}

/**
 * تنظيف المفاتيح العالمية غير المعزولة عند تسجيل الخروج لضمان عدم تسرب بيانات الجلسة
 * مع إبقاء البيانات المعزولة لكل uid والسحابة سليمة بالكامل.
 */
export function cleanupLegacyGlobalKeys(storage?: StorageLike): void {
  const ls = getLocalStorageSafe(storage);
  if (!ls) return;
  try {
    ls.removeItem(KEY);
    ls.removeItem(RKEY);
    ls.removeItem(CKEY);
    ls.removeItem(PKEY);
  } catch {
    // تجاهل
  }
}

/** حفظ مؤقت لاسم الورشة ورقم الهاتف في sessionStorage ريثما يوثّق المستخدم بريده */
export function savePendingSignupProfile(
  uid: string,
  profile: { workshopName?: string; phone?: string }
): void {
  const ss = getSessionStorageSafe();
  if (!ss || !uid) return;
  try {
    ss.setItem(`${PENDING_PROFILE_PREFIX}${uid}`, JSON.stringify(profile));
  } catch {
    // تجاهل
  }
}

export function consumePendingSignupProfile(
  uid: string
): { workshopName?: string; phone?: string } | undefined {
  const ss = getSessionStorageSafe();
  if (!ss || !uid) return undefined;
  try {
    const key = `${PENDING_PROFILE_PREFIX}${uid}`;
    const raw = ss.getItem(key);
    if (!raw) return undefined;
    ss.removeItem(key);
    const parsed = JSON.parse(raw) as { workshopName?: string; phone?: string };
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
