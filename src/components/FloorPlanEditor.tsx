import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBase } from "../lib/apiBase";
import {
  createEmptyFloor,
  documentToJson,
  isTableInsideShell,
  newTableIdInDocument,
  normalizeFloorPlanDocument,
  type NormalizedFloorPlanDocument,
} from "../lib/floorPlanDocument";
import type { FloorPlan, FloorTable, Point, Obstacle } from "../lib/floorPlanModel";

type Tool = "select" | "drawShell" | "editShell" | "addRect" | "addCircle" | "addEllipse" | "addAisle" | "addObstacle";

type ObstaclePreset =
  | { kind: "rect"; type: "wall_segment" | "window" | "bar" | "counter" | "door" | "service" | "elevator" | "cashier" | "bath_male" | "bath_female" | "bath_access" }
  | { kind: "circle"; type: "column" | "ac" };

function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return [0, 0];
  const p = pt.matrixTransform(ctm.inverse());
  return [p.x, p.y];
}

function updateFloor(doc: NormalizedFloorPlanDocument, floorId: string, fn: (f: FloorPlan) => FloorPlan): NormalizedFloorPlanDocument {
  const i = doc.floors.findIndex((x) => x.id === floorId);
  if (i < 0) return doc;
  const floors = doc.floors.slice();
  floors[i] = fn(floors[i]);
  const schemaVersion = floors.length > 1 ? 2 : 1;
  return { ...doc, floors, schemaVersion };
}

function randomId(prefix: string) {
  const c = globalThis.crypto?.randomUUID?.();
  return c ? `${prefix}-${c.slice(0, 8)}` : `${prefix}-${Date.now()}`;
}

type ApiTable = { id: string; name?: string };

type Props = {
  apiTables: ApiTable[];
  onSaved?: () => void;
};

