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

/** تحويل أي JSON محمّل من API إلى مستند موحّد (طابق واحد أو أكثر) */
export function normalizeFloorPlanDocument(raw: unknown): NormalizedFloorPlanDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  if (o.schemaVersion === 2 && Array.isArray(o.floors)) {
    const floors: FloorPlan[] = [];
    for (const f of o.floors) {
      const p = parseFloorPlan(f);
      if (p) floors.push(p);
    }
    if (!floors.length) return null;
    const active =
      typeof o.activeFloorId === "string" && floors.some((f) => f.id === o.activeFloorId)
        ? o.activeFloorId
        : floors[0].id;
    return { schemaVersion: 2, floors, activeFloorId: active };
  }

  const single = parseFloorPlan(raw);
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
