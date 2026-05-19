import { safeFetch } from "./safeFetch";
import { tryParseJson } from "./tryParseJson";

/** فترة تحديث شاشات التشغيل — تقليل ضغط ODBC على Railway */
export const RESTAURANT_POLL_MS = 18_000;

export type OperationalSnapshot = {
  ok?: boolean;
  floorPlan?: unknown;
  tables?: unknown[];
  sessions?: unknown[];
  orders?: unknown[];
  workflowSettings?: Record<string, unknown>;
  opsSettings?: Record<string, unknown>;
  users?: unknown[];
  tableDataSource?: { error?: string; source?: string; fromMirror?: boolean };
  sources?: Record<string, string>;
};

export async function fetchOperationalSnapshot(
  base: string,
  opts?: { includeUsers?: boolean; cacheBust?: boolean },
): Promise<{ ok: boolean; data: OperationalSnapshot | null; status: number }> {
  const includeUsers = opts?.includeUsers ? "1" : "0";
  const t = opts?.cacheBust !== false ? `&t=${Date.now()}` : "";
  const res = await safeFetch(
    `${base}/api/restaurant/operational-snapshot?includeUsers=${includeUsers}${t}`,
  );
  const raw = await res.text().catch(() => "");
  const data = tryParseJson<OperationalSnapshot>(raw);
  return { ok: res.ok && Boolean(data?.ok !== false), data, status: res.status };
}
