import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import { useAuth } from "../auth/AuthContext";
import { sessionDisplayName } from "../auth/displayUser";
import "../styles/deliveryOpsHub.css";

type HubTab = "intake" | "queue" | "convert" | "tickets";

type AgentHit = {
  CardGuide: string;
  AgentName?: string;
  Phone?: string;
  Mobile?: string;
  Phone2?: string;
  Address?: string;
  FullAdress?: string;
};

type DeliveryTicket = {
  id: string;
  status?: string;
  channel?: string;
  createdAt?: string;
  customerName?: string;
  phone?: string;
  phone2?: string;
  area?: string;
  address?: string;
  fullAddress?: string;
  deliveryTime?: string;
  requestedItemsText?: string;
  specialNotes?: string;
  agentGuid?: string;
  shippingFee?: number;
  noVat?: boolean;
  driverName?: string;
  platformName?: string;
  platformOrderId?: string;
  platformUrl?: string;
  sessionId?: string;
  sourceTableId?: string;
  gps?: { lat?: number; lng?: number } | null;
  attachments?: Array<{ url?: string; fileName?: string }>;
};

type OpenTable = {
  sessionId: string;
  tableId?: string;
  tableDisplayName?: string;
  itemsSubtotal?: number;
  captainName?: string;
  guestCount?: number;
  awaitingPayment?: boolean;
  channel?: string;
};

type QueueOrder = {
  id: string;
  ticketNo?: number;
  tableId?: string;
  status?: string;
  sessionId?: string;
  items?: Array<{ name?: string; quantity?: number }>;
  deliveryTicket?: Partial<DeliveryTicket>;
};

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "واتساب",
  phone: "هاتف",
  platform: "منصة",
  table_convert: "من طاولة",
  pos: "نقطة بيع",
};

function rolePosPath(role?: string) {
  const r = String(role || "cashier");
  if (r === "manager" || r === "operation_manager" || r === "developer") return `/app/${r}/pos`;
  if (r === "accountant") return `/app/accountant/pos`;
  return "/app/cashier/pos";
}

function roleCallCenterPath(role?: string) {
  const r = String(role || "cashier");
  if (r === "manager" || r === "operation_manager" || r === "developer") return `/app/${r}/call-center`;
  return "/app/cashier/call-center";
}

