import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { safeFetch } from "../lib/safeFetch";
import {
  clearTerminalToken,
  getTerminalId,
  setTerminalToken,
} from "../lib/terminalSession";
import { useAuth, type SessionUser } from "../auth/AuthContext";
import type { RoleId } from "../auth/roles";
import { getApiBase } from "../lib/apiBase";

type TerminalSettings = {
  sharedTerminalEnabled: boolean;
  // Hybrid v2:
  slidingRefreshAfterAction: boolean;
  stepUpForDangerOps: boolean;
  hardLogoutMinutes: number;
  // Idle window (used in both modes — hybrid: sliding window after each op):
  idleLockMinutes: number;
  // Classic mode (only used when slidingRefreshAfterAction = false):
  lockAfterSave: boolean;
  lockAfterEdit: boolean;
  lockAfterSend: boolean;
  lockAfterDelete: boolean;
  lockAfterDiscount: boolean;
  lockAfterReturn: boolean;
  // Lockout policy:
  maxAttemptsBeforeLockout: number;
  lockoutSeconds: number;
  tokenTtlSeconds: number;
};

const DEFAULT_SETTINGS: TerminalSettings = {
  sharedTerminalEnabled: false,
  slidingRefreshAfterAction: true,
  stepUpForDangerOps: true,
  hardLogoutMinutes: 10,
  idleLockMinutes: 2,
  lockAfterSave: false,
  lockAfterEdit: false,
  lockAfterSend: false,
  lockAfterDelete: false,
  lockAfterDiscount: false,
  lockAfterReturn: false,
  maxAttemptsBeforeLockout: 3,
  lockoutSeconds: 30,
  tokenTtlSeconds: 900,
};

export type LockReason =
  | "manual"
  | "idle"
  | "after_save"
  | "after_edit"
  | "after_send"
  | "after_delete"
  | "after_discount"
  | "after_return"
  | "boot"
  | "token_expired"
  | "hard_logout";

type LockState = {
  locked: boolean;
  reason: LockReason | null;
  failedAttempts: number;
  lockoutUntilEpoch: number | null;
};

export type SensitiveTrigger = "save" | "edit" | "send" | "delete" | "discount" | "return";

export type DangerOp = "discount" | "void_line" | "refund" | "minimum_charge_override" | "manager_override";

type PinVerifyResponse = {
  ok: true;
  user: { id: string; login?: string; name?: string; role?: string };
  terminalToken: string;
  ttlSeconds: number;
};

type Ctx = {
  settings: TerminalSettings;
  enabled: boolean;
  lockState: LockState;
  /** يرفع overlay يدويّاً (مثلاً زر «قفل الجلسة»). */
  lockTerminal: (reason?: LockReason) => void;
  /** يستدعى من العمليات الروتينية الناجحة:
   *  - في النمط الهجين (slidingRefreshAfterAction=true): يجدّد عداد الخمول بدون قفل.
   *  - في النمط الكلاسيكي: يقفل بعد العملية إذا كان lockAfter<X> مفعّلاً. */
  triggerLock: (trigger: SensitiveTrigger) => void;
  /** ريفرش يدوي للإعدادات (بعد حفظ صفحة الإعدادات). */
  refreshSettings: () => Promise<void>;
  /** يُضرَب من listeners الإدخال — يُعيد عدّاد الخمول. */
  pingActivity: () => void;
  /** التحقق من PIN ضد الباك-إند → في حالة النجاح يُغلق الـ overlay. يبدّل المستخدم تلقائياً إن اختلف. */
  unlockWithPin: (pin: string, login?: string) => Promise<{ ok: true } | { ok: false; error: string; lockoutUntilEpoch?: number }>;
  /** Step-up: PIN فوري مرتبط بعملية بعينها. لا يرفع overlay عام؛ يعيد ok/error.
   *  لو الـ token الحالي لم تنقضِ مدته أقل من stepUpFreshSeconds، يمكن تخطّي PIN (skipIfRecent). */
  stepUp: (pin: string, opts: { reason: DangerOp; skipIfRecent?: boolean; freshSeconds?: number; login?: string }) => Promise<{ ok: true } | { ok: false; error: string; lockoutUntilEpoch?: number }>;
  /** يتحقق ما إذا كان الـ token الحالي «حديث» بما يكفي ليُتجاوز PIN في step-up. */
  isTokenFresh: (freshSeconds?: number) => boolean;
};

