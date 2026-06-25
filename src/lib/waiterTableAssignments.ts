export type WaiterTableAssignmentRow = {
  id: string;
  userId: string;
  userLogin?: string;
  userName?: string;
  validFrom: string;
  validTo: string;
  tableIds: string[];
  createdAt?: string;
};

export type TempCaptainTransferRow = {
  id: string;
  sessionId?: string;
  tableId: string;
  tableLabel?: string;
  fromUserId: string;
  fromUserName?: string;
  toUserId: string;
  toUserName?: string;
  scope?: string;
  untilType?: string;
  approvedAt?: string;
  status?: string;
};

export function todayIsoDateLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function normalizeAssignedTableId(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function normalizeWaiterTableAssignmentRow(value: unknown): WaiterTableAssignmentRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const userId = String(row.userId || "").trim();
  const validFrom = String(row.validFrom || "").trim().slice(0, 10);
  const validTo = String(row.validTo || "").trim().slice(0, 10);
  if (!userId || !validFrom || !validTo) return null;
  const tableIds = Array.isArray(row.tableIds)
    ? Array.from(
        new Set(
          row.tableIds
            .map((x) => normalizeAssignedTableId(x))
            .filter(Boolean),
        ),
      )
    : [];
  return {
    id: String(row.id || ""),
    userId,
    userLogin: String(row.userLogin || "").trim(),
    userName: String(row.userName || "").trim(),
    validFrom,
    validTo,
    tableIds,
    createdAt: String(row.createdAt || "").trim(),
  };
}

export function normalizeWaiterTableAssignments(rows: unknown): WaiterTableAssignmentRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => normalizeWaiterTableAssignmentRow(row))
    .filter((row): row is WaiterTableAssignmentRow => Boolean(row));
}

export function normalizeTempCaptainTransferRow(value: unknown): TempCaptainTransferRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const tableId = normalizeAssignedTableId(row.tableId);
  const fromUserId = String(row.fromUserId || "").trim();
  const toUserId = String(row.toUserId || "").trim();
  if (!tableId || !fromUserId || !toUserId) return null;
  return {
    id: String(row.id || ""),
    sessionId: String(row.sessionId || "").trim(),
    tableId,
    tableLabel: String(row.tableLabel || "").trim(),
    fromUserId,
    fromUserName: String(row.fromUserName || "").trim(),
    toUserId,
    toUserName: String(row.toUserName || "").trim(),
    scope: String(row.scope || "").trim(),
    untilType: String(row.untilType || "").trim(),
    approvedAt: String(row.approvedAt || "").trim(),
    status: String(row.status || "").trim(),
  };
}

export function normalizeTempCaptainTransfers(rows: unknown): TempCaptainTransferRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => normalizeTempCaptainTransferRow(row))
    .filter((row): row is TempCaptainTransferRow => Boolean(row));
}

export function isWaiterTableAssignmentActiveOn(row: WaiterTableAssignmentRow, dayIso = todayIsoDateLocal()): boolean {
  const from = row.validFrom <= row.validTo ? row.validFrom : row.validTo;
  const to = row.validFrom <= row.validTo ? row.validTo : row.validFrom;
  return dayIso >= from && dayIso <= to;
}

export function hasAnyActiveWaiterTableAssignments(rows: WaiterTableAssignmentRow[], dayIso = todayIsoDateLocal()): boolean {
  return rows.some((row) => isWaiterTableAssignmentActiveOn(row, dayIso));
}

export function assignedTableIdsForUser(
  rows: WaiterTableAssignmentRow[],
  userId: string,
  dayIso = todayIsoDateLocal(),
): Set<string> {
  const out = new Set<string>();
  const uid = String(userId || "").trim();
  if (!uid) return out;
  for (const row of rows) {
    if (String(row.userId || "").trim() !== uid) continue;
    if (!isWaiterTableAssignmentActiveOn(row, dayIso)) continue;
    for (const tableId of row.tableIds) out.add(normalizeAssignedTableId(tableId));
  }
  return out;
}

export function effectiveTableIdsForUser(args: {
  assignmentRows: WaiterTableAssignmentRow[];
  tempTransfers?: TempCaptainTransferRow[];
  userId: string;
  dayIso?: string;
}): Set<string> {
  const out = assignedTableIdsForUser(args.assignmentRows, args.userId, args.dayIso);
  const uid = String(args.userId || "").trim();
  if (!uid) return out;
  for (const row of args.tempTransfers || []) {
    const tid = normalizeAssignedTableId(row.tableId);
    if (!tid) continue;
    if (String(row.fromUserId || "").trim() === uid) out.delete(tid);
    if (String(row.toUserId || "").trim() === uid) out.add(tid);
  }
  return out;
}

export function waiterTableAssignmentRestrictionApplies(args: {
  rows: WaiterTableAssignmentRow[];
  tempTransfers?: TempCaptainTransferRow[];
  userId?: string | null;
  userRole?: string | null;
  exclusiveOn: boolean;
  dayIso?: string;
}): boolean {
  const role = String(args.userRole || "").trim().toLowerCase();
  if (!args.exclusiveOn) return false;
  if (role === "manager" || role === "developer" || role === "operation_manager") return false;
  if (role !== "waiter" && role !== "host") return false;
  return hasAnyActiveWaiterTableAssignments(args.rows, args.dayIso) || (args.tempTransfers || []).length > 0;
}
