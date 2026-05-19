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
import type { FloorPlan, FloorTable, Point, Obstacle, FloorTextAnnotation, FloorArrowAnnotation } from "../lib/floorPlanModel";

type Tool = "select" | "drawShell" | "editShell" | "addRect" | "addCircle" | "addEllipse" | "addAisle" | "addObstacle" | "addText" | "addArrow";

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
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [selectedArrowId, setSelectedArrowId] = useState<string | null>(null);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [draftAisle, setDraftAisle] = useState<Point[]>([]);
  const [draftArrowStart, setDraftArrowStart] = useState<Point | null>(null);
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
    | {
      kind: "text";
      floorId: string;
      textId: string;
      start: Point;
      originX: number;
      originY: number;
    }
    | {
      kind: "arrow";
      floorId: string;
      arrowId: string;
      start: Point;
      originX1: number;
      originY1: number;
      originX2: number;
      originY2: number;
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
        if (d.kind === "text") {
          const nx = d.originX + (mx - d.start[0]);
          const ny = d.originY + (my - d.start[1]);
          return updateFloor(prev, d.floorId, (f) => ({
            ...f,
            textAnnotations: (f.textAnnotations ?? []).map((t) => (t.id === d.textId ? { ...t, x: nx, y: ny } : t)),
          }));
        }
        if (d.kind === "arrow") {
          const dx = mx - d.start[0];
          const dy = my - d.start[1];
          return updateFloor(prev, d.floorId, (f) => ({
            ...f,
            arrows: (f.arrows ?? []).map((a) =>
              a.id === d.arrowId
                ? { ...a, x1: d.originX1 + dx, y1: d.originY1 + dy, x2: d.originX2 + dx, y2: d.originY2 + dy }
                : a,
            ),
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
      const meta = j.meta as { path?: string; tableCount?: number; sha256?: string } | undefined;
      const where = meta?.path ? ` → ${meta.path}` : "";
      const tables = typeof meta?.tableCount === "number" ? ` (${meta.tableCount} طاولة)` : "";
      const syncNote = j.updatedPlanLinks ? " ومزامنة TBL005." : "";
      setMsg(`تم الحفظ على الخادم${where}${tables}${syncNote}`);
      await load();
      onSaved?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const syncTablesToTBL005 = async () => {
    setBusy(true);
    setMsg("");
    const base = getApiBase();
    try {
      const r = await fetch(`${base}/api/restaurant/floor-plan/sync-cost-centers`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : "فشل مزامنة TBL005");
      setMsg(`تمت مزامنة TBL005 بنجاح (${Number(j.syncedTables || 0)} طاولة).`);
      await load();
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
    setDraftAisle([]);
    setDraftArrowStart(null);
    setSelectedTableId(null);
    setSelectedObstacleId(null);
    setSelectedTextId(null);
    setSelectedArrowId(null);
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
    if (tool === "addText") {
      const id = randomId("txt");
      const txt: FloorTextAnnotation = { id, text: "منطقة جديدة", x, y, color: "#0f172a", fontSize: 26, fontWeight: 800 };
      setDoc(updateFloor(doc, activeFloor.id, (f) => ({ ...f, textAnnotations: [...(f.textAnnotations ?? []), txt] })));
      setSelectedTextId(id);
      setSelectedTableId(null);
      setSelectedObstacleId(null);
      setSelectedArrowId(null);
      setTool("select");
      return;
    }
    if (tool === "addArrow") {
      if (!draftArrowStart) {
        setDraftArrowStart([x, y]);
        setMsg("حدد نقطة نهاية السهم.");
        return;
      }
      const id = randomId("arr");
      const ar: FloorArrowAnnotation = {
        id,
        x1: draftArrowStart[0],
        y1: draftArrowStart[1],
        x2: x,
        y2: y,
        color: "#2563eb",
        strokeWidth: 8,
        label: "اتجاه السير",
      };
      setDoc(updateFloor(doc, activeFloor.id, (f) => ({ ...f, arrows: [...(f.arrows ?? []), ar] })));
      setDraftArrowStart(null);
      setSelectedArrowId(id);
      setSelectedTableId(null);
      setSelectedObstacleId(null);
      setSelectedTextId(null);
      setTool("select");
      setMsg("تمت إضافة سهم اتجاه.");
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
  const selectedText = (activeFloor?.textAnnotations ?? []).find((t) => t.id === selectedTextId) ?? null;
  const selectedArrow = (activeFloor?.arrows ?? []).find((a) => a.id === selectedArrowId) ?? null;

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

  const updateSelectedText = (patch: Partial<FloorTextAnnotation>) => {
    if (!doc || !activeFloor || !selectedTextId) return;
    setDoc(
      updateFloor(doc, activeFloor.id, (f) => ({
        ...f,
        textAnnotations: (f.textAnnotations ?? []).map((t) => (t.id === selectedTextId ? { ...t, ...patch } : t)),
      })),
    );
  };

  const deleteSelectedText = () => {
    if (!doc || !activeFloor || !selectedTextId) return;
    setDoc(updateFloor(doc, activeFloor.id, (f) => ({ ...f, textAnnotations: (f.textAnnotations ?? []).filter((t) => t.id !== selectedTextId) })));
    setSelectedTextId(null);
  };

  const updateSelectedArrow = (patch: Partial<FloorArrowAnnotation>) => {
    if (!doc || !activeFloor || !selectedArrowId) return;
    setDoc(
      updateFloor(doc, activeFloor.id, (f) => ({
        ...f,
        arrows: (f.arrows ?? []).map((a) => (a.id === selectedArrowId ? { ...a, ...patch } : a)),
      })),
    );
  };

  const deleteSelectedArrow = () => {
    if (!doc || !activeFloor || !selectedArrowId) return;
    setDoc(updateFloor(doc, activeFloor.id, (f) => ({ ...f, arrows: (f.arrows ?? []).filter((a) => a.id !== selectedArrowId) })));
    setSelectedArrowId(null);
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
              ["addText", "نص/مسمى"],
              ["addArrow", "سهم اتجاه"],
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
                if (k !== "addArrow") setDraftArrowStart(null);
                setSelectedVertex(null);
              }}
            >
              {lab}
            </button>
          ))}
        </div>
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
        {tool === "addArrow" && draftArrowStart && (
          <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setDraftArrowStart(null)}>
              مسح نقطة البداية
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
                  tool === "drawShell" || tool === "addRect" || tool === "addCircle" || tool === "addEllipse" || tool === "addAisle" || tool === "addObstacle" || tool === "addText" || tool === "addArrow" ? "crosshair" : "default",
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
            {(activeFloor.arrows ?? []).map((ar) => {
              const isSel = ar.id === selectedArrowId;
              return (
                <g
                  key={ar.id}
                  style={{ cursor: tool === "select" ? "grab" : "default" }}
                  onPointerDown={(e) => {
                    if (tool !== "select") return;
                    e.stopPropagation();
                    const svg = svgRef.current;
                    if (!svg) return;
                    const g = clientToSvg(svg, e.clientX, e.clientY);
                    setSelectedArrowId(ar.id);
                    setSelectedTextId(null);
                    setSelectedTableId(null);
                    setSelectedObstacleId(null);
                    dragRef.current = {
                      kind: "arrow",
                      floorId: activeFloor.id,
                      arrowId: ar.id,
                      start: g,
                      originX1: ar.x1,
                      originY1: ar.y1,
                      originX2: ar.x2,
                      originY2: ar.y2,
                    };
                  }}
                >
                  <line x1={ar.x1} y1={ar.y1} x2={ar.x2} y2={ar.y2} stroke={ar.color ?? "#2563eb"} strokeWidth={isSel ? (ar.strokeWidth ?? 8) + 2 : ar.strokeWidth ?? 8} />
                  <polygon
                    points="0,0 10,4 0,8"
                    fill={ar.color ?? "#2563eb"}
                    transform={`translate(${ar.x2 - 10},${ar.y2 - 4}) rotate(${(Math.atan2(ar.y2 - ar.y1, ar.x2 - ar.x1) * 180) / Math.PI} 10 4)`}
                  />
                  {ar.label ? <text x={(ar.x1 + ar.x2) / 2} y={(ar.y1 + ar.y2) / 2 - 8} textAnchor="middle" fontSize={13} fontWeight={700} fill={ar.color ?? "#2563eb"}>{ar.label}</text> : null}
                </g>
              );
            })}
            {(activeFloor.textAnnotations ?? []).map((tx) => {
              const isSel = tx.id === selectedTextId;
              return (
                <text
                  key={tx.id}
                  x={tx.x}
                  y={tx.y}
                  textAnchor="middle"
                  fontSize={tx.fontSize ?? 26}
                  fontWeight={tx.fontWeight ?? 800}
                  fill={tx.color ?? "#0f172a"}
                  style={{ cursor: tool === "select" ? "grab" : "default", paintOrder: "stroke", stroke: isSel ? "#a855f7" : "rgba(255,255,255,0.9)", strokeWidth: isSel ? 5 : 4 }}
                  onPointerDown={(e) => {
                    if (tool !== "select") return;
                    e.stopPropagation();
                    const svg = svgRef.current;
                    if (!svg) return;
                    const g = clientToSvg(svg, e.clientX, e.clientY);
                    setSelectedTextId(tx.id);
                    setSelectedArrowId(null);
                    setSelectedTableId(null);
                    setSelectedObstacleId(null);
                    dragRef.current = { kind: "text", floorId: activeFloor.id, textId: tx.id, start: g, originX: tx.x, originY: tx.y };
                  }}
                >
                  {tx.text}
                </text>
              );
            })}
            {activeFloor.tables.map((t) => {
              const sel = t.id === selectedTableId;
              const cx = t.x + t.w / 2;
              const cy = t.y + t.h / 2;
              const rot = t.rotation ?? 0;
              const passClicks = tool === "drawShell" || tool === "addRect" || tool === "addCircle" || tool === "addEllipse" || tool === "addAisle" || tool === "addObstacle" || tool === "addText" || tool === "addArrow";
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
          {selectedText && (
            <>
              <div style={{ fontWeight: 700, margin: "0.75rem 0 0.35rem" }}>نص محدد</div>
              <label style={{ fontSize: "0.82rem", color: "var(--muted)" }}>المحتوى</label>
              <input style={{ width: "100%", marginBottom: "0.35rem" }} value={selectedText.text} onChange={(e) => updateSelectedText({ text: e.target.value })} />
              <div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.35rem" }}>
                <input type="number" style={{ width: "50%" }} value={Math.round(selectedText.x)} onChange={(e) => updateSelectedText({ x: Number(e.target.value) || 0 })} />
                <input type="number" style={{ width: "50%" }} value={Math.round(selectedText.y)} onChange={(e) => updateSelectedText({ y: Number(e.target.value) || 0 })} />
              </div>
              <div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.35rem" }}>
                <input type="number" style={{ width: "50%" }} value={selectedText.fontSize ?? 26} min={8} max={120} onChange={(e) => updateSelectedText({ fontSize: Number(e.target.value) || 26 })} />
                <input type="color" style={{ width: "50%" }} value={selectedText.color ?? "#0f172a"} onChange={(e) => updateSelectedText({ color: e.target.value })} />
              </div>
              <button type="button" className="btn btn-ghost" style={{ width: "100%" }} onClick={deleteSelectedText}>
                حذف النص
              </button>
            </>
          )}
          {selectedArrow && (
            <>
              <div style={{ fontWeight: 700, margin: "0.75rem 0 0.35rem" }}>سهم محدد</div>
              <label style={{ fontSize: "0.82rem", color: "var(--muted)" }}>نص السهم</label>
              <input style={{ width: "100%", marginBottom: "0.35rem" }} value={selectedArrow.label ?? ""} onChange={(e) => updateSelectedArrow({ label: e.target.value })} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.35rem", marginBottom: "0.35rem" }}>
                <input type="number" value={Math.round(selectedArrow.x1)} onChange={(e) => updateSelectedArrow({ x1: Number(e.target.value) || 0 })} />
                <input type="number" value={Math.round(selectedArrow.y1)} onChange={(e) => updateSelectedArrow({ y1: Number(e.target.value) || 0 })} />
                <input type="number" value={Math.round(selectedArrow.x2)} onChange={(e) => updateSelectedArrow({ x2: Number(e.target.value) || 0 })} />
                <input type="number" value={Math.round(selectedArrow.y2)} onChange={(e) => updateSelectedArrow({ y2: Number(e.target.value) || 0 })} />
              </div>
              <div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.35rem" }}>
                <input type="number" style={{ width: "50%" }} value={selectedArrow.strokeWidth ?? 8} min={1} max={30} onChange={(e) => updateSelectedArrow({ strokeWidth: Number(e.target.value) || 8 })} />
                <input type="color" style={{ width: "50%" }} value={selectedArrow.color ?? "#2563eb"} onChange={(e) => updateSelectedArrow({ color: e.target.value })} />
              </div>
              <button type="button" className="btn btn-ghost" style={{ width: "100%" }} onClick={deleteSelectedArrow}>
                حذف السهم
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
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void syncTablesToTBL005()}>
          مزامنة جدول الطاولات TBL005
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