export default function DeliveryOpsHubPage() {
  const base = getApiBase();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as HubTab) || "intake";
  const setTab = (t: HubTab) => {
    const next = new URLSearchParams(params);
    next.set("tab", t);
    setParams(next, { replace: true });
  };

  const [channel, setChannel] = useState<"whatsapp" | "phone" | "platform">("whatsapp");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<AgentHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [phone2, setPhone2] = useState("");
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [deliveryTime, setDeliveryTime] = useState("");
  const [requestedItems, setRequestedItems] = useState("");
  const [specialNotes, setSpecialNotes] = useState("");
  const [shippingFee, setShippingFee] = useState("0");
  const [noVat, setNoVat] = useState(true);
  const [driverName, setDriverName] = useState("");
  const [platformName, setPlatformName] = useState("");
  const [platformOrderId, setPlatformOrderId] = useState("");
  const [platformUrl, setPlatformUrl] = useState("");
  const [agentGuid, setAgentGuid] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [shotFile, setShotFile] = useState<File | null>(null);
  const [shotPreview, setShotPreview] = useState<string | null>(null);
  const [pasteFlash, setPasteFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tickets, setTickets] = useState<DeliveryTicket[]>([]);
  const [queue, setQueue] = useState<QueueOrder[]>([]);
  const [openTables, setOpenTables] = useState<OpenTable[]>([]);
  const searchTimer = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pasteZoneRef = useRef<HTMLDivElement | null>(null);

  const applyShotFile = useCallback((file: File | null, source: "file" | "paste" | "drop" = "file") => {
    setShotFile(file);
    setShotPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
    if (file) {
      const label =
        source === "paste" ? "تم لصق صورة الواتساب ✓" : source === "drop" ? "تم إسقاط الصورة ✓" : `تم اختيار الصورة: ${file.name}`;
      setMsg(label);
      setPasteFlash(true);
      window.setTimeout(() => setPasteFlash(false), 900);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (shotPreview) URL.revokeObjectURL(shotPreview);
    };
  }, [shotPreview]);

  /** Ctrl+V / Cmd+V لصورة من الحافظة أثناء تبويب الاستقبال (سكرين واتساب من الديسكتوب). */
  useEffect(() => {
    if (tab !== "intake") return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items?.length) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || !String(item.type || "").startsWith("image/")) continue;
        const blob = item.getAsFile();
        if (!blob) continue;
        e.preventDefault();
        const ext = item.type.includes("jpeg") || item.type.includes("jpg") ? "jpg" : "png";
        const file = new File([blob], `whatsapp-paste-${Date.now()}.${ext}`, {
          type: blob.type || "image/png",
        });
        applyShotFile(file, "paste");
        return;
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [tab, applyShotFile]);

  const loadTickets = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/restaurant/delivery/tickets?limit=60`, { cache: "no-store" });
      const j = tryParseJson<{ tickets?: DeliveryTicket[] }>(await r.text()) ?? {};
      setTickets(Array.isArray(j.tickets) ? j.tickets : []);
    } catch {
      setTickets([]);
    }
  }, [base]);

  const loadQueue = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/restaurant/orders/delivery-queue?t=${Date.now()}`, { cache: "no-store" });
      const j = tryParseJson<{ orders?: QueueOrder[] }>(await r.text()) ?? {};
      setQueue(Array.isArray(j.orders) ? j.orders : []);
    } catch {
      setQueue([]);
    }
  }, [base]);

  const loadOpenTables = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/restaurant/cashier/table-overview`, { cache: "no-store" });
      const j = tryParseJson<{ sessions?: OpenTable[] }>(await r.text()) ?? {};
      setOpenTables(Array.isArray(j.sessions) ? j.sessions : []);
    } catch {
      setOpenTables([]);
    }
  }, [base]);

  useEffect(() => {
    void loadTickets();
    void loadQueue();
    void loadOpenTables();
    const id = window.setInterval(() => {
      void loadTickets();
      void loadQueue();
      void loadOpenTables();
    }, 20000);
    return () => window.clearInterval(id);
  }, [loadTickets, loadQueue, loadOpenTables]);

  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const text = q.trim();
    if (text.length < 2) {
      setHits([]);
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        try {
          const r = await fetch(`${base}/api/agents/search?search_text=${encodeURIComponent(text)}`);
          const j = tryParseJson<{ agents?: AgentHit[] }>(await r.text()) ?? {};
          setHits(Array.isArray(j.agents) ? j.agents.slice(0, 12) : []);
        } catch {
          setHits([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 220);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [q, base]);

  function pickAgent(a: AgentHit) {
    setAgentGuid(a.CardGuide);
    setName(String(a.AgentName || ""));
    setPhone(String(a.Phone || a.Mobile || ""));
    setPhone2(String(a.Phone2 || a.Mobile || ""));
    const addr = String(a.FullAdress || a.Address || "");
    const m = addr.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (m) {
      setArea(m[1]);
      setAddress(m[2] || "");
    } else {
      setAddress(addr);
    }
    setQ(String(a.AgentName || ""));
    setHits([]);
    setMsg(`تم اختيار العميل: ${a.AgentName}`);
  }

  function captureGps() {
    if (!navigator.geolocation) {
      setMsg("المتصفح لا يدعم GPS");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setMsg("تم حفظ موقع GPS");
      },
      () => setMsg("تعذر قراءة GPS — اسمح بالموقع من المتصفح"),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  function openOrdering(ticket: DeliveryTicket) {
    const qs = new URLSearchParams();
    qs.set("orderType", "delivery");
    if (ticket.agentGuid) qs.set("agentGuid", ticket.agentGuid);
    if (ticket.id) qs.set("deliveryTicketId", ticket.id);
    if (ticket.shippingFee != null) qs.set("shippingFee", String(ticket.shippingFee));
    if (ticket.noVat) qs.set("noVat", "1");
    if (ticket.driverName) qs.set("driverName", ticket.driverName);
    if (ticket.phone) qs.set("phone", ticket.phone);
    if (ticket.customerName) qs.set("name", ticket.customerName);
    if (ticket.fullAddress || ticket.address) qs.set("address", ticket.fullAddress || ticket.address || "");
    navigate(`${rolePosPath(user?.role)}?${qs.toString()}`);
  }

  async function submitIntake(openPosAfter: boolean) {
    setMsg("");
    if (!name.trim() || !phone.trim() || !area.trim()) {
      setMsg("مطلوب: الاسم + الهاتف + المنطقة");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`${base}/api/restaurant/delivery/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          name: name.trim(),
          phone: phone.trim(),
          phone2: phone2.trim() || undefined,
          area: area.trim(),
          address: address.trim(),
          deliveryTime: deliveryTime.trim() || undefined,
          requestedItems: requestedItems.trim() || undefined,
          specialNotes: specialNotes.trim() || undefined,
          shippingFee: Number(shippingFee) || 0,
          noVat,
          driverName: driverName.trim() || undefined,
          platformName: channel === "platform" ? platformName.trim() : undefined,
          platformOrderId: channel === "platform" ? platformOrderId.trim() : undefined,
          platformUrl: channel === "platform" ? platformUrl.trim() : undefined,
          gps: gps || undefined,
          createdBy: {
            userId: user?.id != null ? String(user.id) : "",
            name: sessionDisplayName(user),
            role: user?.role || "",
          },
        }),
      });
      const t = await r.text();
      const j = tryParseJson<{ ok?: boolean; ticket?: DeliveryTicket; detail?: string }>(t) ?? {};
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : t);

      const ticket = j.ticket;
      if (ticket?.id && shotFile) {
        const fd = new FormData();
        fd.append("file", shotFile);
        await fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(ticket.id)}/attachment`, {
          method: "POST",
          body: fd,
        });
      }

      setMsg("تم تسجيل الاستقبال بنجاح");
      applyShotFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await loadTickets();
      if (openPosAfter && ticket) openOrdering(ticket);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function convertTable(sessionId: string, tableLabel: string) {
    const cName = window.prompt(`اسم مستلم الدليفري لـ ${tableLabel}`, tableLabel) || "";
    const cPhone = window.prompt("هاتف المستلم", "") || "";
    const cArea = window.prompt("المنطقة", "تحويل من الصالة") || "تحويل من الصالة";
    if (!cName.trim() || !cPhone.trim()) {
      setMsg("التحويل يحتاج اسماً وهاتفاً على الأقل");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`${base}/api/restaurant/table-sessions/${encodeURIComponent(sessionId)}/convert-to-delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cName.trim(),
          phone: cPhone.trim(),
          area: cArea.trim(),
          noVat: true,
          shippingFee: Number(shippingFee) || 0,
          createdBy: { name: sessionDisplayName(user), role: user?.role },
        }),
      });
      const t = await r.text();
      const j = tryParseJson<{ ok?: boolean; ticket?: DeliveryTicket; detail?: string }>(t) ?? {};
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : t);
      setMsg(`تم تحويل ${tableLabel} إلى دليفري`);
      await loadTickets();
      await loadOpenTables();
      if (j.ticket) openOrdering(j.ticket);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  const intakeKpis = useMemo(
    () => ({
      open: tickets.filter((t) => !["delivered", "cancelled"].includes(String(t.status || ""))).length,
      queue: queue.length,
      tables: openTables.length,
    }),
    [tickets, queue, openTables],
  );

  return (
    <div className="deliv-hub" dir="rtl">
      <header className="deliv-hub__hero">
        <div>
          <p className="deliv-hub__eyebrow">مركز عمليات التوصيل</p>
          <h1>الدليفري والكول سنتر — مكان واحد</h1>
          <p className="deliv-hub__sub">
            واتساب · منصات · تحويل من طاولة · طابور التسليم · بحث ذكي للعملاء
          </p>
        </div>
        <div className="deliv-hub__hero-kpis">
          <div>
            <strong>{intakeKpis.open}</strong>
            <span>تذاكر مفتوحة</span>
          </div>
          <div>
            <strong>{intakeKpis.queue}</strong>
            <span>جاهز للتسليم</span>
          </div>
          <div>
            <strong>{intakeKpis.tables}</strong>
            <span>طاولات حية</span>
          </div>
        </div>
      </header>

      <nav className="deliv-hub__tabs">
        {(
          [
            ["intake", "استقبال سريع"],
            ["tickets", "التذاكر"],
            ["convert", "من طاولة → دليفري"],
            ["queue", "طابور التسليم"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" className={tab === k ? "is-on" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
        <Link className="deliv-hub__side-link" to={roleCallCenterPath(user?.role)}>
          شاشة الطلب الكاملة
        </Link>
        <Link className="deliv-hub__side-link" to={rolePosPath(user?.role)}>
          نقطة البيع
        </Link>
      </nav>

      {msg ? <div className="deliv-hub__msg">{msg}</div> : null}

      {tab === "intake" ? (
        <section className="deliv-hub__panel">
          <div className="deliv-hub__channel-row">
            {(
              [
                ["whatsapp", "واتساب"],
                ["phone", "مكالمة / كول سنتر"],
                ["platform", "منصة (طلباتي/مرسول…)"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" className={channel === k ? "is-on" : ""} onClick={() => setChannel(k)}>
                {label}
              </button>
            ))}
          </div>

          <div className="deliv-hub__search">
            <label>
              بحث ذكي (اسم بأي جزء · هاتف · عنوان · منطقة)
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="مثال: أحمد 010 · أو: المعادي · أو: a+2"
                autoFocus
              />
            </label>
            {searching ? <span className="deliv-hub__hint">بحث…</span> : null}
            {hits.length > 0 ? (
              <ul className="deliv-hub__hits">
                {hits.map((a) => (
                  <li key={a.CardGuide}>
                    <button type="button" onClick={() => pickAgent(a)}>
                      <strong>{a.AgentName}</strong>
                      <span>
                        {a.Phone || a.Mobile || "—"} · {(a.FullAdress || a.Address || "").slice(0, 60)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="deliv-hub__grid">
            <label>
              الاسم *
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              الهاتف 1 *
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" required />
            </label>
            <label>
              الهاتف 2
              <input value={phone2} onChange={(e) => setPhone2(e.target.value)} inputMode="tel" />
            </label>
            <label>
              المنطقة *
              <input value={area} onChange={(e) => setArea(e.target.value)} list="deliv-areas" required />
              <datalist id="deliv-areas">
                {["المعادي", "مدينة نصر", "الزمالك", "المهندسين", "التجمع", "6 أكتوبر", "شبرا", "مصر الجديدة"].map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </label>
            <label className="deliv-hub__span2">
              العنوان
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="شارع / عمارة / علامة مميزة" />
            </label>
            <label>
              موعد التسليم
              <input value={deliveryTime} onChange={(e) => setDeliveryTime(e.target.value)} placeholder="اليوم 8 م · أو فوري" />
            </label>
            <label>
              قيمة الشحن
              <input type="number" min={0} step={0.5} value={shippingFee} onChange={(e) => setShippingFee(e.target.value)} />
            </label>
            <label>
              السائق / الطيار
              <input value={driverName} onChange={(e) => setDriverName(e.target.value)} />
            </label>
            <label className="deliv-hub__check">
              <input type="checkbox" checked={noVat} onChange={(e) => setNoVat(e.target.checked)} />
              بدون ضريبة (طبق ضريبة لا يُطبَّق)
            </label>
          </div>

          {channel === "platform" ? (
            <div className="deliv-hub__grid deliv-hub__platform">
              <label>
                اسم الموقع / المنصة *
                <input value={platformName} onChange={(e) => setPlatformName(e.target.value)} placeholder="طلباتي · مرسول · هنقرستيشن…" />
              </label>
              <label>
                رقم الأوردر على الموقع
                <input value={platformOrderId} onChange={(e) => setPlatformOrderId(e.target.value)} />
              </label>
              <label className="deliv-hub__span2">
                رابط الطلب
                <input value={platformUrl} onChange={(e) => setPlatformUrl(e.target.value)} placeholder="https://…" />
              </label>
            </div>
          ) : null}

          <div className="deliv-hub__grid">
            <label className="deliv-hub__span2">
              المطلوب (نص حر)
              <textarea value={requestedItems} onChange={(e) => setRequestedItems(e.target.value)} rows={3} placeholder="2 برجر + كولا…" />
            </label>
            <label className="deliv-hub__span2">
              مواصفات خاصة
              <textarea value={specialNotes} onChange={(e) => setSpecialNotes(e.target.value)} rows={2} placeholder="بدون بصل · باب الشقة…" />
            </label>
          </div>

          <div className="deliv-hub__attach-row">
            <div
              ref={pasteZoneRef}
              className={`deliv-hub__paste-zone${pasteFlash ? " is-flash" : ""}${shotFile ? " has-shot" : ""}`}
              tabIndex={0}
              role="button"
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f && f.type.startsWith("image/")) applyShotFile(f, "drop");
              }}
            >
              <div className="deliv-hub__paste-copy">
                <strong>صورة محادثة واتساب / سكرين المنصة</strong>
                <span>
                  سكرين من الديسكتوب ثم <kbd>Ctrl</kbd>+<kbd>V</kbd> للصق هنا — أو اسحب الصورة — أو انقر لاختيار ملف
                </span>
                {shotFile ? (
                  <span className="deliv-hub__hint">✓ {shotFile.name}</span>
                ) : (
                  <span className="deliv-hub__hint">مُفضَّل للواتساب والمنصات · يمكن الحفظ بدون صورة</span>
                )}
              </div>
              {shotPreview ? (
                <img src={shotPreview} alt="معاينة سكرين" className="deliv-hub__shot-preview" />
              ) : (
                <div className="deliv-hub__shot-placeholder" aria-hidden>
                  📋
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="deliv-hub__file-hidden"
                onChange={(e) => applyShotFile(e.target.files?.[0] || null, "file")}
              />
            </div>
            {shotFile ? (
              <button type="button" className="btn btn-ghost" onClick={() => applyShotFile(null)}>
                إزالة الصورة
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={captureGps}>
              {gps ? `GPS ✓ ${gps.lat.toFixed(4)},${gps.lng.toFixed(4)}` : "حفظ موقع GPS"}
            </button>
          </div>

          <div className="deliv-hub__actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submitIntake(true)}>
              حفظ وافتح نقطة البيع
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void submitIntake(false)}>
              حفظ التذكرة فقط
            </button>
            {agentGuid ? <span className="deliv-hub__hint">عميل مربوط: {agentGuid.slice(0, 8)}…</span> : null}
          </div>
        </section>
      ) : null}

      {tab === "tickets" ? (
        <section className="deliv-hub__panel">
          <div className="deliv-hub__ticket-list">
            {tickets.length === 0 ? (
              <p className="deliv-hub__empty">لا تذاكر بعد — ابدأ من استقبال سريع.</p>
            ) : (
              tickets.map((t) => (
                <article key={t.id} className="deliv-hub__ticket">
                  <div className="deliv-hub__ticket-top">
                    <strong>{t.customerName}</strong>
                    <span>{CHANNEL_LABEL[String(t.channel || "")] || t.channel}</span>
                    <span className="deliv-hub__pill">{t.status}</span>
                  </div>
                  <div className="deliv-hub__ticket-meta">
                    {t.phone} {t.area ? `· ${t.area}` : ""} {t.shippingFee ? `· شحن ${t.shippingFee}` : ""}
                    {t.noVat ? " · بدون ضريبة" : ""}
                    {t.platformName ? ` · ${t.platformName} #${t.platformOrderId || ""}` : ""}
                  </div>
                  {t.requestedItemsText ? <p>{t.requestedItemsText}</p> : null}
                  <div className="deliv-hub__ticket-actions">
                    <button type="button" className="btn btn-primary" onClick={() => openOrdering(t)}>
                      فتح نقطة البيع
                    </button>
                    {(t.attachments || []).slice(0, 2).map((a) =>
                      a.url ? (
                        <a key={a.fileName || a.url} href={`${base}${a.url}`} target="_blank" rel="noreferrer" className="btn btn-ghost">
                          صورة
                        </a>
                      ) : null,
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      ) : null}

      {tab === "convert" ? (
        <section className="deliv-hub__panel">
          <p className="deliv-hub__sub">سيناريو أ: ضيف على طاولة يريد إرسال الطلب دليفري — حوّل الجلسة وأنشئ تذكرة.</p>
          <div className="deliv-hub__ticket-list">
            {openTables.length === 0 ? (
              <p className="deliv-hub__empty">لا طاولات نشطة حالياً.</p>
            ) : (
              openTables.map((s) => (
                <article key={s.sessionId} className="deliv-hub__ticket">
                  <div className="deliv-hub__ticket-top">
                    <strong>{s.tableDisplayName || "طاولة"}</strong>
                    <span>{s.captainName || "—"}</span>
                    <span>{Number(s.itemsSubtotal || 0).toFixed(0)} ج</span>
                  </div>
                  <div className="deliv-hub__ticket-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || Boolean(s.awaitingPayment)}
                      onClick={() => void convertTable(s.sessionId, s.tableDisplayName || "طاولة")}
                    >
                      حوّل إلى دليفري
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      ) : null}

      {tab === "queue" ? (
        <section className="deliv-hub__panel">
          <div className="deliv-hub__ticket-list">
            {queue.length === 0 ? (
              <p className="deliv-hub__empty">لا طلبات جاهزة للتسليم الآن.</p>
            ) : (
              queue.map((o) => (
                <article key={o.id} className="deliv-hub__ticket">
                  <div className="deliv-hub__ticket-top">
                    <strong>{o.ticketNo != null ? `تذكرة #${o.ticketNo}` : o.id.slice(0, 8)}</strong>
                    <span>{o.status}</span>
                    {o.deliveryTicket?.customerName ? <span>{o.deliveryTicket.customerName}</span> : null}
                  </div>
                  <div className="deliv-hub__ticket-meta">
                    {o.deliveryTicket?.phone || ""} {o.deliveryTicket?.area ? `· ${o.deliveryTicket.area}` : ""}
                    {o.deliveryTicket?.driverName ? `· طيار: ${o.deliveryTicket.driverName}` : ""}
                  </div>
                  <div>
                    {(o.items || []).slice(0, 5).map((it, i) => (
                      <div key={i}>
                        {it.name} ×{it.quantity || 1}
                      </div>
                    ))}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
