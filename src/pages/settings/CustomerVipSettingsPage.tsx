import { useEffect, useMemo, useState } from "react";
import { getApiBase } from "../../lib/apiBase";
import SettingRow from "../../components/SettingRow";

type TabKey = "agents" | "vip" | "agent-groups";

type AgentGroup = { CardGuide: string; GroupName: string };

type Agent = {
  CardGuide: string;
  AgentName: string;
  CardNumber?: string;
  Phone?: string;
  Mobile?: string;
  TaxCode?: string;
  Address?: string;
  NotActive?: number;
};

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

type VipOps = {
  specialTableDefaultNoService: string;
  specialTableDefaultNoVat: string;
  specialTableDefaultDiscountPct: string;
  specialTableDefaultPriceMode: string;
  specialTableDefaultCostMarkupPct: string;
};

const VIP_DEFAULTS: VipOps = {
  specialTableDefaultNoService: "off",
  specialTableDefaultNoVat: "off",
  specialTableDefaultDiscountPct: "0",
  specialTableDefaultPriceMode: "menu",
  specialTableDefaultCostMarkupPct: "0",
};

export default function CustomerVipSettingsPage() {
  const base = getApiBase();
  const [tab, setTab] = useState<TabKey>("agents");
  const [msg] = useState("");
  const [busy, setBusy] = useState(false);

  // Agent Groups
  const [agentGroups, setAgentGroups] = useState<AgentGroup[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupMsg, setGroupMsg] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);

  // Agents
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedGroupGuid, setSelectedGroupGuid] = useState("");
  const [searchText, setSearchText] = useState("");
  const [agentMsg, setAgentMsg] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);

  // New agent form
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentCardNumber, setNewAgentCardNumber] = useState("");
  const [newAgentPhone, setNewAgentPhone] = useState("");
  const [newAgentMobile, setNewAgentMobile] = useState("");
  const [newAgentAddress, setNewAgentAddress] = useState("");
  const [newAgentTaxCode, setNewAgentTaxCode] = useState("");
  const [newAgentGroupGuid, setNewAgentGroupGuid] = useState("");

  // VIP
  const [vipOps, setVipOps] = useState<VipOps>(VIP_DEFAULTS);
  const [opsVipJson, setOpsVipJson] = useState<string>("[]");
  const [ownersVipAgents, setOwnersVipAgents] = useState<OwnersVipAgent[]>([]);
  const [ownersVipGroupGuide, setOwnersVipGroupGuide] = useState<string>("");
  const [ownersVipAgentNameDraft, setOwnersVipAgentNameDraft] = useState("");
  const [ownersVipAgentBusy, setOwnersVipAgentBusy] = useState(false);
  const [ownersVipAgentMsg, setOwnersVipAgentMsg] = useState("");
  const [vipMsg, setVipMsg] = useState("");

  async function loadAgentGroups() {
    try {
      const r = await fetch(`${base}/api/agent-groups`);
      const j = (await r.json().catch(() => ({}))) as { groups?: AgentGroup[] };
      const list = Array.isArray(j.groups) ? j.groups : [];
      setAgentGroups(list);
      if (list.length > 0 && !selectedGroupGuid) {
        setSelectedGroupGuid(list[0].CardGuide);
        setNewAgentGroupGuid(list[0].CardGuide);
      }
    } catch (e) {
      setGroupMsg(`تعذر تحميل مجموعات العملاء: ${String(e)}`);
    }
  }

  async function loadAgentsByGroup(groupGuid?: string) {
    const gid = groupGuid || selectedGroupGuid;
    if (!gid) return;
    setAgentBusy(true);
    setAgentMsg("");
    try {
      const r = await fetch(`${base}/api/agents?group_guide=${encodeURIComponent(gid)}`);
      const j = (await r.json().catch(() => ({}))) as { agents?: Agent[] };
      setAgents(Array.isArray(j.agents) ? j.agents : []);
    } catch (e) {
      setAgentMsg(`تعذر تحميل العملاء: ${String(e)}`);
    } finally {
      setAgentBusy(false);
    }
  }

  async function searchAgents() {
    const s = searchText.trim();
    if (!s) { await loadAgentsByGroup(); return; }
    setAgentBusy(true);
    setAgentMsg("");
    try {
      const r = await fetch(`${base}/api/agents/search?search_text=${encodeURIComponent(s)}`);
      const j = (await r.json().catch(() => ({}))) as { agents?: Agent[] };
      setAgents(Array.isArray(j.agents) ? j.agents : []);
    } catch (e) {
      setAgentMsg(`تعذر البحث: ${String(e)}`);
    } finally {
      setAgentBusy(false);
    }
  }

  async function createAgent() {
    const name = newAgentName.trim();
    if (!name) { setAgentMsg("اسم العميل مطلوب."); return; }
    const mg = newAgentGroupGuid || selectedGroupGuid;
    if (!mg) { setAgentMsg("اختر مجموعة العميل من TBL015."); return; }
    setAgentBusy(true);
    setAgentMsg("");
    try {
      const body = {
        AgentName: name,
        MainGroupGuide: mg,
        group_guide: mg,
        CardNumber: newAgentCardNumber.trim() || undefined,
        Phone: newAgentPhone.trim() || undefined,
        Mobile: newAgentMobile.trim() || undefined,
        FullAdress: newAgentAddress.trim() || undefined,
        TaxCode: newAgentTaxCode.trim() || undefined,
      };
      const r = await fetch(`${base}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setNewAgentName(""); setNewAgentCardNumber(""); setNewAgentPhone("");
      setNewAgentMobile(""); setNewAgentAddress(""); setNewAgentTaxCode("");
      setAgentMsg("تم إنشاء العميل بنجاح.");
      await loadAgentsByGroup(mg);
    } catch (e) {
      setAgentMsg(`فشل إنشاء العميل: ${String(e)}`);
    } finally {
      setAgentBusy(false);
    }
  }

  async function createAgentGroup() {
    const name = newGroupName.trim();
    if (!name) { setGroupMsg("اسم المجموعة مطلوب."); return; }
    setGroupBusy(true);
    setGroupMsg("");
    try {
      const r = await fetch(`${base}/api/agent-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ GroupName: name }),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; CardGuide?: string };
      if (!r.ok) throw new Error("فشل الإنشاء");
      setNewGroupName("");
      setGroupMsg("تم إنشاء المجموعة بنجاح.");
      await loadAgentGroups();
      if (j.CardGuide) { setSelectedGroupGuid(j.CardGuide); setNewAgentGroupGuid(j.CardGuide); }
    } catch (e) {
      setGroupMsg(`فشل إنشاء المجموعة: ${String(e)}`);
    } finally {
      setGroupBusy(false);
    }
  }

  async function loadVipOps() {
    setVipMsg("");
    try {
      const r = await fetch(`${base}/api/restaurant/ops-settings?t=${Date.now()}`);
      const j = (await r.json().catch(() => ({}))) as {
        vipOwnerTemplatesJson?: unknown;
        specialTableDefaultNoService?: string;
        specialTableDefaultNoVat?: string;
        specialTableDefaultDiscountPct?: string;
        specialTableDefaultPriceMode?: string;
        specialTableDefaultCostMarkupPct?: string;
        detail?: string;
      };
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setOpsVipJson(String(j.vipOwnerTemplatesJson || "[]"));
      setVipOps({
        specialTableDefaultNoService: String(j.specialTableDefaultNoService || VIP_DEFAULTS.specialTableDefaultNoService),
        specialTableDefaultNoVat: String(j.specialTableDefaultNoVat || VIP_DEFAULTS.specialTableDefaultNoVat),
        specialTableDefaultDiscountPct: String(j.specialTableDefaultDiscountPct || VIP_DEFAULTS.specialTableDefaultDiscountPct),
        specialTableDefaultPriceMode: String(j.specialTableDefaultPriceMode || VIP_DEFAULTS.specialTableDefaultPriceMode),
        specialTableDefaultCostMarkupPct: String(j.specialTableDefaultCostMarkupPct || VIP_DEFAULTS.specialTableDefaultCostMarkupPct),
      });
    } catch (e) {
      setVipMsg(`تعذر تحميل إعدادات VIP: ${String(e)}`);
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
    }
  }

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

  async function saveVipOps() {
    setBusy(true);
    setVipMsg("");
    try {
      const payload = {
        vipOwnerTemplatesJson: String(opsVipJson || "[]"),
        ...vipOps,
      };
      const r = await fetch(`${base}/api/restaurant/ops-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await r.json().catch(() => ({}))) as { detail?: string; vipOwnerTemplatesJson?: unknown };
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setOpsVipJson(String(j.vipOwnerTemplatesJson || opsVipJson || "[]"));
      setVipMsg("تم حفظ إعدادات Owner/VIP بنجاح.");
    } catch (e) {
      setVipMsg(`فشل الحفظ: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const vipTemplates: VipTemplateRow[] = useMemo(() => {
    const raw = String(opsVipJson || "[]").trim();
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((x: unknown) => x && typeof x === "object")
        .slice(0, 40)
        .map((x: unknown) => {
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

  useEffect(() => {
    void loadAgentGroups();
    void loadVipOps();
    void loadOwnersVipAgents();
  }, [base]);

  useEffect(() => {
    if (selectedGroupGuid) void loadAgentsByGroup(selectedGroupGuid);
  }, [selectedGroupGuid]);

  const tabBtn = (key: TabKey, label: string) => (
    <button type="button" key={key} className={`btn ${tab === key ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab(key)} style={{ fontWeight: 700 }}>{label}</button>
  );


  return (
    <div style={{ maxWidth: 900 }}>
      <h2 style={{ marginTop: 0 }}>تعريف العملاء والمالكين / VIP</h2>
      <div className="card" style={{ marginBottom: 16, background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.2)" }}>
        <h4 style={{ marginTop: 0, color: "#2563eb" }}>🛈 كيفية استخدام نظام العملاء والمالكين</h4>
        <ol style={{ fontSize: "0.88rem", lineHeight: 1.7, margin: 0, paddingRight: 20, color: "var(--text)" }}>
          <li><strong>مجموعات العملاء (TBL015):</strong> أنشئ مجموعات لتصنيف العملاء (مثال: "عملاء VIP"، "شركات") — هذه الخطوة الأولى.</li>
          <li><strong>تعريف العملاء (TBL016):</strong> أضف العملاء داخل المجموعات السابقة. كل عميل يحمل بطاقة ورقم هاتف.</li>
          <li><strong>المالك / VIP:</strong> العملاء الذين تُضاف أسماؤهم في مجموعة <code>owners&vip</code> يصبحون متاحين كـ "مالك طاولة" عند فتح جلسة طاولة.</li>
          <li><strong>إعدادات VIP الافتراضية:</strong> تُطبّق تلقائياً على أي طاولة مفتوحة كـ VIP (بدون خدمة، خصم، إلخ).</li>
          <li><strong>قوالب Owner/VIP:</strong> أنماط محددة تظهر في دروب داون عند فتح طاولة، تربط بين عميل محدد وإعداداته (خصم %، تسعير).</li>
        </ol>
        <p style={{ fontSize: "0.82rem", color: "var(--muted)", marginBottom: 0, marginTop: 8 }}>
          <strong>ملاحظة:</strong> الطاولة تصبح VIP عند اختيار "مالك" أو "VIP" أثناء فتح الجلسة — القوالب تُسرّع هذا الاختيار.
        </p>
      </div>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
        إدارة عملاء TBL016 مع مجموعات TBL015، وإعدادات المالكين/VIP.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabBtn("agents", "تعريف العملاء")}
        {tabBtn("vip", "المالك / VIP")}
        {tabBtn("agent-groups", "مجموعات العملاء")}
      </div>
      {msg ? <p style={{ marginTop: 0, color: "var(--accent2)" }}>{msg}</p> : null}

      {/* TAB: Agents */}
      {tab === "agents" && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>إضافة عميل جديد</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "block" }}>
                <span style={{ fontWeight: 700 }}>الاسم *</span>
                <input value={newAgentName} onChange={(e) => setNewAgentName(e.target.value)} placeholder="اسم العميل" style={{ width: "100%", marginTop: 6 }} />
              </label>
              <label style={{ display: "block" }}>
                <span style={{ fontWeight: 700 }}>المجموعة (TBL015) *</span>
                <select value={newAgentGroupGuid} onChange={(e) => setNewAgentGroupGuid(e.target.value)} style={{ width: "100%", marginTop: 6 }}>
                  {agentGroups.length === 0 ? <option value="">— لا توجد مجموعات —</option> : null}
                  {agentGroups.map((g) => (<option key={g.CardGuide} value={g.CardGuide}>{g.GroupName}</option>))}
                </select>
              </label>
              <label style={{ display: "block" }}>
                <span style={{ fontWeight: 700 }}>رقم البطاقة</span>
                <input value={newAgentCardNumber} onChange={(e) => setNewAgentCardNumber(e.target.value)} placeholder="رقم البطاقة" style={{ width: "100%", marginTop: 6 }} />
              </label>
              <label style={{ display: "block" }}>
                <span style={{ fontWeight: 700 }}>الهاتف</span>
                <input value={newAgentPhone} onChange={(e) => setNewAgentPhone(e.target.value)} placeholder="رقم الهاتف" style={{ width: "100%", marginTop: 6 }} />
              </label>
              <label style={{ display: "block" }}>
                <span style={{ fontWeight: 700 }}>الموبايل</span>
                <input value={newAgentMobile} onChange={(e) => setNewAgentMobile(e.target.value)} placeholder="رقم الموبايل" style={{ width: "100%", marginTop: 6 }} />
              </label>
              <label style={{ display: "block" }}>
                <span style={{ fontWeight: 700 }}>الرقم الضريبي</span>
                <input value={newAgentTaxCode} onChange={(e) => setNewAgentTaxCode(e.target.value)} placeholder="Tax Code" style={{ width: "100%", marginTop: 6 }} />
              </label>
            </div>
            <label style={{ display: "block", marginTop: 12 }}>
              <span style={{ fontWeight: 700 }}>العنوان</span>
              <input value={newAgentAddress} onChange={(e) => setNewAgentAddress(e.target.value)} placeholder="عنوان العميل" style={{ width: "100%", marginTop: 6 }} />
            </label>
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button type="button" className="btn btn-primary" disabled={agentBusy} onClick={() => void createAgent()}>{agentBusy ? "جاري الحفظ…" : "حفظ العميل"}</button>
              <button type="button" className="btn btn-ghost" disabled={agentBusy} onClick={() => { setNewAgentName(""); setNewAgentCardNumber(""); setNewAgentPhone(""); setNewAgentMobile(""); setNewAgentAddress(""); setNewAgentTaxCode(""); }}>تفريغ</button>
            </div>
            {agentMsg ? <p style={{ marginTop: 10, fontSize: "0.9rem" }}>{agentMsg}</p> : null}
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>قائمة العملاء</h3>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 240px" }}>
                <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>المجموعة:</span>
                <select value={selectedGroupGuid} onChange={(e) => setSelectedGroupGuid(e.target.value)} style={{ width: "100%" }}>
                  {agentGroups.length === 0 ? <option value="">— لا توجد مجموعات —</option> : null}
                  {agentGroups.map((g) => (<option key={g.CardGuide} value={g.CardGuide}>{g.GroupName}</option>))}
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 240px" }}>
                <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>بحث:</span>
                <input value={searchText} onChange={(e) => setSearchText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void searchAgents(); }} placeholder="اسم أو هاتف أو رقم…" style={{ width: "100%" }} />
              </label>
              <button type="button" className="btn btn-ghost" disabled={agentBusy} onClick={() => void searchAgents()}>بحث</button>
              <button type="button" className="btn btn-ghost" disabled={agentBusy} onClick={() => void loadAgentsByGroup()}>تحديث</button>
            </div>
            <div style={{ maxHeight: 360, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
              {agents.length === 0 ? (
                <div style={{ color: "var(--muted)", padding: 12 }}>لا يوجد عملاء في هذه المجموعة.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                  <thead>
                    <tr style={{ textAlign: "right", borderBottom: "1px solid var(--border)" }}>
                      <th style={{ padding: "6px 8px" }}>الاسم</th>
                      <th style={{ padding: "6px 8px" }}>رقم البطاقة</th>
                      <th style={{ padding: "6px 8px" }}>الهاتف</th>
                      <th style={{ padding: "6px 8px" }}>الموبايل</th>
                      <th style={{ padding: "6px 8px" }}>الرقم الضريبي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((a) => (
                      <tr key={a.CardGuide} style={{ borderBottom: "1px solid rgba(15,23,42,0.06)" }}>
                        <td style={{ padding: "6px 8px" }}>{a.AgentName}</td>
                        <td style={{ padding: "6px 8px", direction: "ltr" }}>{a.CardNumber || "—"}</td>
                        <td style={{ padding: "6px 8px", direction: "ltr" }}>{a.Phone || "—"}</td>
                        <td style={{ padding: "6px 8px", direction: "ltr" }}>{a.Mobile || "—"}</td>
                        <td style={{ padding: "6px 8px", direction: "ltr" }}>{a.TaxCode || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB: VIP */}
      {tab === "vip" && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>إعدادات المالك / VIP الافتراضية</h3>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: 0 }}>تُطبّق تلقائياً على جلسات طاولات VIP عند فتحها. هذه القيم تكون بدايةً فقط — يمكن تعديلها لكل طاولة.</p>
            <SettingRow label="بدون خدمة" tooltip="إذا فُعِل، لن تُحسب نسبة الخدمة على الفاتورة عند فتح طاولة VIP. يمكن تعديله لكل طاولة لاحقاً.">
              <select value={vipOps.specialTableDefaultNoService} onChange={(e) => setVipOps((x) => ({ ...x, specialTableDefaultNoService: e.target.value }))} style={{ width: "100%" }}>
                <option value="off">لا</option><option value="on">نعم</option>
              </select>
            </SettingRow>
            <SettingRow label="بدون ضريبة" tooltip="إذا فُعِل، لن تُحسب ضريبة القيمة المضافة (VAT) على فاتورة طاولة VIP. يُستخدم عادةً للعملاء المُعفين ضريبياً.">
              <select value={vipOps.specialTableDefaultNoVat} onChange={(e) => setVipOps((x) => ({ ...x, specialTableDefaultNoVat: e.target.value }))} style={{ width: "100%" }}>
                <option value="off">لا</option><option value="on">نعم</option>
              </select>
            </SettingRow>
            <SettingRow label="خصم افتراضي %" tooltip="نسبة الخصم التلقائية التي تُطبّق على فاتورة طاولة VIP. يُحسب قبل الضريبة حسب إعدادات السياسة المالية.">
              <input type="number" min={0} max={100} step={0.5} value={vipOps.specialTableDefaultDiscountPct} onChange={(e) => setVipOps((x) => ({ ...x, specialTableDefaultDiscountPct: e.target.value }))} style={{ width: "100%" }} />
            </SettingRow>
            <SettingRow label="طريقة التسعير" tooltip="سعر المنيو = الأسعار المعروضة في قائمة الطعام. تكلفة + نسبة = سعر التكلفة الفعلية + نسبة ربح (يُستخدم للعملاء الخاصين أو المالكين).">
              <select value={vipOps.specialTableDefaultPriceMode} onChange={(e) => setVipOps((x) => ({ ...x, specialTableDefaultPriceMode: e.target.value }))} style={{ width: "100%" }}>
                <option value="menu">سعر المنيو (الافتراضي)</option><option value="cost_plus">سعر التكلفة + نسبة</option>
              </select>
            </SettingRow>
            <SettingRow label="نسبة فوق التكلفة %" tooltip="عند اختيار 'سعر التكلفة + نسبة' أعلاه، هذه النسبة تُضاف فوق تكلفة المنتج. مثال: إذا تكلفة الصنف 50 جنيه ونسبة 20%، السعر = 60 جنيه.">
              <input type="number" min={0} max={400} step={0.5} value={vipOps.specialTableDefaultCostMarkupPct} disabled={String(vipOps.specialTableDefaultPriceMode || "").toLowerCase() !== "cost_plus"} onChange={(e) => setVipOps((x) => ({ ...x, specialTableDefaultCostMarkupPct: e.target.value }))} style={{ width: "100%" }} placeholder="مثال: 10 يعني تكلفة + 10%" />
            </SettingRow>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>عملاء owners&amp;vip (TBL016) <span title="هؤلاء العملاء يظهرون كخيار 'مالك' عند فتح جلسة طاولة" style={{ cursor: "help", color: "#2563eb" }}>🛈</span></h3>
            <p style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: 0 }}>العملاء هنا يصبحون متاحين كـ "مالك طاولة" أو "VIP" في شاشة فتح الجلسة.</p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input value={ownersVipAgentNameDraft} onChange={(e) => setOwnersVipAgentNameDraft(e.target.value)} style={{ width: "100%" }} placeholder="اسم عميل مالك/شخص مهم…" />
              <button type="button" className="btn btn-primary" disabled={ownersVipAgentBusy || !ownersVipAgentNameDraft.trim()} onClick={() => void createOwnersVipAgent()}>إضافة</button>
              <button type="button" className="btn btn-ghost" disabled={ownersVipAgentBusy} onClick={() => void loadOwnersVipAgents()}>تحديث</button>
            </div>
            {ownersVipAgentMsg ? <p style={{ marginTop: 8, fontSize: "0.85rem" }}>{ownersVipAgentMsg}</p> : null}
            <div style={{ marginTop: 8, fontSize: "0.85rem", color: "var(--muted)" }}>GroupGuide: <code>{ownersVipGroupGuide || "غير موجود"}</code> — العدد: <strong>{ownersVipAgents.length}</strong></div>
            <div style={{ marginTop: 8, maxHeight: 140, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
              {ownersVipAgents.length ? ownersVipAgents.map((a) => (
                <div key={a.CardGuide} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span>{a.AgentName}</span><code style={{ opacity: 0.7 }}>{a.CardGuide}</code></div>
              )) : (<div style={{ color: "var(--muted)" }}>لا يوجد عملاء في مجموعة owners&amp;vip حالياً.</div>)}
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>قوالب Owner/VIP (تظهر عند فتح طاولة)</h3>
            <p style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: 0 }}>قوالب جاهزة تُسرّع فتح طاولة — تختار عميل + خصم + تسعير في نقرة واحدة.</p>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-ghost" onClick={() => writeVipTemplates([...vipTemplates, { id: crypto.randomUUID(), agentGuid: "", label: "", noService: false, noVat: false, discountEnabled: true, discountPct: 0, costPricingEnabled: false, costMarkupPct: 0 }])}>إضافة قالب</button>
              <button type="button" className="btn btn-primary" onClick={() => void saveVipOps()} disabled={busy}>حفظ إعدادات Owner/VIP</button>
              <button type="button" className="btn btn-ghost" onClick={() => void loadVipOps()} disabled={busy}>تحديث</button>
            </div>
            {vipMsg ? <p style={{ marginTop: 0, fontSize: "0.85rem" }}>{vipMsg}</p> : null}
            {vipTemplates.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {vipTemplates.map((t, idx) => (
                  <div key={t.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input value={t.label} onChange={(e) => { const next = [...vipTemplates]; next[idx] = { ...t, label: e.target.value }; writeVipTemplates(next); }} style={{ width: "100%" }} placeholder="اسم القالب (يظهر في الشريحة)…" />
                      <button type="button" className="btn btn-ghost" onClick={() => writeVipTemplates(vipTemplates.filter((x) => x.id !== t.id))}>حذف</button>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                      <label style={{ fontWeight: 700, minWidth: 92 }}>العميل</label>
                      <select value={t.agentGuid} onChange={(e) => { const next = [...vipTemplates]; next[idx] = { ...t, agentGuid: e.target.value }; writeVipTemplates(next); }} style={{ width: "100%" }}>
                        <option value="">— اختر عميل من owners&amp;vip —</option>
                        {ownersVipAgents.map((a) => (<option key={a.CardGuide} value={a.CardGuide}>{a.AgentName}</option>))}
                      </select>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
                      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input type="checkbox" checked={t.noService} onChange={(e) => { const next = [...vipTemplates]; next[idx] = { ...t, noService: e.target.checked }; writeVipTemplates(next); }} /> بدون خدمة
                      </label>
                      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input type="checkbox" checked={t.noVat} onChange={(e) => { const next = [...vipTemplates]; next[idx] = { ...t, noVat: e.target.checked }; writeVipTemplates(next); }} /> بدون ضريبة
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                      <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                        <input type="checkbox" checked={t.discountEnabled} onChange={(e) => { const next = [...vipTemplates]; next[idx] = { ...t, discountEnabled: e.target.checked }; writeVipTemplates(next); }} /> خصم
                      </label>
                      <input type="number" min={0} max={100} step={0.5} value={t.discountPct} disabled={!t.discountEnabled} onChange={(e) => { const next = [...vipTemplates]; next[idx] = { ...t, discountPct: Number(e.target.value || 0) }; writeVipTemplates(next); }} style={{ width: 140 }} />
                      <span style={{ color: "var(--muted)" }}>%</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (<div style={{ color: "var(--muted)" }}>لا توجد قوالب حالياً. اضغط "إضافة قالب".</div>)}
          </div>
        </div>
      )}

      {/* TAB: Agent Groups */}
      {tab === "agent-groups" && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>مجموعات العملاء (TBL015)</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="اسم مجموعة جديدة…" style={{ flex: 1 }} />
            <button type="button" className="btn btn-primary" disabled={groupBusy} onClick={() => void createAgentGroup()}>{groupBusy ? "جاري…" : "إضافة مجموعة"}</button>
          </div>
          {groupMsg ? <p style={{ fontSize: "0.9rem" }}>{groupMsg}</p> : null}
          <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
            {agentGroups.length === 0 ? (
              <div style={{ color: "var(--muted)", padding: 12 }}>لا توجد مجموعات عملاء.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                <thead>
                  <tr style={{ textAlign: "right", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "6px 8px" }}>المجموعة</th>
                    <th style={{ padding: "6px 8px" }}>GUID</th>
                  </tr>
                </thead>
                <tbody>
                  {agentGroups.map((g) => (
                    <tr key={g.CardGuide} style={{ borderBottom: "1px solid rgba(15,23,42,0.06)" }}>
                      <td style={{ padding: "6px 8px" }}>{g.GroupName}</td>
                      <td style={{ padding: "6px 8px", direction: "ltr" }}><code>{g.CardGuide}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
