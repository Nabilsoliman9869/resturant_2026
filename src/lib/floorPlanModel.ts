/**
 * مخطط الصالة — v1: مضلع shell + طاولات (مصدر الحقيقة: floor_plan.json).
 * لاحقاً: obstacles، aisles، zones، validation — دون كسر هذا الـ schema.
 */

/** ——— v1: عرض SVG + استيراد/تصدير ——— */

export type Point = [number, number];

export type FloorShell = {
  type: "polygon";
  points: Point[];
};

export type TableShape = "circle" | "rect" | "ellipse";

export type FloorTable = {
  id: string;
  label: string;
  shape: TableShape;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  seats?: number;
  /** ربط بمعرّف الطاولة في tables.json / الطلبات؛ إن غاب يُستخدم id */
  linkedTableId?: string;
};

export type FloorTextAnnotation = {
  id: string;
  text: string;
  x: number;
  y: number;
  color?: string;
  fontSize?: number;
  fontWeight?: number;
};

export type FloorArrowAnnotation = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string;
  strokeWidth?: number;
  label?: string;
};

export type FloorPlan = {
  id: string;
  name: string;
  width: number;
  height: number;
  shell: FloorShell;
  tables: FloorTable[];
  textAnnotations?: FloorTextAnnotation[];
  arrows?: FloorArrowAnnotation[];
  obstacles?: Obstacle[];
  aisles?: AislePath[];
  zones?: FloorZone[];
};

export type TableLiveStatus = "free" | "occupied" | "reserved" | "billing" | "dirty";

export type TableLiveMap = Record<
  string,
  {
    status: TableLiveStatus;
    progress?: number;
    orderCount?: number;
    orderPreview?: string;
  }
>;

function isPointArray(v: unknown): v is Point[] {
  return (
    Array.isArray(v) &&
    v.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number")
  );
}

/** تحقق خفيف من JSON — أي محرّر لاحق يكتب نفس الشكل */
export function parseFloorPlan(data: unknown): FloorPlan | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const name = typeof o.name === "string" ? o.name : "";
  const width = Number(o.width);
  const height = Number(o.height);
  const shell = o.shell;
  if (!shell || typeof shell !== "object") return null;
  const sh = shell as Record<string, unknown>;
  if (sh.type !== "polygon" || !isPointArray(sh.points)) return null;
  if (!id || !name || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null;

  const rawTables = o.tables;
  if (!Array.isArray(rawTables)) return null;
  const tables: FloorTable[] = [];
  for (const t of rawTables) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    const tid = typeof r.id === "string" ? r.id : "";
    const label = typeof r.label === "string" ? r.label : tid;
    const shape = r.shape === "circle" || r.shape === "rect" || r.shape === "ellipse" ? r.shape : null;
    const x = Number(r.x);
    const y = Number(r.y);
    const w = Number(r.w);
    const h = Number(r.h);
    if (!tid || !shape || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      continue;
    }
    const seats = r.seats != null ? Number(r.seats) : undefined;
    const rotation = r.rotation != null ? Number(r.rotation) : undefined;
    const linkedTableId = typeof r.linkedTableId === "string" ? r.linkedTableId : undefined;
    tables.push({
      id: tid,
      label,
      shape,
      x,
      y,
      w,
      h,
      rotation: Number.isFinite(rotation) ? rotation : undefined,
      seats: Number.isFinite(seats) && seats! >= 0 ? seats : undefined,
      linkedTableId,
    });
  }

  const out: FloorPlan = {
    id,
    name,
    width,
    height,
    shell: { type: "polygon", points: sh.points as Point[] },
    tables,
  };

  const txt = Array.isArray(o.textAnnotations)
    ? o.textAnnotations
      .filter((t) => t && typeof t === "object")
      .map((t) => {
        const r = t as Record<string, unknown>;
        return {
          id: typeof r.id === "string" ? r.id : `txt-${Date.now()}`,
          text: typeof r.text === "string" ? r.text : "",
          x: Number(r.x) || 0,
          y: Number(r.y) || 0,
          color: typeof r.color === "string" ? r.color : undefined,
          fontSize: Number.isFinite(Number(r.fontSize)) ? Number(r.fontSize) : undefined,
          fontWeight: Number.isFinite(Number(r.fontWeight)) ? Number(r.fontWeight) : undefined,
        } satisfies FloorTextAnnotation;
      })
    : undefined;
  if (txt) (out as any).textAnnotations = txt;

  const arr = Array.isArray(o.arrows)
    ? o.arrows
      .filter((a) => a && typeof a === "object")
      .map((a) => {
        const r = a as Record<string, unknown>;
        return {
          id: typeof r.id === "string" ? r.id : `arr-${Date.now()}`,
          x1: Number(r.x1) || 0,
          y1: Number(r.y1) || 0,
          x2: Number(r.x2) || 0,
          y2: Number(r.y2) || 0,
          color: typeof r.color === "string" ? r.color : undefined,
          strokeWidth: Number.isFinite(Number(r.strokeWidth)) ? Number(r.strokeWidth) : undefined,
          label: typeof r.label === "string" ? r.label : undefined,
        } satisfies FloorArrowAnnotation;
      })
    : undefined;
  if (arr) (out as any).arrows = arr;

  const maybeArr = (v: unknown) => (Array.isArray(v) ? v : undefined);
  const obs = maybeArr(o.obstacles);
  const ais = maybeArr(o.aisles);
  const zns = maybeArr(o.zones);
  if (obs) (out as any).obstacles = obs as Obstacle[];
  if (ais) (out as any).aisles = ais as AislePath[];
  if (zns) (out as any).zones = zns as FloorZone[];
  return out;
}

/** ——— امتدادات مستقبلية (عقبات، ممرات…) ——— */

export type ObstacleType = "column" | "wall_segment" | "bar" | "counter" | "door" | "service" | "plant" | "other";

export type ObstacleCircle = {
  id: string;
  type: ObstacleType;
  shape: "circle";
  x: number;
  y: number;
  r: number;
  label?: string;
};

export type ObstacleRect = {
  id: string;
  type: ObstacleType;
  shape: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  rotationDeg?: number;
  label?: string;
};

export type ObstaclePolygon = {
  id: string;
  type: ObstacleType;
  shape: "polygon";
  points: Point[];
  label?: string;
};

export type Obstacle = ObstacleCircle | ObstacleRect | ObstaclePolygon;

export type AislePath = {
  id: string;
  type: "aisle";
  points: Point[];
  width: number;
  label?: string;
};

export type FloorZone = {
  id: string;
  name: string;
  boundary?: Point[];
};

export type SpatialValidationIssue = {
  code: "outside_shell" | "overlaps_obstacle" | "on_aisle" | "overlaps_table" | "too_close_wall";
  message: string;
  entityId?: string;
};
