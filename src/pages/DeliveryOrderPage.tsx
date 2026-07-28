import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import SmartProductSearch from "../components/SmartProductSearch";
import "../styles/deliveryOrderPage.css";

type AgentHit = {
  CardGuide: string;
  AgentName: string;
  Phone?: string;
  Mobile?: string;
  Phone2?: string;
  Address?: string;
  FullAdress?: string;
};

type Product = { CardGuide: string; ProductName: string; Price: number };
type FavItem = Product & { qtyOrdered?: number; invoiceCount?: number; lastOrderedAt?: string | null };
type CartLine = {
  id: string;
  productGuide: string;
  name: string;
  qty: number;
  unitPrice: number;
  note?: string;
};
type ShipSvc = { CardGuide: string; ProductName: string; Price: number; NotTaxable?: boolean };
type Ticket = {
  id: string;
  ticketNo?: number;
  status?: string;
  channel?: string;
  customerName?: string;
  phone?: string;
  area?: string;
  address?: string;
  fullAddress?: string;
  agentGuid?: string;
  shippingFee?: number;
  shippingMode?: string;
  shippingProductGuide?: string;
  shippingProductName?: string;
  noVat?: boolean;
  paymentMode?: string;
  prepaidAmount?: number;
  prepaidMethod?: string;
  deliveryTime?: string;
  driverName?: string;
  requestedItemsText?: string;
  specialNotes?: string;
  quoteLines?: CartLine[];
  quoteTotals?: { itemsSubtotal?: number; shippingFee?: number; vat?: number; total?: number };
  quoteText?: string;
  quoteVersion?: number;
  attachments?: Array<{ url?: string; fileName?: string }>;
};

