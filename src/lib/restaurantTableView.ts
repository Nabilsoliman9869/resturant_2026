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
};

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
  return /^\d+$/.test(code) ? `#${Number(code)}` : code;
}

function tableKey(id: string) {
  return String(id || "").trim().toLowerCase();
}

function normalizeApiTables<T extends TableLike>(apiTables: T[]): T[] {
  return apiTables.map((table) => ({
    ...table,
    id: String(table.id),
    name: String(table.name || "").trim() || `طاولة ${table.number ?? String(table.id).slice(0, 6)}`,
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
      labelById.set(key, {
        label: labelFromCode(code),
        seats: table.seats,
        number: /^\d+$/.test(code) ? Number(code) : undefined,
      });
    });
  });

  return base.map((table) => {
    const hit = labelById.get(tableKey(table.id));
    if (!hit) return table;
    return {
      ...table,
      name: hit.label,
      seats: hit.seats ?? table.seats,
      number: hit.number ?? table.number,
    };
  });
}

export function buildSegmentedTablesFromFloorPlan(planRaw: unknown, apiTables: TableLike[]): SegmentedTableRow[] {
  const base = normalizeApiTables(apiTables);
  const norm = normalizeFloorPlanDocument(planRaw);
  if (!norm?.floors.length) {
    return base.map((table) => ({
      id: String(table.id),
      name: String(table.name || "طاولة"),
      seats: table.seats,
      number: table.number,
      status: table.status,
    }));
  }

  const apiById = new Map(base.map((table) => [tableKey(table.id), table]));
  const out: SegmentedTableRow[] = [];

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
      out.push({
        id: apiId,
        name: labelFromCode(code),
        seats: table.seats ?? apiMatch?.seats,
        number: /^\d+$/.test(code) ? Number(code) : undefined,
        status: apiMatch?.status,
        floorId: floor.id,
        floorName: floor.name,
      });
    });
  });

  return out;
}