const TerminalLockContext = createContext<Ctx | null>(null);

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function TerminalLockProvider({ children }: { children: ReactNode }) {
  const { user, login, logout } = useAuth();
  const [settings, setSettings] = useState<TerminalSettings>(DEFAULT_SETTINGS);
  const [lockState, setLockState] = useState<LockState>({
    locked: false,
    reason: null,
    failedAttempts: 0,
    lockoutUntilEpoch: null,
  });

  const enabled = !!settings.sharedTerminalEnabled;
  const lastTokenIssuedAtRef = useRef<number>(0); // متى أُصدر آخر terminalToken (epoch sec)
  const idleTimerRef = useRef<number | null>(null);
  const hardLogoutTimerRef = useRef<number | null>(null);

  const refreshSettings = useCallback(async () => {
    try {
      const r = await safeFetch(`${getApiBase()}/api/settings/shared-terminal`);
      if (!r.ok) return;
      const j = (await r.json()) as Partial<TerminalSettings>;
      setSettings({ ...DEFAULT_SETTINGS, ...j });
    } catch {
      /* تجاهل — نحتفظ بالافتراضي */
    }
  }, []);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

  // عند تفعيل الوضع لأول مرة (أو دخول مستخدم) ولا يوجد token: ارفع overlay
  useEffect(() => {
    if (!enabled) {
      clearTerminalToken();
      lastTokenIssuedAtRef.current = 0;
      setLockState((s) => (s.locked ? { ...s, locked: false, reason: null } : s));
      return;
    }
    if (user?.id) {
      setLockState((s) => (s.locked ? s : { ...s, locked: true, reason: "boot" }));
    }
  }, [enabled, user?.id]);

  // مؤقّت الخمول الأساسي (sliding window)
  const restartIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (!enabled) return;
    const ms = Math.max(1, settings.idleLockMinutes) * 60_000;
    idleTimerRef.current = window.setTimeout(() => {
      setLockState((s) =>
        s.locked ? s : { ...s, locked: true, reason: "idle" }
      );
    }, ms);
  }, [enabled, settings.idleLockMinutes]);

  // مؤقّت الخروج الكامل (Hard Logout) — يُعاد تشغيله مع كل نشاط/عملية
  const restartHardLogoutTimer = useCallback(() => {
    if (hardLogoutTimerRef.current) {
      window.clearTimeout(hardLogoutTimerRef.current);
      hardLogoutTimerRef.current = null;
    }
    if (!enabled) return;
    const minutes = Math.max(1, settings.hardLogoutMinutes);
    const ms = minutes * 60_000;
    hardLogoutTimerRef.current = window.setTimeout(() => {
      // خروج كامل: يمسح token + يستدعي logout — يُعيد التطبيق لشاشة تسجيل الدخول
      clearTerminalToken();
      try { logout(); } catch { /* تجاهل */ }
    }, ms);
  }, [enabled, settings.hardLogoutMinutes, logout]);

  const pingActivity = useCallback(() => {
    if (!lockState.locked) {
      restartIdleTimer();
      restartHardLogoutTimer();
    }
  }, [restartIdleTimer, restartHardLogoutTimer, lockState.locked]);

  // listeners عامّة للنشاط
  useEffect(() => {
    if (!enabled) return;
    const onAny = () => pingActivity();
    const events = ["mousedown", "keydown", "touchstart", "wheel", "visibilitychange"];
    events.forEach((e) => window.addEventListener(e, onAny, { passive: true }));
    restartIdleTimer();
    restartHardLogoutTimer();
    return () => {
      events.forEach((e) => window.removeEventListener(e, onAny));
      if (idleTimerRef.current) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      if (hardLogoutTimerRef.current) {
        window.clearTimeout(hardLogoutTimerRef.current);
        hardLogoutTimerRef.current = null;
      }
    };
  }, [enabled, pingActivity, restartIdleTimer, restartHardLogoutTimer]);

  const lockTerminal = useCallback((reason: LockReason = "manual") => {
    if (!enabled) return;
    clearTerminalToken();
    lastTokenIssuedAtRef.current = 0;
    setLockState((s) => ({ ...s, locked: true, reason }));
  }, [enabled]);

  const triggerLock = useCallback(
    (trigger: SensitiveTrigger) => {
      if (!enabled) return;
      // نمط هجين: لا قفل بعد العملية، فقط نجدد العداد
      if (settings.slidingRefreshAfterAction) {
        restartIdleTimer();
        restartHardLogoutTimer();
        return;
      }
      // نمط كلاسيكي: نقفل بعد العملية إذا كان lockAfter<X> مفعّلاً
      const m: Record<SensitiveTrigger, [keyof TerminalSettings, LockReason]> = {
        save:     ["lockAfterSave",     "after_save"],
        edit:     ["lockAfterEdit",     "after_edit"],
        send:     ["lockAfterSend",     "after_send"],
        delete:   ["lockAfterDelete",   "after_delete"],
        discount: ["lockAfterDiscount", "after_discount"],
        return:   ["lockAfterReturn",   "after_return"],
      };
      const [flag, reason] = m[trigger];
      if (!settings[flag]) return;
      lockTerminal(reason);
    },
    [enabled, settings, lockTerminal, restartIdleTimer, restartHardLogoutTimer]
  );

  // تبديل المستخدم تلقائياً عند PIN لمستخدم آخر
  const maybeSwitchUser = useCallback((j: PinVerifyResponse) => {
    const newId = String(j.user?.id || "").toUpperCase();
    const curId = String(user?.id || "").toUpperCase();
    if (!newId || newId === curId) return;
    const next: SessionUser = {
      id: newId,
      name: String(j.user?.name || j.user?.login || ""),
      login: String(j.user?.login || ""),
      role: (String(j.user?.role || user?.role || "waiter").toLowerCase() as RoleId),
    };
    try { login(next); } catch { /* تجاهل */ }
  }, [user?.id, user?.role, login]);

  const consumeToken = useCallback((j: PinVerifyResponse) => {
    const exp = nowSec() + Number(j.ttlSeconds || 900);
    setTerminalToken(j.terminalToken, exp, j.user?.id || null);
    lastTokenIssuedAtRef.current = nowSec();
    maybeSwitchUser(j);
  }, [maybeSwitchUser]);

  const callPinVerify = useCallback(async (pin: string, login_: string | undefined, reason: string) => {
    return safeFetch(`${getApiBase()}/api/terminal/pin-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pin,
        terminalId: getTerminalId(),
        login: login_ || user?.login || "",
        reason,
        oldUserId: user?.id || "",
      }),
    });
  }, [user?.id, user?.login]);

  const unlockWithPin = useCallback(
    async (pin: string, login_?: string) => {
      try {
        const r = await callPinVerify(pin, login_, lockState.reason || "mandatory_pin_overlay");
        if (r.ok) {
          const j = (await r.json()) as PinVerifyResponse;
          consumeToken(j);
          setLockState({ locked: false, reason: null, failedAttempts: 0, lockoutUntilEpoch: null });
          restartIdleTimer();
          restartHardLogoutTimer();
          return { ok: true as const };
        }
        let msg = "PIN غير صحيح";
        let lockoutUntilEpoch: number | undefined;
        try {
          const j = await r.json();
          msg = String(j?.detail || msg);
        } catch { /* تجاهل */ }
        if (r.status === 429) {
          const m = msg.match(/(\d+)\s*ثانية/);
          if (m) lockoutUntilEpoch = nowSec() + Number(m[1]);
        }
        setLockState((s) => ({
          ...s,
          failedAttempts: s.failedAttempts + 1,
          lockoutUntilEpoch: lockoutUntilEpoch ?? s.lockoutUntilEpoch,
        }));
        return { ok: false as const, error: msg, lockoutUntilEpoch };
      } catch (err) {
        return { ok: false as const, error: "تعذّر الوصول للسيرفر: " + String(err) };
      }
    },
    [lockState.reason, callPinVerify, consumeToken, restartIdleTimer, restartHardLogoutTimer]
  );

  const isTokenFresh = useCallback((freshSeconds: number = 60) => {
    const issued = lastTokenIssuedAtRef.current;
    if (!issued) return false;
    return (nowSec() - issued) < Math.max(0, freshSeconds);
  }, []);

  const stepUp = useCallback(
    async (pin: string, opts: { reason: DangerOp; skipIfRecent?: boolean; freshSeconds?: number; login?: string }) => {
      if (opts.skipIfRecent && isTokenFresh(opts.freshSeconds ?? 60) && !pin) {
        return { ok: true as const };
      }
      try {
        const r = await callPinVerify(pin, opts.login, `step_up:${opts.reason}`);
        if (r.ok) {
          const j = (await r.json()) as PinVerifyResponse;
          consumeToken(j);
          restartIdleTimer();
          restartHardLogoutTimer();
          return { ok: true as const };
        }
        let msg = "PIN غير صحيح";
        let lockoutUntilEpoch: number | undefined;
        try {
          const j = await r.json();
          msg = String(j?.detail || msg);
        } catch { /* تجاهل */ }
        if (r.status === 429) {
          const m = msg.match(/(\d+)\s*ثانية/);
          if (m) lockoutUntilEpoch = nowSec() + Number(m[1]);
        }
        return { ok: false as const, error: msg, lockoutUntilEpoch };
      } catch (err) {
        return { ok: false as const, error: "تعذّر الوصول للسيرفر: " + String(err) };
      }
    },
    [callPinVerify, consumeToken, restartIdleTimer, restartHardLogoutTimer, isTokenFresh]
  );

  const value = useMemo<Ctx>(
    () => ({
      settings,
      enabled,
      lockState,
      lockTerminal,
      triggerLock,
      refreshSettings,
      pingActivity,
      unlockWithPin,
      stepUp,
      isTokenFresh,
    }),
    [settings, enabled, lockState, lockTerminal, triggerLock, refreshSettings, pingActivity, unlockWithPin, stepUp, isTokenFresh]
  );

  return (
    <TerminalLockContext.Provider value={value}>{children}</TerminalLockContext.Provider>
  );
}

export function useTerminalLock(): Ctx {
  const c = useContext(TerminalLockContext);
  if (!c) {
    return {
      settings: DEFAULT_SETTINGS,
      enabled: false,
      lockState: { locked: false, reason: null, failedAttempts: 0, lockoutUntilEpoch: null },
      lockTerminal: () => {},
      triggerLock: () => {},
      refreshSettings: async () => {},
      pingActivity: () => {},
      unlockWithPin: async () => ({ ok: false, error: "Provider غير مُركَّب" }),
      stepUp: async () => ({ ok: false, error: "Provider غير مُركَّب" }),
      isTokenFresh: () => false,
    };
  }
  return c;
}
