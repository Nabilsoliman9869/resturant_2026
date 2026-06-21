import { normalizeFloorPlanDocument } from "./floorPlanDocument";

type TableLike = {
  id: string;
  name?: string;
  seats?: number;
  number?: number;
  status?: string;
};

export type SegmentedTableRow = {
  id: string;
  name: string;
  seats?: number;
  number?: number;
  status?: string;
  isSeparator?: boolean;
  floorId?: string;
  floorName?: string;
  /** يمرّ من `/api/restaurant/tables` عند وجوده — للتمييز مثل vipSection */
  features?: { vipSection?: boolean; zone?: string };
};

function normalizeTableIndex(value: string) {
  const digits = String(value || "").replace(/^0+/, "");
  return digits || "0";
}

export function normalizeTableDisplayLabel(rawLabel?: string | null, fallbackNumber?: number, fallbackId?: string) {
  const raw = String(rawLabel || "").trim();
  const compact = raw.replace(/\s+/g, " ");
  const direct =
    /^t\s*0*(\d+)$/i.exec(compact) ||
    /^#\s*0*(\d+)$/i.exec(compact) ||
    /^(?:table|طاولة)\s*0*(\d+)$/i.exec(compact) ||
    /^0*(\d+)$/.exec(compact);
  if (direct?.[1]) return `T${normalizeTableIndex(direct[1])}`;
  if (Number.isFinite(fallbackNumber) && Number(fallbackNumber) > 0) return `T${normalizeTableIndex(String(fallbackNumber))}`;
  if (compact) return compact;
  const fallback = String(fallbackId || "").trim();
  if (fallback) return `T-${fallback.slice(0, 6).toUpperCase()}`;
  return "طاولة";
}

function floorPrefix(name: string, floorIndex: number) {
  const nm = (name || "").toLowerCase();
  if (/roof|رووف|روف/.test(nm)) return "R";
  if (/خارجي|حديقة|خارجيه|outdoor|garden/.test(nm)) return "E";
  return String(floorIndex + 1);
}

function tableCode(prefix: string, tableIndex: number) {
  const suffix = String(tableIndex + 1).padStart(2, "0");
  return prefix === "R" || prefix === "E" ? `${prefix}1${suffix}` : `${prefix}${suffix}`;
}

function labelFromCode(code: string) {
  return /^\d+$/.test(code) ? `T${Number(code)}` : code;
}

function planTableLabel(table: { label?: string }, generatedCode: string) {
  const manual = String(table?.label || "").trim();
  if (manual) return manual;
  return labelFromCode(generatedCode);
}

function tableKey(id: string) {
  return String(id || "").trim().toLowerCase();
}

function normalizeApiTables<T extends TableLike>(apiTables: T[]): T[] {
  return apiTables.map((table) => ({
    ...table,
    id: String(table.id),
    name: normalizeTableDisplayLabel(table.name, table.number, table.id),
  }));
}

export function mapTablesToFloorPlanLabels<T extends TableLike>(planRaw: unknown, apiTables: T[]): T[] {
  const base = normalizeApiTables(apiTables);
  const norm = normalizeFloorPlanDocument(planRaw);
  if (!norm?.floors.length) return base;

  const labelById = new Map<string, { label: string; seats?: number; number?: number }>();
  norm.floors.forEach((floor, floorIndex) => {
    const prefix = floorPrefix(floor.name, floorIndex);
    floor.tables.forEach((table, tableIndex) => {
      const apiId = String(table.linkedTableId ?? table.id);
      const key = tableKey(apiId);
      if (labelById.has(key)) return;
      const code = tableCode(prefix, tableIndex);
      const label = normalizeTableDisplayLabel(planTableLabel(table as { label?: string }, code), tableIndex + 1, apiId);
      labelById.set(key, {
        label,
        seats: table.seats,
        number: /^t(\d+)$/i.test(label) ? Number(/^t(\d+)$/i.exec(label)?.[1] || 0) : undefined,
      });
    });
  });

  return base.map((table) => {
    const hit = labelById.get(tableKey(table.id));
    if (!hit) return table;
    return {
      ...table,
      name: normalizeTableDisplayLabel(table.name || hit.label, hit.number ?? table.number, table.id),
      seats: hit.seats ?? table.seats,
      number: hit.number ?? table.number,
    };
  });
}

function apiTablesToSegmentedRows(base: TableLike[]): SegmentedTableRow[] {
  return base.map((table) => ({
    id: String(table.id),
    name: normalizeTableDisplayLabel(table.name, table.number, table.id),
    seats: table.seats,
    number: table.number,
    status: table.status,
    features: (table as { features?: SegmentedTableRow["features"] }).features,
  }));
}

export function buildSegmentedTablesFromFloorPlan(planRaw: unknown, apiTables: TableLike[]): SegmentedTableRow[] {
  const base = normalizeApiTables(apiTables);
  const norm = normalizeFloorPlanDocument(planRaw);
  if (!norm?.floors.length) {
    return apiTablesToSegmentedRows(base);
  }

  const apiById = new Map(base.map((table) => [tableKey(table.id), table]));
  const out: SegmentedTableRow[] = [];
  let planTableCount = 0;

  norm.floors.forEach((floor, floorIndex) => {
    out.push({
      id: `__sep__${floor.id}`,
      name: floor.name || `طابق ${floorIndex + 1}`,
      status: "__separator__",
      isSeparator: true,
      floorId: floor.id,
      floorName: floor.name,
    });

    const seen = new Set<string>();
    const prefix = floorPrefix(floor.name, floorIndex);
    floor.tables.forEach((table, tableIndex) => {
      const apiId = String(table.linkedTableId ?? table.id);
      const key = tableKey(apiId);
      if (seen.has(key)) return;
      seen.add(key);
      const apiMatch = apiById.get(key);
      const code = tableCode(prefix, tableIndex);
      const label = normalizeTableDisplayLabel(apiMatch?.name || planTableLabel(table as { label?: string }, code), tableIndex + 1, apiId);
      planTableCount += 1;
      out.push({
        id: apiId,
        name: label,
        seats: table.seats ?? apiMatch?.seats,
        number: /^t(\d+)$/i.test(label) ? Number(/^t(\d+)$/i.exec(label)?.[1] || 0) : undefined,
        status: apiMatch?.status,
        floorId: floor.id,
        floorName: floor.name,
        features: apiMatch && "features" in apiMatch ? (apiMatch as { features?: SegmentedTableRow["features"] }).features : undefined,
      });
    });
  });

  // مخطط موجود لكن tables: [] (شائع على Railway) — كان يُعرض «Main Hall» فقط ويُخفى كل API.
  if (planTableCount === 0 && base.length > 0) {
    return apiTablesToSegmentedRows(base);
  }

  return out;
}
