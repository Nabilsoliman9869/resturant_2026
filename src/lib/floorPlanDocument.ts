import { parseFloorPlan, type FloorPlan, type FloorTable, type Point } from "./floorPlanModel";

export const FLOOR_PLAN_SCHEMA_V2 = 2 as const;

export type FloorPlanDocumentV2 = {
  schemaVersion: typeof FLOOR_PLAN_SCHEMA_V2;
  floors: FloorPlan[];
  /** طابق يُعرض افتراضياً في الواجهات */
  activeFloorId?: string;
};

/** مستند موحّد في الذاكرة — schemaVersion للعرض/الحفظ (طابق واحد يمكن حفظه بصيغة قديمة بدون مفتاح floors) */
export type NormalizedFloorPlanDocument = {
  schemaVersion: 1 | 2;
  floors: FloorPlan[];
  activeFloorId: string;
};

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toPoints(value: unknown): Point[] {
  if (!Array.isArray(value)) return [];
  const points: Point[] = [];
  for (const p of value) {
    if (Array.isArray(p) && p.length >= 2) {
      const x = Number(p[0]);
      const y = Number(p[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
      continue;
    }
    if (p && typeof p === "object") {
      const r = p as Record<string, unknown>;
      const x = Number(r.x);
      const y = Number(r.y);
      if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
    }
  }
  return points;
}

function repairFloorPlanCandidate(raw: unknown): FloorPlan | null {
  const parsed = parseFloorPlan(raw);
  if (parsed) return parsed;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const shellRaw = o.shell;
  const shellObj = shellRaw && typeof shellRaw === "object" ? (shellRaw as Record<string, unknown>) : {};
  const shellPoints = toPoints(shellObj.points);
  if (shellPoints.length < 3) return null;

  const tablesRaw = Array.isArray(o.tables) ? o.tables : [];
  const tables = tablesRaw
    .map((t, i): FloorTable | null => {
      if (!t || typeof t !== "object") return null;
      const r = t as Record<string, unknown>;
      const tid = typeof r.id === "string" && r.id.trim() ? r.id.trim() : `T${i + 1}`;
      const shape = r.shape === "circle" || r.shape === "rect" || r.shape === "ellipse" ? r.shape : "rect";
      const x = toNumber(r.x, 0);
      const y = toNumber(r.y, 0);
      const w = Math.max(10, toNumber(r.w, shape === "circle" ? 88 : 100));
      const h = Math.max(10, toNumber(r.h, shape === "circle" ? 88 : 70));
      const label = typeof r.label === "string" && r.label.trim() ? r.label : tid;
      const rotation = Number.isFinite(Number(r.rotation)) ? Number(r.rotation) : undefined;
      const seats = Number.isFinite(Number(r.seats)) ? Math.max(0, Number(r.seats)) : undefined;
      const linkedTableId = typeof r.linkedTableId === "string" && r.linkedTableId.trim() ? r.linkedTableId : undefined;
      const table: FloorTable = { id: tid, label, shape, x, y, w, h, rotation, seats, linkedTableId };
      return table;
    })
    .filter((x): x is FloorTable => x !== null);

  const id = typeof o.id === "string" && o.id.trim() ? o.id : "main-floor";
  const name = typeof o.name === "string" && o.name.trim() ? o.name : "Main Hall";
  const width = Math.max(200, toNumber(o.width, 1000));
  const height = Math.max(200, toNumber(o.height, 700));

  return {
    id,
    name,
    width,
    height,
    shell: { type: "polygon", points: shellPoints },
    tables,
    textAnnotations: Array.isArray(o.textAnnotations) ? (o.textAnnotations as any) : [],
    arrows: Array.isArray(o.arrows) ? (o.arrows as any) : [],
    obstacles: Array.isArray(o.obstacles) ? (o.obstacles as any) : [],
    aisles: Array.isArray(o.aisles) ? (o.aisles as any) : [],
    zones: Array.isArray(o.zones) ? (o.zones as any) : [],
  };
}

/** تحويل أي JSON محمّل من API إلى مستند موحّد (طابق واحد أو أكثر) */
export function normalizeFloorPlanDocument(raw: unknown): NormalizedFloorPlanDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  if (o.schemaVersion === 2 && Array.isArray(o.floors)) {
    const floors: FloorPlan[] = [];
    for (const f of o.floors) {
      const p = repairFloorPlanCandidate(f);
      if (p) floors.push(p);
    }
    if (!floors.length) return null;
    const active =
      typeof o.activeFloorId === "string" && floors.some((f) => f.id === o.activeFloorId)
        ? o.activeFloorId
        : floors[0].id;
    return { schemaVersion: 2, floors, activeFloorId: active };
  }

  const single = repairFloorPlanCandidate(raw);
  if (!single) return null;
  return { schemaVersion: 1, floors: [single], activeFloorId: single.id };
}

/** للحفظ في الملف — يحافظ على v2 إن كان أكثر من طابق */
export function documentToJson(doc: NormalizedFloorPlanDocument): Record<string, unknown> {
  if (doc.schemaVersion === 2 || doc.floors.length > 1) {
    return {
      schemaVersion: 2,
      floors: doc.floors,
      activeFloorId: doc.activeFloorId,
    };
  }
  const [only] = doc.floors;
  return {
    id: only.id,
    name: only.name,
    width: only.width,
    height: only.height,
    shell: only.shell,
    tables: only.tables,
    textAnnotations: only.textAnnotations ?? [],
    arrows: only.arrows ?? [],
    obstacles: only.obstacles ?? [],
    aisles: only.aisles ?? [],
    zones: only.zones ?? [],
  };
}

export function getFloorById(doc: NormalizedFloorPlanDocument, id: string): FloorPlan | null {
  return doc.floors.find((f) => f.id === id) ?? null;
}

export function pointInPolygon(x: number, y: number, poly: Point[]): boolean {
  if (poly.length < 3) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const denom = yj - yi;
    const intersect =
      yi !== yj && ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (denom || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** مركز جسم الطاولة للتحقق من داخل المضلع */
export function tableCenter(t: { x: number; y: number; w: number; h: number }): Point {
  return [t.x + t.w / 2, t.y + t.h / 2];
}

export function isTableInsideShell(
  t: { x: number; y: number; w: number; h: number },
  shellPoints: Point[],
): boolean {
  const [cx, cy] = tableCenter(t);
  return pointInPolygon(cx, cy, shellPoints);
}

export function createEmptyFloor(id: string, name: string): FloorPlan {
  return {
    id,
    name,
    width: 1000,
    height: 700,
    shell: {
      type: "polygon",
      points: [
        [50, 50],
        [950, 50],
        [950, 650],
        [50, 650],
      ],
    },
    tables: [],
    textAnnotations: [],
    arrows: [],
    obstacles: [],
    aisles: [],
    zones: [],
  };
}

export function newTableId(existing: FloorTable[]): string {
  const nums = existing
    .map((t) => parseInt(String(t.id).replace(/\D/g, ""), 10))
    .filter((n) => !Number.isNaN(n) && n > 0);
  const n = nums.length ? Math.max(...nums) + 1 : 1;
  return `T${n}`;
}

export function newTableIdInDocument(doc: NormalizedFloorPlanDocument): string {
  const all = doc.floors.flatMap((f) => f.tables);
  return newTableId(all);
}
