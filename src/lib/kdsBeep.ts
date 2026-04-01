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
