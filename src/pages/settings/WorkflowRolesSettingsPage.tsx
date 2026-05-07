import { useEffect, useMemo, useState } from "react";
import { getApiBase } from "../../lib/apiBase";
import {
  WORKFLOW_ROLE_OPTIONS,
  WORKFLOW_SETTINGS_DEFAULTS,
  type WorkflowSettings,
} from "../../lib/workflowSettingsModel";

const DEFAULTS = WORKFLOW_SETTINGS_DEFAULTS;

type OwnersVipAgent = { CardGuide: string; AgentName: string };
type VipTemplateRow = {
  id: string;
  agentGuid: string;
  label: string;
  noService: boolean;
  noVat: boolean;
  discountEnabled: boolean;
  discountPct: number;
  costPricingEnabled: boolean;
  costMarkupPct: number;
};

export default function WorkflowRolesSettingsPage() {
  const base = getApiBase();
  const [s, setS] = useState<WorkflowSettings>({ ...WORKFLOW_SETTINGS_DEFAULTS });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [opsVipJson, setOpsVipJson] = useState<string>("[]");
  const [ownersVipAgents, setOwnersVipAgents] = useState<OwnersVipAgent[]>([]);
  const [ownersVipGroupGuide, setOwnersVipGroupGuide] = useState<string>("");
  const [ownersVipAgentNameDraft, setOwnersVipAgentNameDraft] = useState("");
  const [ownersVipAgentBusy, setOwnersVipAgentBusy] = useState(false);
  const [ownersVipAgentMsg, setOwnersVipAgentMsg] = useState("");
  const [vipMsg, setVipMsg] = useState("");

  async function load() {
    setMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/workflow-settings`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setS({ ...DEFAULTS, ...(j || {}) });
    } catch (e) {
      setMsg(`تعذر تحميل إعدادات المسارات: ${String(e)}`);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function loadVipOps() {
    setVipMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/ops-settings?t=${Date.now()}`);
      const j = (await r.json().catch(() => ({}))) as { vipOwnerTemplatesJson?: unknown; detail?: string };
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setOpsVipJson(String(j.vipOwnerTemplatesJson || "[]"));
    } catch (e) {
      setVipMsg(`تعذر تحميل قوالب Owner/VIP: ${String(e)}`);
      setOpsVipJson("[]");
    }
  }

  async function loadOwnersVipAgents() {
    setOwnersVipAgentMsg("");
    try {
      const r = await fetch(`${base}/api/agents/by-group-name?group_name=${encodeURIComponent("owners&vip")}`);
      const j = (await r.json().catch(() => ({}))) as { agents?: OwnersVipAgent[]; groupGuide?: string; detail?: string };
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setOwnersVipAgents(Array.isArray(j.agents) ? j.agents : []);
      setOwnersVipGroupGuide(String(j.groupGuide || ""));
    } catch (e) {
      setOwnersVipAgentMsg(`تعذر تحميل مجموعة owners&vip: ${String(e)}`);
      setOwnersVipAgents([]);
      setOwnersVipGroupGuide("");
    }
  }

  useEffect(() => {
    void loadVipOps();
    void loadOwnersVipAgents();
  }, [base]);

  async function createOwnersVipAgent() {
    const name = ownersVipAgentNameDraft.trim();
    if (!name) return;
    setOwnersVipAgentBusy(true);
    setOwnersVipAgentMsg("");
    try {
      const r = await fetch(`${base}/api/agents/owners-vip/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ AgentName: name }),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; detail?: string; deduped?: boolean };
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setOwnersVipAgentNameDraft("");
      setOwnersVipAgentMsg(j.deduped ? "الاسم موجود بالفعل داخل المجموعة (تم استخدامه)." : "تم إضافة العميل للمجموعة بنجاح.");
      await loadOwnersVipAgents();
    } catch (e) {
      setOwnersVipAgentMsg(`فشل إضافة عميل owners&vip: ${String(e)}`);
    } finally {
      setOwnersVipAgentBusy(false);
    }
  }

  const vipTemplates: VipTemplateRow[] = useMemo(() => {
    const raw = String(opsVipJson || "[]").trim();
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((x) => x && typeof x === "object")
        .slice(0, 40)
        .map((x) => {
          const o = x as Partial<VipTemplateRow> & Record<string, unknown>;
          return {
            id: String(o.id || crypto.randomUUID()),
            agentGuid: String(o.agentGuid || ""),
            label: String(o.label || ""),
            noService: Boolean(o.noService),
            noVat: Boolean(o.noVat),
            discountEnabled: Boolean(o.discountEnabled),
            discountPct: Number(o.discountPct || 0),
            costPricingEnabled: Boolean(o.costPricingEnabled),
            costMarkupPct: Number(o.costMarkupPct || 0),
          };
        });
    } catch {
      return [];
    }
  }, [opsVipJson]);

  function writeVipTemplates(next: VipTemplateRow[]) {
    const safe = next.map((t) => ({
      id: String(t.id || ""),
      agentGuid: String(t.agentGuid || "").toUpperCase(),
      label: String(t.label || ""),
      noService: Boolean(t.noService),
      noVat: Boolean(t.noVat),
      discountEnabled: Boolean(t.discountEnabled),
      discountPct: Number.isFinite(t.discountPct) ? t.discountPct : 0,
      costPricingEnabled: Boolean(t.costPricingEnabled),
      costMarkupPct: Number.isFinite(t.costMarkupPct) ? t.costMarkupPct : 0,
    }));
    setOpsVipJson(JSON.stringify(safe));
  }

  async function saveVipOps() {
    setBusy(true);
    setVipMsg("");
    try {
      const payload = { vipOwnerTemplatesJson: String(opsVipJson || "[]") };
      const r = await fetch(`${base}/api/restaurant/ops-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await r.json().catch(() => ({}))) as { detail?: string; vipOwnerTemplatesJson?: unknown };
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setOpsVipJson(String(j.vipOwnerTemplatesJson || opsVipJson || "[]"));
      setVipMsg("تم حفظ قوالب Owner/VIP بنجاح.");
    } catch (e) {
      setVipMsg(`فشل حفظ قوالب Owner/VIP: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      const payload = {
        ...s,
        // توحيد مفتاحي التنظيف (قديم/جديد) لمنع أي تضارب في التطبيق.
        cleanTableBy: s.cleaningExecutionBy,
      };
      const r = await fetch(`${base}/api/restaurant/workflow-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setS({ ...DEFAULTS, ...(j || {}) });
      setMsg("تم حفظ دورة العمل حسب نوع المطعم بنجاح.");
    } catch (e) {
      setMsg(`فشل الحفظ: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>دورة العمل ومسارات الأدوار</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.88rem", maxWidth: 720 }}>
        نفس المفاتيح تُعاد في <code>GET /api/restaurant/ops-settings</code> مع إعدادات المطبخ؛ الحفظ هنا يحدّث <code>workflow-settings</code> فقط.
      </p>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>من يستقبل العميل عند الدخول</h3>
          <select value={s.receiveGuestBy} onChange={(e) => setS((x) => ({ ...x, receiveGuestBy: e.target.value }))} style={{ width: "100%" }}>
            {WORKFLOW_ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>من يأخذ طلبات العميل</h3>
          <select value={s.takeOrderBy} onChange={(e) => setS((x) => ({ ...x, takeOrderBy: e.target.value }))} style={{ width: "100%" }}>
            {WORKFLOW_ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>قفل الطاولة على كابتن واحد (جرسون الطلبات)</h3>
          <p style={{ marginTop: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
            عند التفعيل: يُقبل إرسال الطلبات وطلب الحساب فقط من المستخدم الذي ضغط «تسكين كابتن» على شريحة الطاولة، أو من المدير بعد التحويل. الافتراضي off لمطاعم لا تريد القفل.
          </p>
          <select
            value={s.orderTakerExclusiveTable}
            onChange={(e) => setS((x) => ({ ...x, orderTakerExclusiveTable: e.target.value }))}
            style={{ width: "100%" }}
          >
            <option value="off">لا — أي جرسون طلبات يعمل على الطاولة</option>
            <option value="on">نعم — قفل حتى تقفيل الحساب (مع استثناء المدير)</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>من يستلم من المطبخ ويوصل للطاولات</h3>
          <select value={s.deliverFromKitchenBy} onChange={(e) => setS((x) => ({ ...x, deliverFromKitchenBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="server">جرسون مناولة</option>
            <option value="waiter">نفس جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="host">جرسون الاستقبال</option>
            <option value="kitchen_window">استلام مباشر من نافذة الشيف</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>دور التنظيف (متوافق)</h3>
          <select value={s.cleaningExecutionBy} onChange={(e) => setS((x) => ({ ...x, cleaningExecutionBy: e.target.value, cleanTableBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="server">جرسون مناولة</option>
            <option value="waiter">جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="cleaner">عامل النظافة</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>من ينفذ طلب الشيك</h3>
          <select value={s.checkRequestBy} onChange={(e) => setS((x) => ({ ...x, checkRequestBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="waiter">جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="cashier">الكاشير</option>
            <option value="server">جرسون المناولة</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>عند استدعاء الكاشير</h3>
          <select value={s.cashierDispatchMode} onChange={(e) => setS((x) => ({ ...x, cashierDispatchMode: e.target.value }))} style={{ width: "100%" }}>
            <option value="visa_machine">إرسال ماكينة الفيزا</option>
            <option value="cash_collector">إرسال مندوب تحصيل كاش</option>
            <option value="both">الاثنين معًا</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>متى يبدأ التنظيف تلقائياً</h3>
          <select value={s.cleaningStartTrigger} onChange={(e) => setS((x) => ({ ...x, cleaningStartTrigger: e.target.value }))} style={{ width: "100%" }}>
            <option value="request_check">عند طلب الحساب</option>
            <option value="payment_completed">عند إتمام الدفع</option>
            <option value="manager_command">بأمر مباشر من المدير</option>
            <option value="waiter_command">بأمر مباشر من جرسون الطلبات</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>من ينفذ التنظيف</h3>
          <select value={s.cleaningExecutionBy} onChange={(e) => setS((x) => ({ ...x, cleaningExecutionBy: e.target.value, cleanTableBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="server">جرسون المناولة</option>
            <option value="waiter">جرسون الطلبات</option>
            <option value="manager">مدير المطعم</option>
            <option value="cleaner">عامل النظافة</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>مراجعة/اعتماد التنظيف</h3>
          <select value={s.cleaningReviewBy} onChange={(e) => setS((x) => ({ ...x, cleaningReviewBy: e.target.value }))} style={{ width: "100%" }}>
            <option value="none">بدون مراجعة</option>
            <option value="manager">المدير</option>
            <option value="waiter">جرسون الطلبات</option>
            <option value="cleaner">عامل النظافة</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>عند بدء التنظيف تتحول الطاولة إلى</h3>
          <select value={s.cleaningStartStatus} onChange={(e) => setS((x) => ({ ...x, cleaningStartStatus: e.target.value }))} style={{ width: "100%" }}>
            <option value="dirty">متسخة (تحتاج بدء تنظيف)</option>
            <option value="cleaning">قيد التنظيف (بدء مباشر)</option>
          </select>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>تعريف مالك / شخص مهم (Owner/VIP)</h3>
          <p style={{ fontSize: "0.88rem", color: "var(--muted)", marginTop: 0 }}>
            هذا القسم يعيد “نافذة الإدخال” التي تعتمدون عليها: ربط مجموعة <code>owners&vip</code> في <code>TBL015</code> بعملاء <code>TBL016</code>، ثم إنشاء قوالب تظهر في دروب داون شريحة الطاولة.
          </p>
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
            <h4 style={{ marginTop: 0 }}>عملاء owners&vip (TBL016 بدلالة TBL015)</h4>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={ownersVipAgentNameDraft}
                onChange={(e) => setOwnersVipAgentNameDraft(e.target.value)}
                style={{ width: "100%" }}
                placeholder="اسم عميل مالك/شخص مهم…"
              />
              <button type="button" className="btn btn-primary" disabled={ownersVipAgentBusy || !ownersVipAgentNameDraft.trim()} onClick={() => void createOwnersVipAgent()}>
                إضافة
              </button>
              <button type="button" className="btn btn-ghost" disabled={ownersVipAgentBusy} onClick={() => void loadOwnersVipAgents()}>
                تحديث
              </button>
            </div>
            {ownersVipAgentMsg ? <p style={{ marginTop: 8, fontSize: "0.85rem" }}>{ownersVipAgentMsg}</p> : null}
            <div style={{ marginTop: 8, fontSize: "0.85rem", color: "var(--muted)" }}>
              GroupGuide: <code>{ownersVipGroupGuide || "غير موجود"}</code> — العدد: <strong>{ownersVipAgents.length}</strong>
            </div>
            <div style={{ marginTop: 8, maxHeight: 140, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
              {ownersVipAgents.length ? (
                ownersVipAgents.map((a) => (
                  <div key={a.CardGuide} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span>{a.AgentName}</span>
                    <code style={{ opacity: 0.7 }}>{a.CardGuide}</code>
                  </div>
                ))
              ) : (
                <div style={{ color: "var(--muted)" }}>لا يوجد عملاء في مجموعة owners&vip حالياً.</div>
              )}
            </div>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, marginTop: 10 }}>
            <h4 style={{ marginTop: 0 }}>قوالب Owner/VIP (تظهر في الدروب داون)</h4>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  writeVipTemplates([
                    ...vipTemplates,
                    {
                      id: crypto.randomUUID(),
                      agentGuid: "",
                      label: "",
                      noService: false,
                      noVat: false,
                      discountEnabled: true,
                      discountPct: 0,
                      costPricingEnabled: false,
                      costMarkupPct: 0,
                    },
                  ])
                }
              >
                إضافة قالب
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void saveVipOps()} disabled={busy}>
                حفظ قوالب Owner/VIP
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => void loadVipOps()} disabled={busy}>
                تحديث القوالب
              </button>
            </div>
            {vipMsg ? <p style={{ marginTop: 0, fontSize: "0.85rem" }}>{vipMsg}</p> : null}
            {vipTemplates.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {vipTemplates.map((t, idx) => (
                  <div key={t.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        value={t.label}
                        onChange={(e) => {
                          const next = [...vipTemplates];
                          next[idx] = { ...t, label: e.target.value };
                          writeVipTemplates(next);
                        }}
                        style={{ width: "100%" }}
                        placeholder="اسم القالب (يظهر في الشريحة)…"
                      />
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          const next = vipTemplates.filter((x) => x.id !== t.id);
                          writeVipTemplates(next);
                        }}
                      >
                        حذف
                      </button>
                    </div>

                    <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                      <label style={{ fontWeight: 700, minWidth: 92 }}>العميل</label>
                      <select
                        value={t.agentGuid}
                        onChange={(e) => {
                          const next = [...vipTemplates];
                          next[idx] = { ...t, agentGuid: e.target.value };
                          writeVipTemplates(next);
                        }}
                        style={{ width: "100%" }}
                      >
                        <option value="">— اختر عميل من owners&vip —</option>
                        {ownersVipAgents.map((a) => (
                          <option key={a.CardGuide} value={a.CardGuide}>
                            {a.AgentName}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
                      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={t.noService}
                          onChange={(e) => {
                            const next = [...vipTemplates];
                            next[idx] = { ...t, noService: e.target.checked };
                            writeVipTemplates(next);
                          }}
                        />
                        بدون خدمة
                      </label>
                      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={t.noVat}
                          onChange={(e) => {
                            const next = [...vipTemplates];
                            next[idx] = { ...t, noVat: e.target.checked };
                            writeVipTemplates(next);
                          }}
                        />
                        بدون ضريبة
                      </label>
                    </div>

                    <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                      <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                        <input
                          type="checkbox"
                          checked={t.discountEnabled}
                          onChange={(e) => {
                            const next = [...vipTemplates];
                            next[idx] = { ...t, discountEnabled: e.target.checked };
                            writeVipTemplates(next);
                          }}
                        />
                        خصم
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        value={t.discountPct}
                        disabled={!t.discountEnabled}
                        onChange={(e) => {
                          const next = [...vipTemplates];
                          next[idx] = { ...t, discountPct: Number(e.target.value || 0) };
                          writeVipTemplates(next);
                        }}
                        style={{ width: 140 }}
                      />
                      <span style={{ color: "var(--muted)" }}>%</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "var(--muted)" }}>لا توجد قوالب حالياً. اضغط “إضافة قالب”.</div>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
          حفظ المسارات
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={busy}>
          تحديث
        </button>
      </div>
      {msg ? <p style={{ marginTop: 10 }}>{msg}</p> : null}
    </div>
  );
}

