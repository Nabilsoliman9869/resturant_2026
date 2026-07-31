/**
 * التقاط مسح قارئ البطاقات (keyboard wedge): أرقام سريعة ثم Enter.
 * لا يعتمد على حقل UI ظاهر — يستمع على مستوى النافذة.
 */

export type CardSwipeHandler = (cardDigits: string) => void;

const MIN_LEN = 4;
const MAX_LEN = 40;
const MAX_GAP_MS = 85;

let buffer = "";
let lastAt = 0;
let handler: CardSwipeHandler | null = null;
let attached = false;

function reset() {
  buffer = "";
  lastAt = 0;
}

function onKeyDown(e: KeyboardEvent) {
  if (!handler) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.isComposing) return;

  const key = e.key;
  const now = Date.now();

  if (key === "Enter") {
    if (buffer.length >= MIN_LEN && buffer.length <= MAX_LEN && lastAt && now - lastAt <= MAX_GAP_MS * 2) {
      e.preventDefault();
      e.stopPropagation();
      const digits = buffer;
      reset();
      try {
        handler(digits);
      } catch {
        /* تجاهل */
      }
      return;
    }
    reset();
    return;
  }

  if (/^[0-9]$/.test(key)) {
    if (lastAt && now - lastAt > MAX_GAP_MS) reset();
    if (buffer.length >= MAX_LEN) {
      reset();
      return;
    }
    buffer += key;
    lastAt = now;
    // لا نمنع أثناء الجمع حتى لا نكسر الكتابة البطيئة؛ نمنع فقط عند اكتمال المسح بـ Enter
    return;
  }

  // أي مفتاح غير رقمي يُسقط المخزن (مسح الكارد أرقام فقط)
  if (key.length === 1 || key === "Backspace" || key === "Tab") {
    reset();
  }
}

export function setCardSwipeHandler(next: CardSwipeHandler | null) {
  handler = next;
  if (handler && !attached) {
    window.addEventListener("keydown", onKeyDown, true);
    attached = true;
  }
  if (!handler && attached) {
    window.removeEventListener("keydown", onKeyDown, true);
    attached = false;
    reset();
  }
}
