import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import { extractMapsUrl, parseCoordsFromMapsUrl } from "../lib/mapsLink";
import { useAuth } from "../auth/AuthContext";
import { sessionDisplayName } from "../auth/displayUser";
import "../styles/deliveryOpsHub.css";

type ShippingService = {
  CardGuide: string;
  ProductName: string;
  Price: number;
  GroupGuid?: string;
};

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
  shippingMode?: "service_item" | "fee" | string;
  shippingProductGuide?: string;
  shippingProductName?: string;
  noVat?: boolean;
  paymentMode?: "cod" | "prepaid" | "partial" | string;
  prepaidAmount?: number;
  prepaidMethod?: string;
  prepaidNote?: string;
  prepaidAt?: string;
  driverName?: string;
  platformName?: string;
  platformOrderId?: string;
  platformUrl?: string;
  mapsUrl?: string;
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
  pos: "طلب توصيل",
};

/** نقطة طلب الدليفري المستقلة (منيو + شحن + بيانات العميل) — ليست شاشة جرسون الطاولات. */
function roleDeliveryOrderPath(role?: string) {
  const r = String(role || "cashier");
  if (r === "manager" || r === "operation_manager" || r === "developer") return `/app/${r}/delivery-order`;
  if (r === "accountant") return `/app/accountant/delivery-order`;
  return "/app/cashier/delivery-order";
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
  const [shippingMode, setShippingMode] = useState<"service_item" | "fee">("service_item");
  const [shippingProductGuide, setShippingProductGuide] = useState("");
  const [shippingProductName, setShippingProductName] = useState("");
  const [shippingServices, setShippingServices] = useState<ShippingService[]>([]);
  const [shippingGroupName, setShippingGroupName] = useState("خدمات الشحن");
  const [shippingHint, setShippingHint] = useState("");
  const [paymentMode, setPaymentMode] = useState<"cod" | "prepaid" | "partial">("cod");
  const [prepaidAmount, setPrepaidAmount] = useState("0");
  const [prepaidMethod, setPrepaidMethod] = useState<"cash" | "card" | "digital" | "transfer">("cash");
  const [prepaidNote, setPrepaidNote] = useState("");
  const [noVat, setNoVat] = useState(true);
  const [driverName, setDriverName] = useState("");
  const [platformName, setPlatformName] = useState("");
  const [platformOrderId, setPlatformOrderId] = useState("");
  const [platformUrl, setPlatformUrl] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [mapsFlash, setMapsFlash] = useState(false);
  const [agentGuid, setAgentGuid] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [shotFiles, setShotFiles] = useState<File[]>([]);
  const [shotPreviews, setShotPreviews] = useState<string[]>([]);
  const [pasteFlash, setPasteFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tickets, setTickets] = useState<DeliveryTicket[]>([]);
  const [queue, setQueue] = useState<QueueOrder[]>([]);
  const [openTables, setOpenTables] = useState<OpenTable[]>([]);
  const searchTimer = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pasteZoneRef = useRef<HTMLDivElement | null>(null);
  const mapsInputRef = useRef<HTMLInputElement | null>(null);

  const clearShotFiles = useCallback(() => {
    setShotPreviews((prev) => {
      for (const u of prev) URL.revokeObjectURL(u);
      return [];
    });
    setShotFiles([]);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const addShotFiles = useCallback((incoming: File[], source: "file" | "paste" | "drop" = "file") => {
    const images = incoming.filter((f) => String(f.type || "").startsWith("image/"));
    if (!images.length) return;
    setShotFiles((prev) => [...prev, ...images].slice(0, 8));
    setShotPreviews((prev) => {
      const urls = images.map((f) => URL.createObjectURL(f));
      return [...prev, ...urls].slice(0, 8);
    });
    const label =
      source === "paste"
        ? `تم لصق ${images.length} صورة ✓`
        : source === "drop"
          ? `تم إسقاط ${images.length} صورة ✓`
          : `تم إرفاق ${images.length} صورة ✓`;
    setMsg(label);
    setPasteFlash(true);
    window.setTimeout(() => setPasteFlash(false), 900);
  }, []);

  const applyMapsUrl = useCallback(
    async (raw: string, source: "paste" | "input" = "input") => {
      const found = extractMapsUrl(raw) || (raw.trim().startsWith("http") ? extractMapsUrl(raw.trim()) : null);
      if (!found) {
        if (source === "paste") setMsg("لم يُعثر على رابط خرائط صالح في النص الملصوق");
        return false;
      }
      setMapsUrl(found);
      setMapsFlash(true);
      window.setTimeout(() => setMapsFlash(false), 900);

      const local = parseCoordsFromMapsUrl(found);
      if (local) {
        setGps({ lat: local.lat, lng: local.lng });
        setMsg(
          source === "paste"
            ? `تم لصق رابط الخرائط ✓ (${local.lat.toFixed(5)}, ${local.lng.toFixed(5)})`
            : `رابط الخرائط + إحداثيات ✓`,
        );
        return true;
      }

      setMsg(source === "paste" ? "تم لصق رابط الخرائط… جاري استخراج الموقع" : "جاري استخراج الموقع من الرابط…");
      try {
        const r = await fetch(`${base}/api/restaurant/delivery/resolve-maps-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: found }),
        });
        const t = await r.text();
        const j =
          tryParseJson<{
            ok?: boolean;
            mapsUrl?: string;
            resolvedUrl?: string;
            gps?: { lat?: number; lng?: number } | null;
            detail?: string;
            warning?: string;
          }>(t) ?? {};
        if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : t);
        if (j.mapsUrl) setMapsUrl(j.mapsUrl);
        if (j.gps && j.gps.lat != null && j.gps.lng != null) {
          setGps({ lat: Number(j.gps.lat), lng: Number(j.gps.lng) });
          setMsg(`تم ربط الموقع من الخرائط ✓ (${Number(j.gps.lat).toFixed(5)}, ${Number(j.gps.lng).toFixed(5)})`);
        } else {
          setMsg(j.warning ? `رابط الخرائط محفوظ — ${j.warning}` : "رابط الخرائط محفوظ (افتحه للطيار)");
        }
      } catch (e) {
        setMsg(`رابط الخرائط محفوظ — تعذر استخراج الإحداثيات (${String(e)})`);
      }
      return true;
    },
    [base],
  );

  useEffect(() => {
    return () => {
      for (const u of shotPreviews) URL.revokeObjectURL(u);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revoke only on unmount
  }, []);

  /** Ctrl+V: صور واتساب (واحدة أو أكثر) أو رابط خرائط أثناء تبويب الاستقبال. */
  useEffect(() => {
    if (tab !== "intake") return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      const imageFiles: File[] = [];
      if (items?.length) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (!item || !String(item.type || "").startsWith("image/")) continue;
          const blob = item.getAsFile();
          if (!blob) continue;
          const ext = item.type.includes("jpeg") || item.type.includes("jpg") ? "jpg" : "png";
          imageFiles.push(
            new File([blob], `whatsapp-paste-${Date.now()}-${i}.${ext}`, {
              type: blob.type || "image/png",
            }),
          );
        }
      }
      if (imageFiles.length) {
        e.preventDefault();
        addShotFiles(imageFiles, "paste");
        return;
      }
      const text = e.clipboardData?.getData("text/plain") || e.clipboardData?.getData("text") || "";
      const maps = extractMapsUrl(text);
      if (!maps) return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const inField = tag === "input" || tag === "textarea";
      if (!inField) e.preventDefault();
      void applyMapsUrl(maps, "paste");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [tab, addShotFiles, applyMapsUrl]);

  const loadShippingServices = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/restaurant/delivery/shipping-services`, { cache: "no-store" });
      const j =
        tryParseJson<{
          services?: ShippingService[];
          groupName?: string;
          hint?: string | null;
        }>(await r.text()) ?? {};
      setShippingServices(Array.isArray(j.services) ? j.services : []);
      if (j.groupName) setShippingGroupName(String(j.groupName));
      setShippingHint(String(j.hint || ""));
    } catch {
      setShippingServices([]);
      setShippingHint("تعذر تحميل خدمات الشحن من القاعدة");
    }
  }, [base]);

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
    void loadShippingServices();
    const id = window.setInterval(() => {
      void loadTickets();
      void loadQueue();
      void loadOpenTables();
    }, 20000);
    return () => window.clearInterval(id);
  }, [loadTickets, loadQueue, loadOpenTables, loadShippingServices]);

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
    if (ticket.shippingMode) qs.set("shippingMode", String(ticket.shippingMode));
    if (ticket.shippingProductGuide) qs.set("shippingProductGuide", String(ticket.shippingProductGuide));
    if (ticket.shippingProductName) qs.set("shippingProductName", String(ticket.shippingProductName));
    if (ticket.noVat) qs.set("noVat", "1");
    if (ticket.paymentMode) qs.set("paymentMode", String(ticket.paymentMode));
    if (ticket.prepaidAmount != null && Number(ticket.prepaidAmount) > 0) qs.set("prepaidAmount", String(ticket.prepaidAmount));
    if (ticket.prepaidMethod) qs.set("prepaidMethod", String(ticket.prepaidMethod));
    if (ticket.prepaidNote) qs.set("prepaidNote", String(ticket.prepaidNote));
    if (ticket.driverName) qs.set("driverName", ticket.driverName);
    if (ticket.phone) qs.set("phone", ticket.phone);
    if (ticket.customerName) qs.set("name", ticket.customerName);
    if (ticket.fullAddress || ticket.address) qs.set("address", ticket.fullAddress || ticket.address || "");
    navigate(`${roleDeliveryOrderPath(user?.role)}?${qs.toString()}`);
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
          shippingMode: shippingProductGuide ? "service_item" : shippingMode,
          shippingProductGuide: shippingProductGuide || undefined,
          shippingProductName: shippingProductName || undefined,
          noVat,
          paymentMode,
          prepaidAmount: Number(prepaidAmount) || 0,
          prepaidMethod: Number(prepaidAmount) > 0 ? prepaidMethod : undefined,
          prepaidNote: prepaidNote.trim() || undefined,
          driverName: driverName.trim() || undefined,
          platformName: channel === "platform" ? platformName.trim() : undefined,
          platformOrderId: channel === "platform" ? platformOrderId.trim() : undefined,
          platformUrl: channel === "platform" ? platformUrl.trim() : undefined,
          mapsUrl: mapsUrl.trim() || undefined,
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
      if (ticket?.id && shotFiles.length) {
        for (const file of shotFiles) {
          const fd = new FormData();
          fd.append("file", file);
          await fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(ticket.id)}/attachment`, {
            method: "POST",
            body: fd,
          });
        }
      }

      setMsg("تم تسجيل الاستقبال بنجاح");
      clearShotFiles();
      setMapsUrl("");
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
          <h1>الدليفري والكول سنتر</h1>
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
            ["intake", "استقبال سريع", "tone-intake"],
            ["tickets", "التذاكر", "tone-tickets"],
            ["convert", "من طاولة → دليفري", "tone-convert"],
            ["queue", "طابور التسليم", "tone-queue"],
          ] as const
        ).map(([k, label, tone]) => (
          <button
            key={k}
            type="button"
            className={`deliv-hub__tab ${tone}${tab === k ? " is-on" : ""}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
        <Link className="deliv-hub__side-link tone-order" to={roleDeliveryOrderPath(user?.role)}>
          شاشة طلب التوصيل
        </Link>
      </nav>

      {msg ? <div className="deliv-hub__msg">{msg}</div> : null}

      {tab === "intake" ? (
        <section className="deliv-hub__panel">
          <div className="deliv-hub__channel-row">
            {(
              [
                ["whatsapp", "واتساب", "tone-wa"],
                ["phone", "مكالمة / كول سنتر", "tone-phone"],
                ["platform", "منصة (طلباتي/مرسول…)", "tone-platform"],
              ] as const
            ).map(([k, label, tone]) => (
              <button
                key={k}
                type="button"
                className={`deliv-hub__channel ${tone}${channel === k ? " is-on" : ""}`}
                onClick={() => setChannel(k)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="deliv-hub__search deliv-hub__search--hero">
            <div className="deliv-hub__search-bar">
              <span className="deliv-hub__search-icon" aria-hidden>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.2" />
                  <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="بحث عميل: الاسم · الهاتف · العنوان — مثال: مازن محمد يسري"
                autoFocus
                aria-label="بحث العملاء"
              />
              {searching ? <span className="deliv-hub__hint">بحث…</span> : null}
            </div>
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
            <label className="deliv-hub__span2">
              خدمة الشحن (من مجموعة «{shippingGroupName}» — TBL006/007)
              <select
                value={shippingProductGuide}
                onChange={(e) => {
                  const gid = e.target.value;
                  setShippingProductGuide(gid);
                  const hit = shippingServices.find((s) => s.CardGuide === gid);
                  if (hit) {
                    setShippingProductName(hit.ProductName);
                    setShippingFee(String(hit.Price));
                    setShippingMode("service_item");
                  } else {
                    setShippingProductName("");
                  }
                }}
              >
                <option value="">— اختر منطقة/خدمة شحن —</option>
                {shippingServices.map((s) => (
                  <option key={s.CardGuide} value={s.CardGuide}>
                    {s.ProductName} — {Number(s.Price || 0).toFixed(2)}
                  </option>
                ))}
              </select>
              {shippingHint ? <span className="deliv-hub__hint">{shippingHint}</span> : null}
            </label>
            <label>
              قيمة الشحن
              <input
                type="number"
                min={0}
                step={0.5}
                value={shippingFee}
                onChange={(e) => {
                  setShippingFee(e.target.value);
                  // تعديل يدوي للسعر مع الإبقاء على الصنف المختار
                }}
              />
            </label>
            <label>
              الشحن كـ
              <select
                value={shippingProductGuide ? "service_item" : shippingMode}
                disabled={Boolean(shippingProductGuide)}
                onChange={(e) => setShippingMode(e.target.value as "service_item" | "fee")}
              >
                <option value="service_item">صنف خدمة توصيل (يظهر في الفاتورة)</option>
                <option value="fee">رسوم فقط على الإجمالي</option>
              </select>
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

          <div className="deliv-hub__grid deliv-hub__prepaid">
            <label>
              التحصيل
              <select
                value={paymentMode}
                onChange={(e) => {
                  const v = e.target.value as "cod" | "prepaid" | "partial";
                  setPaymentMode(v);
                  if (v === "cod") setPrepaidAmount("0");
                }}
              >
                <option value="cod">تحصيل عند التسليم (COD)</option>
                <option value="prepaid">مدفوع مسبقاً بالكامل</option>
                <option value="partial">عهدة / دفعة جزئية مسبقاً</option>
              </select>
            </label>
            <label>
              مبلغ مسبق
              <input
                type="number"
                min={0}
                step={0.5}
                value={prepaidAmount}
                disabled={paymentMode === "cod"}
                onChange={(e) => {
                  setPrepaidAmount(e.target.value);
                  const n = Number(e.target.value) || 0;
                  if (n > 0 && paymentMode === "cod") setPaymentMode("partial");
                }}
              />
            </label>
            <label>
              وسيلة المسبق
              <select
                value={prepaidMethod}
                disabled={paymentMode === "cod" || !(Number(prepaidAmount) > 0)}
                onChange={(e) => setPrepaidMethod(e.target.value as typeof prepaidMethod)}
              >
                <option value="cash">نقدي</option>
                <option value="card">بطاقة</option>
                <option value="digital">تحويل / محفظة</option>
                <option value="transfer">تحويل بنكي</option>
              </select>
            </label>
            <label className="deliv-hub__span2">
              ملاحظة الدفع المسبق
              <input
                value={prepaidNote}
                disabled={paymentMode === "cod"}
                onChange={(e) => setPrepaidNote(e.target.value)}
                placeholder="مثال: فودافون كاش · تحويل · كارت …"
              />
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
              className={`deliv-hub__paste-zone${pasteFlash ? " is-flash" : ""}${shotFiles.length ? " has-shot" : ""}`}
              tabIndex={0}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const list = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith("image/"));
                if (list.length) addShotFiles(list, "drop");
              }}
            >
              <div className="deliv-hub__paste-copy">
                <strong>صورة محادثة واتساب / سكرين المنصة</strong>
                <span>
                  الصق هنا بـ <kbd>Ctrl</kbd>+<kbd>V</kbd> (صورة أو أكثر) أو اسحب الصور إلى هذه المساحة
                </span>
                {shotFiles.length ? (
                  <span className="deliv-hub__hint">✓ {shotFiles.length} صورة جاهزة للإرفاق</span>
                ) : (
                  <span className="deliv-hub__hint">مُفضَّل للواتساب والمنصات · يمكن الحفظ بدون صورة</span>
                )}
                <button
                  type="button"
                  className="btn deliv-hub__attach-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileRef.current?.click();
                  }}
                >
                  📎 أرفق من الجهاز
                </button>
              </div>
              <div className="deliv-hub__shot-thumbs">
                {shotPreviews.length ? (
                  shotPreviews.map((src, i) => <img key={`${src}-${i}`} src={src} alt={`معاينة ${i + 1}`} className="deliv-hub__shot-preview" />)
                ) : (
                  <div className="deliv-hub__shot-placeholder" aria-hidden>
                    📋
                  </div>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                className="deliv-hub__file-hidden"
                onChange={(e) => {
                  const list = Array.from(e.target.files || []);
                  if (list.length) addShotFiles(list, "file");
                  e.target.value = "";
                }}
              />
            </div>
            {shotFiles.length ? (
              <button type="button" className="btn btn-ghost" onClick={() => clearShotFiles()}>
                إزالة الصور
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={captureGps}>
              {gps ? `GPS ✓ ${gps.lat.toFixed(4)},${gps.lng.toFixed(4)}` : "حفظ موقع GPS للجهاز"}
            </button>
          </div>

          <div className={`deliv-hub__maps-zone${mapsFlash ? " is-flash" : ""}${mapsUrl ? " has-maps" : ""}`}>
            <div className="deliv-hub__paste-copy">
              <strong>موقع التوصيل — رابط خرائط جوجل</strong>
              <span>
                من نفس جهاز الكاشير: افتح الخرائط → مشاركة → انسخ الرابط ثم <kbd>Ctrl</kbd>+<kbd>V</kbd>
                {" "}(مثال: maps.app.goo.gl/…)
              </span>
            </div>
            <div className="deliv-hub__maps-row">
              <input
                ref={mapsInputRef}
                value={mapsUrl}
                onChange={(e) => setMapsUrl(e.target.value)}
                onPaste={(e) => {
                  const text = e.clipboardData.getData("text/plain") || "";
                  if (extractMapsUrl(text)) {
                    e.preventDefault();
                    void applyMapsUrl(text, "paste");
                  }
                }}
                onBlur={() => {
                  if (mapsUrl.trim()) void applyMapsUrl(mapsUrl, "input");
                }}
                placeholder="https://maps.app.goo.gl/…"
                inputMode="url"
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={!mapsUrl.trim() || busy}
                onClick={() => void applyMapsUrl(mapsUrl, "input")}
              >
                ربط الموقع
              </button>
              {mapsUrl ? (
                <a className="btn btn-ghost" href={mapsUrl} target="_blank" rel="noreferrer">
                  فتح
                </a>
              ) : null}
              {mapsUrl ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setMapsUrl("");
                    setMsg("أُزيل رابط الخرائط");
                  }}
                >
                  إزالة
                </button>
              ) : null}
            </div>
            {gps ? (
              <span className="deliv-hub__hint">
                إحداثيات محفوظة: {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
              </span>
            ) : (
              <span className="deliv-hub__hint">الصق الرابط المختصر أو الكامل — يُحفظ مع التذكرة للطيار</span>
            )}
          </div>

          <div className="deliv-hub__actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submitIntake(true)}>
              حفظ وافتح شاشة الطلب
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
                    {t.phone} {t.area ? `· ${t.area}` : ""}{" "}
                    {t.shippingProductName
                      ? `· ${t.shippingProductName} ${t.shippingFee != null ? `(${t.shippingFee})` : ""}`
                      : t.shippingFee
                        ? `· شحن ${t.shippingFee}`
                        : ""}
                    {t.noVat ? " · بدون ضريبة" : ""}
                    {t.platformName ? ` · ${t.platformName} #${t.platformOrderId || ""}` : ""}
                    {t.mapsUrl ? " · خرائط ✓" : ""}
                    {Number(t.prepaidAmount || 0) > 0
                      ? ` · مسبق ${Number(t.prepaidAmount).toFixed(0)} (${t.paymentMode || "prepaid"})`
                      : t.paymentMode === "cod"
                        ? " · COD"
                        : ""}
                    {t.gps?.lat != null && t.gps?.lng != null ? ` · GPS ${Number(t.gps.lat).toFixed(4)},${Number(t.gps.lng).toFixed(4)}` : ""}
                  </div>
                  {t.requestedItemsText ? <p>{t.requestedItemsText}</p> : null}
                  <div className="deliv-hub__ticket-actions">
                    <button type="button" className="btn btn-primary" onClick={() => openOrdering(t)}>
                      فتح شاشة الطلب
                    </button>
                    {t.mapsUrl ? (
                      <a href={t.mapsUrl} target="_blank" rel="noreferrer" className="btn btn-ghost">
                        خرائط
                      </a>
                    ) : null}
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
                    {Number(o.deliveryTicket?.prepaidAmount || 0) > 0
                      ? ` · مسبق ${Number(o.deliveryTicket?.prepaidAmount).toFixed(0)}`
                      : o.deliveryTicket?.paymentMode === "cod"
                        ? " · COD"
                        : ""}
                  </div>
                  <div className="deliv-hub__ticket-actions">
                    {o.deliveryTicket?.mapsUrl ? (
                      <a href={o.deliveryTicket.mapsUrl} target="_blank" rel="noreferrer" className="btn btn-ghost">
                        خرائط
                      </a>
                    ) : null}
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
