import { useCallback, useEffect, useState } from "react";
import FloorPlanEditor from "../../components/FloorPlanEditor";
import { getApiBase } from "../../lib/apiBase";

type ApiTable = { id: string; name?: string };

export default function FloorPlanEditorPage() {
  const [apiTables, setApiTables] = useState<ApiTable[]>([]);

  const loadTables = useCallback(async () => {
    const base = getApiBase();
    try {
      const r = await fetch(`${base}/api/restaurant/tables`);
      const j = await r.json();
      const tl = Array.isArray(j.tables) ? j.tables : [];
      setApiTables(
        tl.map((t: { id?: string; name?: string }) => ({
          id: String(t.id ?? ""),
          name: t.name ? String(t.name) : undefined,
        })).filter((t: ApiTable) => t.id),
      );
    } catch {
      setApiTables([]);
    }
  }, []);

  useEffect(() => {
    void loadTables();
  }, [loadTables]);

  return (
    <div>
      <h1 style={{ marginTop: 0, fontFamily: "var(--display)", fontSize: "1.65rem" }}>محرّر مخطط الصالة</h1>
      <p style={{ color: "var(--muted)", lineHeight: 1.6, marginTop: 0 }}>
        طوابق متعددة، رسم حدود بالنقر، تعديل النقاط، إضافة طاولات، سحب داخل الحدود، وربط{" "}
        <code>linkedTableId</code> بقائمة الطاولات من الـ API. الحفظ يستبدل <code>floor_plan.json</code> بالكامل ويزامن الطاولات
        تلقائياً مع <code>TBL005</code>.
      </p>
      <FloorPlanEditor apiTables={apiTables} onSaved={loadTables} />
    </div>
  );
}