const STATUS_LABEL: Record<string, string> = {
  intake: "???????",
  draft_quote: "????? ??????",
  quoted: "?????? ??????",
  confirmed: "?????",
  ordering: "???",
  kitchen: "?? ??????",
  ready: "???? ? ???? ??????",
  out_for_delivery: "??? ???????",
  delivered: "?? ???????",
  settled: "??????",
  cancelled: "????",
};

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "??????",
  phone: "????? / ??? ????",
  platform: "???? / ????",
  table_convert: "????? ?? ?????",
  pos: "??? ?????",
};

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toNum(v: unknown, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function isLockedStatus(st?: string) {
  const s = String(st || "").toLowerCase();
  return ["kitchen", "ready", "out_for_delivery", "delivered", "settled", "cancelled"].includes(s);
}

/** ???? ??? ?????? ? ?????? ?????? ?? ????? ?????? (???? ???? ????? ????????). */
export default function DeliveryOrderPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const base = getApiBase();
  const role = String(user?.role || "cashier");
  const backTo = useMemo(() => `/app/${role}/delivery-hub`, [role]);

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [channel, setChannel] = useState("whatsapp");

  const [searchQ, setSearchQ] = useState("");
  const [hits, setHits] = useState<AgentHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<number | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  const [agentGuid, setAgentGuid] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [area, setArea] = useState("");
  const [deliveryTime, setDeliveryTime] = useState("");
  const [driverName, setDriverName] = useState("");
  const [requestedItemsText, setRequestedItemsText] = useState("");
  const [noVat, setNoVat] = useState(true);
  const [shippingFee, setShippingFee] = useState(0);
  const [shippingMode, setShippingMode] = useState<"service_item" | "fee">("service_item");
  const [shippingProductGuide, setShippingProductGuide] = useState("");
  const [shippingProductName, setShippingProductName] = useState("");
  const [shippingServices, setShippingServices] = useState<ShipSvc[]>([]);
  const [shippingGroupName, setShippingGroupName] = useState("????? ?????");
  const [prepaidAmount, setPrepaidAmount] = useState(0);
  const [prepaidMethod, setPrepaidMethod] = useState("cash");
  const [paymentMode, setPaymentMode] = useState<"cod" | "prepaid" | "partial">("cod");
  const [payment, setPayment] = useState("cash");

  const [catalogTab, setCatalogTab] = useState<"menu" | "favorites">("menu");
  const [products, setProducts] = useState<Product[]>([]);
  const [favorites, setFavorites] = useState<FavItem[]>([]);
  const [favHint, setFavHint] = useState<string | null>(null);
  const [productFilter, setProductFilter] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [quoteText, setQuoteText] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const locked = isLockedStatus(ticket?.status);

  const hydrateFromTicket = useCallback((t: Ticket) => {
    setTicket(t);
    setChannel(String(t.channel || "whatsapp"));
    if (t.agentGuid) setAgentGuid(t.agentGuid);
    if (t.customerName) {
      setName(t.customerName);
      setSearchQ(t.customerName);
    }
    if (t.phone) setPhone(t.phone);
    if (t.fullAddress || t.address) setAddress(t.fullAddress || t.address || "");
    if (t.area) setArea(t.area);
    if (t.deliveryTime) setDeliveryTime(t.deliveryTime);
    if (t.driverName) setDriverName(t.driverName);
    if (t.requestedItemsText) setRequestedItemsText(t.requestedItemsText);
    if (t.shippingFee != null) setShippingFee(toNum(t.shippingFee, 0));
    if (t.shippingMode === "fee" || t.shippingMode === "service_item") {
      setShippingMode(t.shippingMode);
    }
    if (t.shippingProductGuide) setShippingProductGuide(t.shippingProductGuide);
    if (t.shippingProductName) setShippingProductName(t.shippingProductName);
    if (t.noVat === false) setNoVat(false);
    else setNoVat(true);
    if (t.prepaidAmount != null) setPrepaidAmount(toNum(t.prepaidAmount, 0));
    if (t.prepaidMethod) setPrepaidMethod(String(t.prepaidMethod));
    if (t.paymentMode === "prepaid" || t.paymentMode === "partial" || t.paymentMode === "cod") {
      setPaymentMode(t.paymentMode);
    }
    if (Array.isArray(t.quoteLines) && t.quoteLines.length) {
      setCart(
        t.quoteLines.map((l) => ({
          id: String(l.id || uid()),
          productGuide: String(l.productGuide || ""),
          name: String(l.name || "???"),
          qty: toNum(l.qty, 1),
          unitPrice: toNum(l.unitPrice, 0),
          note: l.note || "",
        })),
      );
    }
    if (t.quoteText) setQuoteText(t.quoteText);
  }, []);

  // hydrate from hub query + load ticket
  useEffect(() => {
    const tid = String(params.get("deliveryTicketId") || "").trim();
    const ag = String(params.get("agentGuid") || "").trim();
    const n = String(params.get("name") || "").trim();
    const ph = String(params.get("phone") || "").trim();
    const ad = String(params.get("address") || "").trim();
    if (ag) setAgentGuid(ag);
    if (n) {
      setName(n);
      setSearchQ(n);
    }
    if (ph) {
      setPhone(ph);
      if (!n) setSearchQ(ph);
    }
    if (ad) setAddress(ad);
    if (params.get("deliveryTime")) setDeliveryTime(String(params.get("deliveryTime")));
    if (params.get("driverName")) setDriverName(String(params.get("driverName")));
    if (params.get("shippingFee")) setShippingFee(toNum(params.get("shippingFee"), 0));
    if (params.get("shippingMode") === "fee" || params.get("shippingMode") === "service_item") {
      setShippingMode(params.get("shippingMode") as "fee" | "service_item");
    }
    if (params.get("shippingProductGuide")) setShippingProductGuide(String(params.get("shippingProductGuide")));
    if (params.get("shippingProductName")) setShippingProductName(String(params.get("shippingProductName")));
    if (params.get("noVat") === "0") setNoVat(false);
    if (params.get("prepaidAmount")) setPrepaidAmount(toNum(params.get("prepaidAmount"), 0));
    if (params.get("prepaidMethod")) setPrepaidMethod(String(params.get("prepaidMethod")));
    if (params.get("paymentMode") === "prepaid" || params.get("paymentMode") === "partial" || params.get("paymentMode") === "cod") {
      setPaymentMode(params.get("paymentMode") as "cod" | "prepaid" | "partial");
    }
    if (params.get("channel")) setChannel(String(params.get("channel")));
    if (params.get("requestedItems")) setRequestedItemsText(String(params.get("requestedItems")));

    if (!tid) return;
    void (async () => {
      try {
        const r = await fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(tid)}`, { cache: "no-store" });
        const j = tryParseJson<{ ticket?: Ticket; detail?: string }>(await r.text()) ?? {};
        if (r.ok && j.ticket) hydrateFromTicket(j.ticket);
      } catch {
        setMsg("???? ????? ???????");
      }
    })();
  }, [params, base, hydrateFromTicket]);

  useEffect(() => {
    void (async () => {
      try {
        const [pr, sh] = await Promise.all([
          fetch(`${base}/api/products`),
          fetch(`${base}/api/restaurant/delivery/shipping-services`),
        ]);
        const pj = tryParseJson<{ products?: Product[] }>(await pr.text()) ?? {};
        const shj = tryParseJson<{ services?: ShipSvc[]; groupName?: string }>(await sh.text()) ?? {};
        setProducts(Array.isArray(pj.products) ? pj.products : []);
        setShippingServices(Array.isArray(shj.services) ? shj.services : []);
        if (shj.groupName) setShippingGroupName(String(shj.groupName));
      } catch {
        setMsg("???? ????? ?????? ?? ????? ?????");
      }
    })();
  }, [base]);

  const loadFavorites = useCallback(
    async (guid: string) => {
      if (!guid) {
        setFavorites([]);
        setFavHint("???? ?????? ???? ??????? ??????? ?? ??????? ???????");
        return;
      }
      try {
        const r = await fetch(
          `${base}/api/restaurant/delivery/customer-favorites?agent_guide=${encodeURIComponent(guid)}&limit=40`,
        );
        const j = tryParseJson<{ favorites?: FavItem[]; hint?: string }>(await r.text()) ?? {};
        setFavorites(Array.isArray(j.favorites) ? j.favorites : []);
        setFavHint(j.hint || null);
      } catch {
        setFavorites([]);
        setFavHint("???? ??? ??????? ???????");
      }
    },
    [base],
  );

  useEffect(() => {
    void loadFavorites(agentGuid);
  }, [agentGuid, loadFavorites]);

  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const text = searchQ.trim();
    if (text.length < 2) {
      setHits([]);
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        try {
          const r = await fetch(`${base}/api/agents/search?search_text=${encodeURIComponent(text)}`);
          const j = tryParseJson<{ agents?: AgentHit[]; detail?: string }>(await r.text()) ?? {};
          if (!r.ok) {
            setHits([]);
            setMsg(typeof j.detail === "string" ? j.detail : "??? ??? ???????");
            return;
          }
          setHits(Array.isArray(j.agents) ? j.agents.slice(0, 14) : []);
        } catch {
          setHits([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 200);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [searchQ, base]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!searchWrapRef.current?.contains(e.target as Node)) setHits([]);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pickAgent(a: AgentHit) {
    setAgentGuid(a.CardGuide);
    setName(String(a.AgentName || ""));
    setPhone(String(a.Phone || a.Mobile || ""));
    setAddress(String(a.FullAdress || a.Address || ""));
    setSearchQ(String(a.AgentName || ""));
    setHits([]);
    setCatalogTab("favorites");
    setMsg(`?? ????? ?????? ??????: ${a.AgentName}`);
  }

  async function ensureCustomerSaved(): Promise<string> {
    if (!name.trim() || !phone.trim()) {
      throw new Error("????? ??? ?????? ???? ??????");
    }
    const upsert = await fetch(`${base}/api/agents/delivery-upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        AgentName: name.trim(),
        Phone: phone.trim(),
        Mobile: phone.trim(),
        FullAdress: address.trim(),
      }),
    });
    const ujText = await upsert.text();
    const uj = tryParseJson<{ success?: boolean; detail?: string; CardGuide?: string }>(ujText);
    if (!upsert.ok || !uj?.success) throw new Error(uj?.detail || ujText || "???? ??? ?????? ?? TBL016");
    const g = String(uj.CardGuide || "").trim();
    setAgentGuid(g);
    return g;
  }

  async function ensureTicket(): Promise<string> {
    if (ticket?.id) return ticket.id;
    const agentGuide = await ensureCustomerSaved();
    const zone = area.trim() || shippingProductName.trim() || "??? ?????";
    const r = await fetch(`${base}/api/restaurant/delivery/intake`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        phone: phone.trim(),
        area: zone,
        address: address.trim(),
        channel,
        shippingFee,
        shippingMode,
        shippingProductGuide: shippingProductGuide || undefined,
        shippingProductName: shippingProductName || undefined,
        noVat,
        paymentMode,
        prepaidAmount: prepaidAmount > 0 ? prepaidAmount : undefined,
        prepaidMethod: prepaidAmount > 0 ? prepaidMethod : undefined,
        deliveryTime: deliveryTime || undefined,
        driverName: driverName || undefined,
        requestedItems: requestedItemsText || undefined,
        agentGuid: agentGuide,
      }),
    });
    const j = tryParseJson<{ ticket?: Ticket; detail?: string }>(await r.text()) ?? {};
    if (!r.ok || !j.ticket?.id) throw new Error(typeof j.detail === "string" ? j.detail : "???? ????? ?????");
    hydrateFromTicket(j.ticket);
    return j.ticket.id;
  }

  function addProduct(p: { CardGuide: string; ProductName: string; Price?: number }) {
    if (locked) return;
    const price = toNum(p.Price, 0);
    setCart((prev) => {
      const ex = prev.find((x) => x.productGuide === p.CardGuide && !x.note);
      if (ex) return prev.map((x) => (x.id === ex.id ? { ...x, qty: x.qty + 1 } : x));
      return [
        ...prev,
        {
          id: uid(),
          productGuide: p.CardGuide,
          name: p.ProductName,
          qty: 1,
          unitPrice: price,
        },
      ];
    });
  }

  function setQty(lineId: string, qty: number) {
    if (locked) return;
    setCart((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, qty: qty > 0 ? qty : 0 } : l)).filter((l) => l.qty > 0),
    );
  }

  function setLineNote(lineId: string, note: string) {
    if (locked) return;
    setCart((prev) => prev.map((l) => (l.id === lineId ? { ...l, note } : l)));
  }

  function setLinePrice(lineId: string, unitPrice: number) {
    if (locked) return;
    setCart((prev) => prev.map((l) => (l.id === lineId ? { ...l, unitPrice: Math.max(0, unitPrice) } : l)));
  }

  const itemsSubtotal = useMemo(
    () => cart.reduce((s, l) => s + l.qty * l.unitPrice, 0),
    [cart],
  );
  const shipAdd = shippingMode === "fee" ? shippingFee : shippingFee;
  const total = itemsSubtotal + (shipAdd > 0 ? shipAdd : 0);
  const balanceDue = Math.max(0, Math.round((total - prepaidAmount) * 100) / 100);

  const menuList = useMemo(() => {
    const t = productFilter.trim().toLowerCase();
    if (!t) return products.slice(0, 80);
    return products.filter((p) => p.ProductName.toLowerCase().includes(t)).slice(0, 80);
  }, [products, productFilter]);

  function quotePayload(markSent: boolean) {
    return {
      lines: cart.map((l) => ({
        id: l.id,
        productGuide: l.productGuide,
        name: l.name,
        qty: l.qty,
        unitPrice: l.unitPrice,
        note: l.note || undefined,
      })),
      shippingFee,
      shippingMode,
      shippingProductGuide: shippingProductGuide || undefined,
      shippingProductName: shippingProductName || undefined,
      noVat,
      paymentMode,
      prepaidAmount: prepaidAmount > 0 ? prepaidAmount : 0,
      prepaidMethod: prepaidAmount > 0 ? prepaidMethod : undefined,
      deliveryTime: deliveryTime || undefined,
      driverName: driverName || undefined,
      customerName: name.trim(),
      phone: phone.trim(),
      area: area.trim() || undefined,
      address: address.trim(),
      fullAddress: address.trim(),
      agentGuid: agentGuid || undefined,
      requestedItemsText: requestedItemsText || undefined,
      markSent,
    };
  }

  async function saveQuote(markSent: boolean) {
    setMsg("");
    if (!cart.length && !(shippingFee > 0)) {
      setMsg("??? ??????? ?? ??? ??? ??? ????????");
      return;
    }
    setBusy(true);
    try {
      await ensureCustomerSaved();
      const tid = await ensureTicket();
      const r = await fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(tid)}/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quotePayload(markSent)),
      });
      const j =
        tryParseJson<{ ticket?: Ticket; quoteText?: string; detail?: string }>(await r.text()) ?? {};
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : "??? ??? ????????");
      if (j.ticket) hydrateFromTicket(j.ticket);
      if (j.quoteText) setQuoteText(j.quoteText);
      setMsg(markSent ? "?? ??? ???????? ?????? ?? ??????? ?????? ?" : "?? ??? ??????? ???????? ?");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyQuoteText() {
    const text = quoteText.trim();
    if (!text) {
      await saveQuote(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setMsg("?? ??? ?? ???????? ???????? ? ????? ?? ??????");
    } catch {
      setMsg("???? ????? ? ???? ?????? ?? ???? ??????");
    }
  }

  async function activateOrder() {
    setMsg("");
    if (!window.confirm("????? ???????? ???????? ???????? ???????\n(??? ?????? ??????)")) return;
    setBusy(true);
    try {
      await ensureCustomerSaved();
      const tid = await ensureTicket();
      // ???? ??? ????? ??? ???????
      await fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(tid)}/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quotePayload(true)),
      });
      const r = await fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(tid)}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: payment }),
      });
      const j =
        tryParseJson<{ ticket?: Ticket; message?: string; detail?: string }>(await r.text()) ?? {};
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : "??? ???????");
      if (j.ticket) hydrateFromTicket(j.ticket);
      setMsg(j.message || `?? ??????? ? ????? #${j.ticket?.ticketNo || ""} ?? ??????`);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  const statusLabel = STATUS_LABEL[String(ticket?.status || "intake")] || ticket?.status || "???? ?????";
  const channelLabel = CHANNEL_LABEL[channel] || channel;
  const isWhatsapp = channel === "whatsapp";

  return (
    <div className="delivery-order-page" dir="rtl">
      <header className="dop-top">
        <div>
          <p className="dop-eyebrow">???? ?????? · {channelLabel}</p>
          <h1>
            {ticket?.ticketNo ? `????? #${ticket.ticketNo}` : "???? ??? ?????"}
            {ticket?.status ? <span className={`dop-status dop-status--${ticket.status}`}>{statusLabel}</span> : null}
          </h1>
          <p className="dop-sub">
            ??? ???? · ?????? · ?????? ?????? · ????? ?????? ? ???? ???? ????? ????????
          </p>
        </div>
        <button type="button" className="btn" onClick={() => navigate(backTo)}>
          ???? ?????? ????????
        </button>
      </header>

      <div className="dop-customer-search" ref={searchWrapRef}>
        <div className="dop-customer-search__bar">
          <span className="dop-customer-search__icon" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.2" />
              <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </span>
          <input
            className="dop-customer-search__input"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="???? ??? ???????? ?? ???? ?????? / ?????? / ???????"
            autoFocus
            disabled={locked}
            aria-label="??? ???????"
          />
          {searching ? <span className="dop-customer-search__busy">????</span> : null}
        </div>
        {hits.length > 0 ? (
          <ul className="dop-customer-search__hits">
            {hits.map((a) => (
              <li key={a.CardGuide}>
                <button type="button" onClick={() => pickAgent(a)}>
                  <strong>{a.AgentName}</strong>
                  <span>
                    {a.Phone || a.Mobile || "?"} · {(a.FullAdress || a.Address || "").slice(0, 70)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="dop-customer-search__hint">
          ?? ????????: ???? ????? ? ???? ??? ? ????? ?????? ?? ?????. ?? ????? ???????? ??????? ??? ??????.
        </p>
      </div>

      {msg ? <div className="dop-msg">{msg}</div> : null}

      {requestedItemsText ? (
        <div className="dop-request-box">
          <strong>?? ????? ?? ??????</strong>
          <p>{requestedItemsText}</p>
        </div>
      ) : null}

      {Array.isArray(ticket?.attachments) && ticket!.attachments!.length > 0 ? (
        <div className="dop-atts">
          {ticket!.attachments!.map((a, i) =>
            a.url ? (
              <a key={a.fileName || i} href={`${base}${a.url}`} target="_blank" rel="noreferrer">
                <img src={`${base}${a.url}`} alt="" />
              </a>
            ) : null,
          )}
        </div>
      ) : null}

      <section className="dop-customer-card">
        <div className="dop-customer-card__grid">
          <label>
            ????? *
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={locked} placeholder="??? ??????" />
          </label>
          <label>
            ?????? *
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={locked}
              inputMode="tel"
              placeholder="??? ??????"
            />
          </label>
          <label className="dop-span2">
            ???????
            <input value={address} onChange={(e) => setAddress(e.target.value)} disabled={locked} placeholder="??????? ??????" />
          </label>
          <label>
            ???????
            <input value={area} onChange={(e) => setArea(e.target.value)} disabled={locked} placeholder="??????? / ???????" />
          </label>
          <label>
            ???? ????? ({shippingGroupName})
            <select
              value={shippingProductGuide}
              disabled={locked}
              onChange={(e) => {
                const gid = e.target.value;
                setShippingProductGuide(gid);
                const hit = shippingServices.find((s) => s.CardGuide === gid);
                if (hit) {
                  setShippingProductName(hit.ProductName);
                  setShippingFee(Number(hit.Price) || 0);
                  setShippingMode("service_item");
                  setArea(hit.ProductName.replace(/^?????\s*???\s*/i, "").trim() || area);
                  if (hit.NotTaxable === false) setNoVat(false);
                  else setNoVat(true);
                } else {
                  setShippingProductName("");
                }
              }}
            >
              <option value="">? ???? ?????/???? ?</option>
              {shippingServices.map((s) => (
                <option key={s.CardGuide} value={s.CardGuide}>
                  {s.ProductName} ? {Number(s.Price || 0).toFixed(2)}
                </option>
              ))}
            </select>
          </label>
          <label>
            ????? ?????
            <input
              type="number"
              min={0}
              step={0.5}
              value={shippingFee}
              disabled={locked}
              onChange={(e) => setShippingFee(toNum(e.target.value, 0))}
            />
          </label>
          <label>
            ??? ???????
            <input
              value={deliveryTime}
              onChange={(e) => setDeliveryTime(e.target.value)}
              disabled={locked}
              placeholder="???? / ????? 8 ?"
            />
          </label>
          <label>
            ??????
            <input value={driverName} onChange={(e) => setDriverName(e.target.value)} disabled={locked} placeholder="??? ??????" />
          </label>
          <label>
            ????? ??????
            <input
              type="number"
              min={0}
              step={0.5}
              value={prepaidAmount}
              disabled={locked}
              onChange={(e) => {
                const n = toNum(e.target.value, 0);
                setPrepaidAmount(n);
                setPaymentMode(n <= 0 ? "cod" : n >= total && total > 0 ? "prepaid" : "partial");
              }}
            />
          </label>
          <label>
            ????? ??????
            <select
              value={prepaidMethod}
              onChange={(e) => setPrepaidMethod(e.target.value)}
              disabled={locked || !(prepaidAmount > 0)}
            >
              <option value="cash">????</option>
              <option value="card">?????</option>
              <option value="digital">????? / ?????</option>
            </select>
          </label>
          <label className="dop-check">
            <input type="checkbox" checked={noVat} disabled={locked} onChange={(e) => setNoVat(e.target.checked)} />
            ???? ?????
          </label>
        </div>
        <div className="dop-customer-card__actions">
          <span className="dop-totals-inline">
            ????? <strong>{itemsSubtotal.toFixed(0)}</strong>
            {" · "}
            ??? <strong>{shippingFee.toFixed(0)}</strong>
            {" · "}
            ?????? ???????? <strong>{total.toFixed(0)}</strong>
            {" · "}
            ????? <strong>{balanceDue.toFixed(0)}</strong>
          </span>
        </div>
      </section>

      <div className="dop-workspace">
        <div className="dop-catalog">
          <div className="dop-tabs">
            <button
              type="button"
              className={`dop-tab${catalogTab === "menu" ? " is-on" : ""}`}
              onClick={() => setCatalogTab("menu")}
              disabled={locked}
            >
              ???????
            </button>
            <button
              type="button"
              className={`dop-tab dop-tab--fav${catalogTab === "favorites" ? " is-on" : ""}`}
              onClick={() => setCatalogTab("favorites")}
              disabled={locked}
            >
              ??????? ???????
            </button>
          </div>

          {catalogTab === "menu" ? (
            <>
              <div className="dop-product-search">
                <SmartProductSearch
                  onSelect={(hit) =>
                    addProduct({
                      CardGuide: hit.CardGuide,
                      ProductName: hit.ProductName,
                      Price: hit.Price,
                    })
                  }
                  placeholder="??? ????"
                />
                <input
                  className="dop-filter"
                  value={productFilter}
                  onChange={(e) => setProductFilter(e.target.value)}
                  placeholder="????? ????????"
                  disabled={locked}
                />
              </div>
              <div className="dop-product-grid">
                {menuList.map((p) => (
                  <button key={p.CardGuide} type="button" className="dop-product" disabled={locked} onClick={() => addProduct(p)}>
                    <span>{p.ProductName}</span>
                    <em>{toNum(p.Price, 0).toFixed(2)}</em>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="dop-fav">
              {!agentGuid ? (
                <p className="dop-empty">???? ????? ?????? ????? ???? ?? ???? ??????.</p>
              ) : favorites.length === 0 ? (
                <p className="dop-empty">{favHint || "?? ????? ????? ???."}</p>
              ) : (
                <div className="dop-product-grid">
                  {favorites.map((p) => (
                    <button
                      key={p.CardGuide}
                      type="button"
                      className="dop-product dop-product--fav"
                      disabled={locked}
                      onClick={() => addProduct(p)}
                    >
                      <span>{p.ProductName}</span>
                      <em>{toNum(p.Price, 0).toFixed(2)}</em>
                      <small>×{Math.round(toNum(p.invoiceCount, 0))} ??????</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="dop-cart">
          <h2>{isWhatsapp ? "???????? ????????" : "????? / ????????"}</h2>
          <label className="dop-pay">
            ????? ??? ???????
            <select value={payment} onChange={(e) => setPayment(e.target.value)} disabled={locked}>
              <option value="cash">????</option>
              <option value="card">????? / ????</option>
              <option value="digital">?????</option>
            </select>
          </label>
          {cart.length === 0 ? (
            <p className="dop-empty">????? ? ??? ?? ??????? ?? ??????? ????? ??? ????? ??????.</p>
          ) : (
            <ul className="dop-cart-list">
              {cart.map((l) => (
                <li key={l.id}>
                  <div>
                    <strong>{l.name}</strong>
                    <span>{(l.qty * l.unitPrice).toFixed(0)}</span>
                  </div>
                  <div className="dop-qty">
                    <button type="button" disabled={locked} onClick={() => setQty(l.id, l.qty - 1)}>
                      ?
                    </button>
                    <em>{l.qty}</em>
                    <button type="button" disabled={locked} onClick={() => setQty(l.id, l.qty + 1)}>
                      +
                    </button>
                    <input
                      className="dop-price-edit"
                      type="number"
                      min={0}
                      step={1}
                      disabled={locked}
                      value={l.unitPrice}
                      title="??? ??????"
                      onChange={(e) => setLinePrice(l.id, toNum(e.target.value, 0))}
                    />
                  </div>
                  <input
                    className="dop-line-note"
                    value={l.note || ""}
                    disabled={locked}
                    placeholder="????? / ?????? ????????"
                    onChange={(e) => setLineNote(l.id, e.target.value)}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="dop-cart-sum">
            <div>
              <span>???????</span>
              <strong>{itemsSubtotal.toFixed(0)}</strong>
            </div>
            <div>
              <span>?????</span>
              <strong>{shippingFee.toFixed(0)}</strong>
            </div>
            <div>
              <span>?????? ????????</span>
              <strong>{total.toFixed(0)}</strong>
            </div>
            <div className="dop-cart-sum__due">
              <span>??????? ??? ???????</span>
              <strong>{balanceDue.toFixed(0)}</strong>
            </div>
          </div>

          {!locked ? (
            <div className="dop-actions">
              <button type="button" className="btn" disabled={busy} onClick={() => void saveQuote(false)}>
                ??? ?????
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveQuote(true)}>
                {isWhatsapp ? "??? ?????? ??????" : "??? ????????"}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => void copyQuoteText()}>
                ??? ????????
              </button>
              <button type="button" className="btn btn-activate" disabled={busy} onClick={() => void activateOrder()}>
                ?????? ???? ? ????? ??????
              </button>
            </div>
          ) : (
            <p className="dop-locked-hint">????? ?????? ({statusLabel}). ???????? ?? ????? ??????? ?? ???? ????????.</p>
          )}

          {quoteText ? (
            <textarea className="dop-quote-text" readOnly value={quoteText} rows={8} aria-label="?? ????????" />
          ) : null}
        </aside>
      </div>
    </div>
  );
}
