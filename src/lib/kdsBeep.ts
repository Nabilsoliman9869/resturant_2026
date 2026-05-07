/** تنبيه صوتي خفيف للمطبخ — قد يُحجب حتى يضغط المستخدم مرة على الصفحة (سياسة المتصفح). */
let lastBeepAt = 0;

export function playKitchenWarnBeep(minIntervalMs = 45000) {
  const now = Date.now();
  if (now - lastBeepAt < minIntervalMs) return;
  lastBeepAt = now;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.value = 0.07;
    o.start();
    const stop = () => {
      try {
        o.stop();
        void ctx.close();
      } catch {
        /* ignore */
      }
    };
    setTimeout(stop, 100);
  } catch {
    /* ignore */
  }
}

let lastInterDeptBeepAt = 0;

/** صوت تنبيه رسائل بين الأقسام (مختلف قليلاً عن تنبيه المطبخ). */
export function playInterDeptInboxBeep(minIntervalMs = 2800) {
  const now = Date.now();
  if (now - lastInterDeptBeepAt < minIntervalMs) return;
  lastInterDeptBeepAt = now;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const chirp = (freq: number, delayMs: number) => {
      window.setTimeout(() => {
        try {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = "triangle";
          o.frequency.value = freq;
          o.connect(g);
          g.connect(ctx.destination);
          g.gain.value = 0.085;
          o.start();
          window.setTimeout(() => {
            try {
              o.stop();
            } catch {
              /* ignore */
            }
          }, 130);
        } catch {
          /* ignore */
        }
      }, delayMs);
    };
    chirp(620, 0);
    chirp(840, 170);
    window.setTimeout(() => {
      try {
        void ctx.close();
      } catch {
        /* ignore */
      }
    }, 620);
  } catch {
    /* ignore */
  }
}
