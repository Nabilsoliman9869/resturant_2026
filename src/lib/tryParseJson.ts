/** يتجنّب رمي عند جسم فارغ أو غير JSON (مثل استجابة بروكسي/خادم بلا محتوى). */
export function tryParseJson<T>(raw: string): T | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}