export default function FloorPlanEditor({ apiTables, onSaved }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [doc, setDoc] = useState<NormalizedFloorPlanDocument | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [draftShell, setDraftShell] = useState<Point[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [selectedObstacleId, setSelectedObstacleId] = useState<string | null>(null);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [draftAisle, setDraftAisle] = useState<Point[]>([]);
  const [obstaclePreset, setObstaclePreset] = useState<ObstaclePreset | null>(null);

  const dragRef = useRef<
    | {
      kind: "table";
      floorId: string;
      tableId: string;
      start: Point;
      originX: number;
      originY: number;
    }
    | {
      kind: "vertex";
      floorId: string;
      index: number;
      start: Point;
      origin: Point;
    }
    | {
      kind: "obstacle";
      floorId: string;
      obstacleId: string;
      start: Point;
      originX: number;
      originY: number;
    }
    | null
  >(null);

  const activeFloor = useMemo(() => {
    if (!doc) return null;
    return doc.floors.find((f) => f.id === doc.activeFloorId) ?? doc.floors[0] ?? null;
  }, [doc]);

  const load = useCallback(async () => {
    setMsg("");
    const base = getApiBase();
    try {
      const r = await fetch(`${base}/api/restaurant/floor-plan`);
      const j = await r.json();
      const norm = normalizeFloorPlanDocument(j.plan);
      if (!norm) {
        setDoc({
          schemaVersion: 1,
          floors: [createEmptyFloor("main-floor", "الطابق الرئيسي")],
          activeFloorId: "main-floor",
        });
        setMsg("لا يوجد مخطط محفوظ — بدأنا طابقاً فارغاً.");
        return;
      }
      setDoc(norm);
    } catch (e) {
      setMsg(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const svg = svgRef.current;
      const d = dragRef.current;
      if (!svg || !d) return;
      const [mx, my] = clientToSvg(svg, e.clientX, e.clientY);
      setDoc((prev) => {
        if (!prev) return prev;
        if (d.kind === "table") {
          const fl = prev.floors.find((f) => f.id === d.floorId);
          if (!fl) return prev;
          const nx = d.originX + (mx - d.start[0]);
          const ny = d.originY + (my - d.start[1]);
          const t = fl.tables.find((x) => x.id === d.tableId);
          if (!t) return prev;
          const next = { ...t, x: nx, y: ny };
          if (!isTableInsideShell(next, fl.shell.points)) return prev;
          return updateFloor(prev, d.floorId, (f) => ({
            ...f,
            tables: f.tables.map((tb) => (tb.id === d.tableId ? next : tb)),
          }));
        }
        if (d.kind === "obstacle") {
          const nx = d.originX + (mx - d.start[0]);
          const ny = d.originY + (my - d.start[1]);
          return updateFloor(prev, d.floorId, (f) => ({
            ...f,
            obstacles: (f.obstacles ?? []).map((o: any) => (o.id === d.obstacleId ? { ...o, x: nx, y: ny } : o)) as any,
          }));
        }
        if (d.kind !== "vertex") return prev;
        const fl = prev.floors.find((f) => f.id === d.floorId);
        if (!fl) return prev;
        const nx = d.origin[0] + (mx - d.start[0]);
        const ny = d.origin[1] + (my - d.start[1]);
        const pts = fl.shell.points.map((p, i) => (i === d.index ? ([nx, ny] as Point) : p));
        return updateFloor(prev, d.floorId, (f) => ({ ...f, shell: { type: "polygon", points: pts } }));
      });
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const save = async () => {
    if (!doc) return;
    setBusy(true);
    setMsg("");
    const base = getApiBase();
    try {
      const body = documentToJson(doc);
      const r = await fetch(`${base}/api/restaurant/floor-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: body }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : "فشل الحفظ");
      setMsg(j.updatedPlanLinks ? "تم الحفظ ومزامنة طاولات المخطط مع TBL005." : "تم الحفظ.");
      onSaved?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setActiveFloorId = (id: string) => {
    setDoc((d) => (d ? { ...d, activeFloorId: id } : null));
    setDraftShell([]);
    setSelectedTableId(null);
    setSelectedVertex(null);
  };

  const addFloor = () => {
    if (!doc) return;
    const id = randomId("floor");
    const nf = createEmptyFloor(id, `طابق ${doc.floors.length + 1}`);
    setDoc({
      ...doc,
      schemaVersion: 2,
      floors: [...doc.floors, nf],
      activeFloorId: id,
    });
    setDraftShell([]);
  };

  const removeFloor = (id: string) => {
    if (!doc || doc.floors.length <= 1) return;
    const floors = doc.floors.filter((f) => f.id !== id);
    const activeFloorId = floors.some((f) => f.id === doc.activeFloorId) ? doc.activeFloorId : floors[0].id;
    setDoc({ ...doc, schemaVersion: floors.length > 1 ? 2 : 1, floors, activeFloorId });
  };

  const onFloorClick = (e: React.MouseEvent) => {
    if (!doc || !activeFloor || !svgRef.current) return;
    if (dragRef.current) return;
    const [x, y] = clientToSvg(svgRef.current, e.clientX, e.clientY);
    if (tool === "drawShell") {
      setDraftShell((d) => [...d, [x, y]]);
      return;
    }
    if (tool === "addAisle") {
      setDraftAisle((d) => [...d, [x, y]]);
      return;
    }
    if (tool === "addRect") {
      const id = newTableIdInDocument(doc);
      const w = 110;
      const h = 72;
      const t: FloorTable = {
        id,
        label: id,
        shape: "rect",
        x: x - w / 2,
        y: y - h / 2,
        w,
        h,
        seats: 4,
      };
      if (!isTableInsideShell(t, activeFloor.shell.points)) {
        setMsg("ضع الطاولة داخل حدود الصالة.");
        return;
      }
      setDoc(updateFloor(doc, activeFloor.id, (f) => ({ ...f, tables: [...f.tables, t] })));
      setSelectedTableId(id);
      setTool("select");
      return;
    }
    if (tool === "addCircle") {
      const id = newTableIdInDocument(doc);
      const w = 88;
      const h = 88;
      const t: FloorTable = {
        id,
        label: id,
        shape: "circle",
        x: x - w / 2,
        y: y - h / 2,
        w,
        h,
        seats: 4,
      };
      if (!isTableInsideShell(t, activeFloor.shell.points)) {
        setMsg("ضع الطاولة داخل حدود الصالة.");
        return;
      }
      setDoc(updateFloor(doc, activeFloor.id, (f) => ({ ...f, tables: [...f.tables, t] })));
      setSelectedTableId(id);
      setTool("select");
      return;
    }
    if (tool === "addEllipse") {
      const id = newTableIdInDocument(doc);
      const w = 120;
      const h = 80;
      const t: FloorTable = { id, label: id, shape: "ellipse", x: x - w / 2, y: y - h / 2, w, h, seats: 6 };
      if (!isTableInsideShell(t, activeFloor.shell.points)) {
        setMsg("ضع الطاولة داخل حدود الصالة.");
        return;
      }
      setDoc(updateFloor(doc, activeFloor.id, (f) => ({ ...f, tables: [...f.tables, t] })));
      setSelectedTableId(id);
      setTool("select");
      return;
    }
    if (tool === "addObstacle" && obstaclePreset) {
      const id = randomId("obs");
      if (obstaclePreset.kind === "circle") {
        const o: any = { id, type: obstaclePreset.type === "ac" ? "service" : "column", shape: "circle", x, y, r: 16, label: obstaclePreset.type };
        setDoc(updateFloor(doc, activeFloor.id, (f) => ({ ...f, obstacles: [...(f.obstacles ?? []), o] })));
      } else {
        const w = 120;
        const h = 48;
        const o: any = { id, type: obstaclePreset.type, shape: "rect", x: x - w / 2, y: y - h / 2, w, h, label: obstaclePreset.type };
        setDoc(updateFloor(doc, activeFloor.id, (f) => ({ ...f, obstacles: [...(f.obstacles ?? []), o] })));
      }
      setTool("select");
      return;
    }
  };

  const closeDraftShell = () => {
    if (!doc || !activeFloor || draftShell.length < 3) {
      setMsg("يلزم ثلاث نقاط على الأقل لإغلاق المضلع.");
      return;
    }
    setDoc(updateFloor(doc, activeFloor.id, (f) => ({ ...f, shell: { type: "polygon", points: draftShell } })));
    setDraftShell([]);
    setTool("select");
    setMsg("تم تحديث حدود الصالة.");
  };

  const closeDraftAisle = () => {
    if (!doc || !activeFloor || draftAisle.length < 2) {
      setMsg("يلزم نقطتان على الأقل لمسار الممشى.");
      return;
    }
    const id = randomId("aisle");
    setDoc(
      updateFloor(doc, activeFloor.id, (f) => ({ ...f, aisles: [...(f.aisles ?? []), { id, type: "aisle", points: draftAisle, width: 120 }] as any })),
    );
    setDraftAisle([]);
    setTool("select");
    setMsg("تم إضافة ممشى.");
  };

  const deleteSelectedTable = () => {
    if (!doc || !activeFloor || !selectedTableId) return;
    setDoc(
      updateFloor(doc, activeFloor.id, (f) => ({
        ...f,
        tables: f.tables.filter((t) => t.id !== selectedTableId),
      })),
    );
    setSelectedTableId(null);
  };

  const updateSelectedTable = (patch: Partial<FloorTable>) => {
    if (!doc || !activeFloor || !selectedTableId) return;
    setDoc(
      updateFloor(doc, activeFloor.id, (f) => ({
        ...f,
        tables: f.tables.map((t) => (t.id === selectedTableId ? { ...t, ...patch } : t)),
      })),
    );
  };

  const polygonDraftLine = useMemo(() => {
    if (draftShell.length < 2) return "";
    return draftShell.map(([a, b]) => `${a},${b}`).join(" ");
  }, [draftShell]);

  const selectedTable = activeFloor?.tables.find((t) => t.id === selectedTableId) ?? null;
  const selectedObstacle = (activeFloor as any)?.obstacles?.find((o: any) => o.id === selectedObstacleId) ?? null;

  const updateSelectedObstacle = (patch: Partial<Obstacle>) => {
    if (!doc || !activeFloor || !selectedObstacleId) return;
    setDoc(
      updateFloor(doc, activeFloor.id, (f) => ({
        ...f,
        obstacles: (f.obstacles ?? []).map((o: any) => (o.id === selectedObstacleId ? { ...o, ...patch } : o)) as any,
      })),
    );
  };

  const deleteSelectedObstacle = () => {
    if (!doc || !activeFloor || !selectedObstacleId) return;
    setDoc(updateFloor(doc, activeFloor.id, (f) => ({ ...f, obstacles: (f.obstacles ?? []).filter((o: any) => o.id !== selectedObstacleId) as any })));
    setSelectedObstacleId(null);
  };

  if (!doc || !activeFloor) {
    return <p style={{ color: "var(--muted)" }}>جاري التحميل…</p>;
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
        {doc.floors.map((f) => (
          <button
            key={f.id}
            type="button"
            className={f.id === doc.activeFloorId ? "btn btn-primary" : "btn btn-ghost"}
            style={{ fontSize: "0.85rem" }}
            onClick={() => setActiveFloorId(f.id)}
          >
            {f.name}
          </button>
        ))}
        <button type="button" className="btn btn-ghost" style={{ fontSize: "0.85rem" }} onClick={addFloor}>
          + طابق
        </button>
        {doc.floors.length > 1 && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: "0.85rem", color: "var(--danger)" }}
            onClick={() => removeFloor(activeFloor.id)}
          >
            حذف الطابق الحالي
          </button>
        )}
      </div>

      <div className="card" style={{ marginBottom: "0.75rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" }}>
          {(
            [
              ["select", "تحديد / سحب"],
              ["drawShell", "رسم حدود (نقر)"],
              ["editShell", "تعديل نقاط الحدود"],
              ["addRect", "طاولة مستطيلة"],
              ["addCircle", "طاولة دائرية"],
              ["addEllipse", "طاولة بيضاوية"],
              ["addAisle", "ممشى / طريق"],
            ] as const
          ).map(([k, lab]) => (
            <button
              key={k}
              type="button"
              className={tool === k ? "btn btn-primary" : "btn btn-ghost"}
              style={{ fontSize: "0.82rem" }}
              onClick={() => {
                setTool(k);
                if (k === "drawShell") setDraftShell([]);
                setSelectedVertex(null);
              }}
            >
              {lab}
            </button>
          ))}
        </div>
        {tool === "drawShell" && (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
            انقر داخل الرسم لإضافة نقاط بالترتيب؛ ثم «إغلاق المضلع». يُستبدل محيط الصالة بالكامل.
          </p>
        )}
        {tool === "drawShell" && draftShell.length > 0 && (
          <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" onClick={closeDraftShell}>
              إغلاق المضلع ({draftShell.length} نقطة)
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setDraftShell([])}>
              مسح المسودة
            </button>
          </div>
        )}
        {tool === "addAisle" && (
          <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" onClick={closeDraftAisle}>
              حفظ ممشى ({draftAisle.length} نقطة)
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setDraftAisle([])}>
              مسح المسار
            </button>
          </div>
        )}
        <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: "0.8rem", color: "var(--muted)" }}>إضافة عنصر</label>
          <select
            value={obstaclePreset ? (obstaclePreset as any).type : ""}
            onChange={(e) => {
              const v = e.target.value as any;
              if (["column", "ac"].includes(v)) setObstaclePreset({ kind: "circle", type: v });
              else if (v) setObstaclePreset({ kind: "rect", type: v });
              else setObstaclePreset(null);
            }}
          >
            <option value="">— اختر —</option>
            <option value="column">عمود</option>
            <option value="stairs">درج</option>
            <option value="wall_segment">جدار فاصل</option>
            <option value="window">نافذة</option>
            <option value="counter">كاونتر خدمة</option>
            <option value="bar">كاونتر تحميل</option>
            <option value="door">مدخل</option>
            <option value="elevator">مصعد</option>
            <option value="cashier">كاشير</option>
            <option value="service">إطفاء/خدمة</option>
            <option value="ac">مكيف</option>
            <option value="bath_male">حمام رجالي</option>
            <option value="bath_female">حمام حريمي</option>
            <option value="bath_access">حمام معاقين</option>
          </select>
          <button type="button" className="btn btn-ghost" disabled={!obstaclePreset} onClick={() => setTool("addObstacle")}>أضف</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: "1rem", alignItems: "start" }}>
        <div style={{ overflow: "auto", maxWidth: "100%" }}>
          <svg
            ref={svgRef}
            width={activeFloor.width}
            height={activeFloor.height}
            viewBox={`0 0 ${activeFloor.width} ${activeFloor.height}`}
            style={{
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 10,
              maxWidth: "100%",
              height: "auto",
            }}
          >
            <rect
              x={0}
              y={0}
              width={activeFloor.width}
              height={activeFloor.height}
              fill="transparent"
              style={{
                cursor:
                  tool === "drawShell" || tool === "addRect" || tool === "addCircle" || tool === "addEllipse" || tool === "addAisle" || tool === "addObstacle" ? "crosshair" : "default",
              }}
              onClick={(e) => {
                e.stopPropagation();
                onFloorClick(e);
              }}
            />
            <polygon
              points={activeFloor.shell.points.map(([a, b]) => `${a},${b}`).join(" ")}
              fill="#f1f5f9"
              stroke="#334155"
              strokeWidth={3}
              pointerEvents="none"
            />
            {draftShell.length > 0 && (
              <>
                {draftShell.map(([px, py], i) => (
                  <circle key={i} cx={px} cy={py} r={6} fill="#f97316" stroke="#fff" strokeWidth={2} />
                ))}
                {draftShell.length > 1 && (
                  <polyline
                    points={polygonDraftLine}
                    fill="none"
                    stroke="#f97316"
                    strokeWidth={2}
                    strokeDasharray="8 6"
                  />
                )}
              </>
            )}
            {tool === "editShell" &&
              activeFloor.shell.points.map(([px, py], i) => (
                <circle
                  key={`v-${i}`}
                  cx={px}
                  cy={py}
                  r={selectedVertex === i ? 10 : 7}
                  fill={selectedVertex === i ? "#22d3ee" : "#94a3b8"}
                  stroke="#1e293b"
                  strokeWidth={2}
                  style={{ cursor: "grab" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const svg = svgRef.current;
                    if (!svg) return;
                    const g = clientToSvg(svg, e.clientX, e.clientY);
                    dragRef.current = {
                      kind: "vertex",
                      floorId: activeFloor.id,
                      index: i,
                      start: g,
                      origin: [px, py],
                    };
                    setSelectedVertex(i);
                  }}
                />
              ))}
            {(activeFloor as any).aisles?.map((a: any) => (
              <polyline key={a.id} points={a.points.map(([ax, ay]: any) => `${ax},${ay}`).join(" ")} fill="none" stroke="#64748b" strokeWidth={Math.max(2, Math.min(8, (a.width || 120) / 40))} strokeDasharray="10 6" />
            ))}
            {(activeFloor as any).obstacles?.map((on: any) => {
              const isSel = on.id === selectedObstacleId;
              const common = { fill: isSel ? "#fde68a" : "#e5e7eb", stroke: "#374151", strokeWidth: isSel ? 3 : 2 } as any;
              if (on.shape === "circle") {
                return (
                  <circle
                    key={on.id}
                    cx={on.x}
                    cy={on.y}
                    r={on.r ?? 16}
                    {...common}
                    onPointerDown={(e) => {
                      if (tool !== "select") return;
                      e.stopPropagation();
                      const svg = svgRef.current;
                      if (!svg) return;
                      const g = clientToSvg(svg, e.clientX, e.clientY);
                      setSelectedObstacleId(on.id);
                      dragRef.current = { kind: "obstacle", floorId: activeFloor.id, obstacleId: on.id, start: g, originX: on.x, originY: on.y } as any;
                    }}
                  />
                );
              }
              if (on.shape === "rect") {
                const cx = on.x + on.w / 2;
                const cy = on.y + on.h / 2;
                const rot = on.rotationDeg ?? 0;
                return (
                  <g key={on.id} transform={`rotate(${rot} ${cx} ${cy})`}>
                    <rect
                      x={on.x}
                      y={on.y}
                      width={on.w}
                      height={on.h}
                      rx={6}
                      ry={6}
                      {...common}
                      onPointerDown={(e) => {
                        if (tool !== "select") return;
                        e.stopPropagation();
                        const svg = svgRef.current;
                        if (!svg) return;
                        const g = clientToSvg(svg, e.clientX, e.clientY);
                        setSelectedObstacleId(on.id);
                        dragRef.current = { kind: "obstacle", floorId: activeFloor.id, obstacleId: on.id, start: g, originX: on.x, originY: on.y } as any;
                      }}
                    />
                    {on.label && (
                      <text x={cx} y={cy} textAnchor="middle" fontSize={12} fill="#111827" pointerEvents="none">
                        {on.label}
                      </text>
                    )}
                  </g>
                );
              }
              if (on.shape === "polygon") {
                return (
                  <polygon
                    key={on.id}
                    points={on.points.map(([ax, ay]: any) => `${ax},${ay}`).join(" ")}
                    {...common}
                    onPointerDown={(e) => {
                      if (tool !== "select") return;
                      e.stopPropagation();
                      setSelectedObstacleId(on.id);
                    }}
                  />
                );
              }
              return null;
            })}
            {activeFloor.tables.map((t) => {
              const sel = t.id === selectedTableId;
              const cx = t.x + t.w / 2;
              const cy = t.y + t.h / 2;
              const rot = t.rotation ?? 0;
              const passClicks = tool === "drawShell" || tool === "addRect" || tool === "addCircle" || tool === "addEllipse" || tool === "addAisle" || tool === "addObstacle";
              return (
                <g
                  key={t.id}
                  transform={`rotate(${rot} ${cx} ${cy})`}
                  style={{
                    cursor: tool === "select" ? "grab" : "default",
                    pointerEvents: passClicks ? "none" : "auto",
                  }}
                  onPointerDown={(e) => {
                    if (tool !== "select") return;
                    e.stopPropagation();
                    const svg = svgRef.current;
                    if (!svg) return;
                    const g = clientToSvg(svg, e.clientX, e.clientY);
                    setSelectedTableId(t.id);
                    dragRef.current = {
                      kind: "table",
                      floorId: activeFloor.id,
                      tableId: t.id,
                      start: g,
                      originX: t.x,
                      originY: t.y,
                    };
                  }}
                >
                  {t.shape === "circle" ? (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={Math.min(t.w, t.h) / 2}
                      fill={sel ? "#fdba74" : "#cbd5e1"}
                      stroke="#1f2937"
                      strokeWidth={sel ? 3 : 2}
                    />
                  ) : t.shape === "ellipse" ? (
                    <ellipse cx={cx} cy={cy} rx={t.w / 2} ry={t.h / 2} fill={sel ? "#fdba74" : "#cbd5e1"} stroke="#1f2937" strokeWidth={sel ? 3 : 2} />
                  ) : (
                    <rect
                      x={t.x}
                      y={t.y}
                      width={t.w}
                      height={t.h}
                      rx={10}
                      ry={10}
                      fill={sel ? "#fdba74" : "#cbd5e1"}
                      stroke="#1f2937"
                      strokeWidth={sel ? 3 : 2}
                    />
                  )}
                  <text x={cx} y={cy + 5} textAnchor="middle" fontSize={14} fontWeight={700} fill="#111827" pointerEvents="none">
                    {t.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="card" style={{ padding: "0.85rem" }}>
          <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>خصائص الطابق</div>
          <label style={{ fontSize: "0.82rem", color: "var(--muted)", display: "block" }}>الاسم</label>
          <input
            style={{ width: "100%", marginBottom: "0.5rem" }}
            value={activeFloor.name}
            onChange={(e) =>
              setDoc(
                updateFloor(doc, activeFloor.id, (f) => ({
                  ...f,
                  name: e.target.value,
                })),
              )
            }
          />
          <label style={{ fontSize: "0.82rem", color: "var(--muted)", display: "block" }}>عرض اللوحة</label>
          <input
            type="number"
            style={{ width: "100%", marginBottom: "0.5rem" }}
            value={activeFloor.width}
            min={400}
            max={4000}
            onChange={(e) =>
              setDoc(
                updateFloor(doc, activeFloor.id, (f) => ({
                  ...f,
                  width: Math.max(400, Number(e.target.value) || f.width),
                })),
              )
            }
          />
          <label style={{ fontSize: "0.82rem", color: "var(--muted)", display: "block" }}>ارتفاع اللوحة</label>
          <input
            type="number"
            style={{ width: "100%", marginBottom: "0.75rem" }}
            value={activeFloor.height}
            min={300}
            max={4000}
            onChange={(e) =>
              setDoc(
                updateFloor(doc, activeFloor.id, (f) => ({
                  ...f,
                  height: Math.max(300, Number(e.target.value) || f.height),
                })),
              )
            }
          />

          {selectedTable && (
            <>
              <div style={{ fontWeight: 700, margin: "0.5rem 0" }}>طاولة محددة</div>
              <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginBottom: "0.35rem" }}>
                معرّف الرسم: <code>{selectedTable.id}</code>
              </div>
              <label style={{ fontSize: "0.82rem", color: "var(--muted)" }}>التسمية</label>
              <input
                style={{ width: "100%", marginBottom: "0.35rem" }}
                value={selectedTable.label}
                onChange={(e) => updateSelectedTable({ label: e.target.value })}
              />
              <label style={{ fontSize: "0.82rem", color: "var(--muted)" }}>ربط API (linkedTableId)</label>
              <select
                style={{ width: "100%", marginBottom: "0.35rem" }}
                value={selectedTable.linkedTableId ?? ""}
                onChange={(e) => updateSelectedTable({ linkedTableId: e.target.value || undefined })}
              >
                <option value="">— نفس معرّف الرسم —</option>
                {apiTables.map((at) => (
                  <option key={at.id} value={at.id}>
                    {at.id} {at.name ? `(${at.name})` : ""}
                  </option>
                ))}
              </select>
              <label style={{ fontSize: "0.82rem", color: "var(--muted)" }}>مقاعد</label>
              <input
                type="number"
                style={{ width: "100%", marginBottom: "0.35rem" }}
                value={selectedTable.seats ?? 0}
                min={0}
                onChange={(e) => updateSelectedTable({ seats: Number(e.target.value) })}
              />
              <label style={{ fontSize: "0.82rem", color: "var(--muted)" }}>دوران (°)</label>
              <input
                type="number"
                style={{ width: "100%", marginBottom: "0.35rem" }}
                value={selectedTable.rotation ?? 0}
                onChange={(e) => updateSelectedTable({ rotation: Number(e.target.value) })}
              />
              <label style={{ fontSize: "0.82rem", color: "var(--muted)" }}>عرض / ارتفاع</label>
              <div style={{ display: "flex", gap: "0.35rem" }}>
                <input
                  type="number"
                  style={{ width: "50%" }}
                  value={Math.round(selectedTable.w)}
                  min={20}
                  onChange={(e) => updateSelectedTable({ w: Math.max(20, Number(e.target.value)) })}
                />
                <input
                  type="number"
                  style={{ width: "50%" }}
                  value={Math.round(selectedTable.h)}
                  min={20}
                  onChange={(e) => updateSelectedTable({ h: Math.max(20, Number(e.target.value)) })}
                />
              </div>
              <button type="button" className="btn btn-ghost" style={{ marginTop: "0.5rem", width: "100%" }} onClick={deleteSelectedTable}>
                حذف الطاولة
              </button>
            </>
          )}
          {selectedObstacle && (
            <>
              <div style={{ fontWeight: 700, margin: "0.75rem 0 0.35rem" }}>عنصر محدد</div>
              <label style={{ fontSize: "0.82rem", color: "var(--muted)" }}>التسمية</label>
              <input style={{ width: "100%", marginBottom: "0.35rem" }} value={(selectedObstacle as any).label ?? ""} onChange={(e) => updateSelectedObstacle({ label: e.target.value } as any)} />
              {((selectedObstacle as any).shape === "rect") && (
                <div style={{ display: "flex", gap: "0.35rem" }}>
                  <input type="number" style={{ width: "50%" }} value={Math.round((selectedObstacle as any).w)} min={10} onChange={(e) => updateSelectedObstacle({ w: Math.max(10, Number(e.target.value)) } as any)} />
                  <input type="number" style={{ width: "50%" }} value={Math.round((selectedObstacle as any).h)} min={10} onChange={(e) => updateSelectedObstacle({ h: Math.max(10, Number(e.target.value)) } as any)} />
                </div>
              )}
              <button type="button" className="btn btn-ghost" style={{ marginTop: "0.5rem", width: "100%" }} onClick={deleteSelectedObstacle}>
                حذف العنصر
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? "جاري الحفظ…" : "حفظ على الخادم (PUT)"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void load()}>
          إعادة التحميل من الخادم
        </button>
      </div>
      {msg && (
        <p style={{ marginTop: "0.75rem", fontSize: "0.9rem", color: msg.startsWith("تم") ? "var(--muted)" : "var(--danger)" }}>
          {msg}
        </p>
      )}
    </div>
  );
}
