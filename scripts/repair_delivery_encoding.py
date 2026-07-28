from pathlib import Path


def u(text: str) -> str:
    return text.encode("ascii").decode("unicode_escape")

page = r'''import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import SmartProductSearch from "../components/SmartProductSearch";
import "../styles/deliveryOrderPage.css";

type Product = { CardGuide: string; ProductName: string; Price?: number; BaseEndUserPrice?: number };
type CartLine = { id: string; productGuide: string; name: string; qty: number; unitPrice: number; note: string };
type Attachment = { url?: string; fileName?: string; contentType?: string };
type Ticket = {
  id: string; ticketNo?: number; status?: string; channel?: string; customerName?: string; phone?: string;
  address?: string; fullAddress?: string; area?: string; agentGuid?: string; shippingFee?: number;
  shippingProductGuide?: string; shippingProductName?: string; shippingMode?: string; noVat?: boolean;
  prepaidAmount?: number; prepaidMethod?: string; paymentMode?: "cod" | "prepaid" | "partial" | string;
  driverName?: string; deliveryTime?: string; requestedItemsText?: string; quoteLines?: CartLine[];
  quoteText?: string; attachments?: Attachment[];
};
type Customer = { CardGuide: string; AgentName: string; Phone?: string; Mobile?: string; FullAdress?: string; Address?: string };
type ModifierItem = { itemId?: string; nameAr?: string; nameEn?: string; label?: string; priceDelta?: number };
type ModifierGroup = { groupId: string; nameAr?: string; name?: string; title?: string; minSelect?: number; maxSelect?: number; items?: ModifierItem[] };
type PendingModifiers = { product: Product; groups: ModifierGroup[]; selected: Record<string, string[]> };

const n = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const lineId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const lockedStatuses = new Set(["kitchen", "ready", "out_for_delivery", "delivered", "settled", "cancelled"]);
const statusLabels: Record<string, string> = { intake: "\u0627\u0633\u062a\u0642\u0628\u0627\u0644", draft_quote: "\u0645\u0633\u0648\u062f\u0629 \u0645\u0628\u062f\u0626\u064a\u0629", quoted: "\u0639\u0631\u0636 \u0645\u0631\u0633\u0644", kitchen: "\u0641\u064a \u0627\u0644\u0645\u0637\u0628\u062e", ready: "\u062c\u0627\u0647\u0632", out_for_delivery: "\u0641\u064a \u0627\u0644\u0637\u0631\u064a\u0642", delivered: "\u062a\u0645 \u0627\u0644\u062a\u0633\u0644\u064a\u0645", settled: "\u0645\u0633\u062f\u062f", cancelled: "\u0645\u0644\u063a\u064a" };
const channelLabels: Record<string, string> = { whatsapp: "\u0648\u0627\u062a\u0633\u0627\u0628", phone: "\u0643\u0648\u0644 \u0633\u0646\u062a\u0631", platform: "\u0645\u0646\u0635\u0629 / \u062a\u0637\u0628\u064a\u0642", table_convert: "\u062a\u062d\u0648\u064a\u0644 \u0637\u0627\u0648\u0644\u0629" };

export default function DeliveryOrderPage() {
  const base = getApiBase();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const role = String(user?.role || "cashier");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [shipping, setShipping] = useState<Product[]>([]);
  const [favorites, setFavorites] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [tab, setTab] = useState<"menu" | "favorites">("menu");
  const [phone, setPhone] = useState(params.get("phone") || "");
  const [name, setName] = useState(params.get("name") || "");
  const [address, setAddress] = useState(params.get("address") || "");
  const [area, setArea] = useState(params.get("area") || "");
  const [agentGuid, setAgentGuid] = useState(params.get("agentGuid") || "");
  const [channel, setChannel] = useState(params.get("channel") || "whatsapp");
  const [shippingFee, setShippingFee] = useState(n(params.get("shippingFee")));
  const [shippingGuide, setShippingGuide] = useState(params.get("shippingProductGuide") || "");
  const [shippingName, setShippingName] = useState(params.get("shippingProductName") || "");
  const [shippingMode, setShippingMode] = useState(params.get("shippingMode") || "service_item");
  const [noVat, setNoVat] = useState(params.get("noVat") === "1");
  const [prepaidAmount, setPrepaidAmount] = useState(n(params.get("prepaidAmount")));
  const [prepaidMethod, setPrepaidMethod] = useState(params.get("prepaidMethod") || "cash");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "digital">("cash");
  const [driverName, setDriverName] = useState(params.get("driverName") || "");
  const [deliveryTime, setDeliveryTime] = useState(params.get("deliveryTime") || "");
  const [requestedItemsText, setRequestedItemsText] = useState(params.get("requestedItems") || "");
  const [quoteText, setQuoteText] = useState("");
  const [hits, setHits] = useState<Customer[]>([]);
  const [pendingModifiers, setPendingModifiers] = useState<PendingModifiers | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const locked = lockedStatuses.has(String(ticket?.status || "").toLowerCase());
  const paymentMode: "cod" | "prepaid" | "partial" = prepaidAmount <= 0 ? "cod" : "partial";

  const hydrate = useCallback((next: Ticket) => {
    setTicket(next);
    setPhone(next.phone || ""); setName(next.customerName || ""); setAddress(next.fullAddress || next.address || "");
    setArea(next.area || ""); setAgentGuid(next.agentGuid || ""); setChannel(next.channel || "whatsapp");
    setShippingFee(n(next.shippingFee)); setShippingGuide(next.shippingProductGuide || ""); setShippingName(next.shippingProductName || "");
    setShippingMode(next.shippingMode || "service_item"); setNoVat(Boolean(next.noVat)); setPrepaidAmount(n(next.prepaidAmount));
    setPrepaidMethod(next.prepaidMethod || "cash"); setDriverName(next.driverName || ""); setDeliveryTime(next.deliveryTime || "");
    setRequestedItemsText(next.requestedItemsText || ""); setQuoteText(next.quoteText || "");
    setCart((next.quoteLines || []).map((line) => ({ ...line, id: line.id || lineId(), qty: n(line.qty) || 1, unitPrice: n(line.unitPrice), note: line.note || "" })));
  }, []);

  useEffect(() => {
    const ticketId = params.get("deliveryTicketId");
    if (!ticketId) return;
    void (async () => {
      try {
        const response = await fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(ticketId)}`, { cache: "no-store" });
        const json = tryParseJson<{ ticket?: Ticket; detail?: string }>(await response.text());
        if (!response.ok || !json?.ticket) throw new Error(json?.detail || "\u062a\u0639\u0630\u0631 \u062c\u0644\u0628 \u0627\u0644\u062a\u0630\u0643\u0631\u0629");
        hydrate(json.ticket);
      } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    })();
  }, [base, hydrate, params]);

  useEffect(() => {
    void Promise.all([fetch(`${base}/api/products`), fetch(`${base}/api/restaurant/delivery/shipping-services`)])
      .then(async ([productsResponse, shippingResponse]) => {
        const productJson = tryParseJson<{ products?: Product[] }>(await productsResponse.text());
        const shippingJson = tryParseJson<{ services?: Product[] }>(await shippingResponse.text());
        setProducts(productJson?.products || []); setShipping(shippingJson?.services || []);
      })
      .catch(() => setMessage("\u062a\u0639\u0630\u0631 \u062c\u0644\u0628 \u0627\u0644\u0623\u0635\u0646\u0627\u0641"));
  }, [base]);

  useEffect(() => {
    if (!agentGuid) { setFavorites([]); return; }
    void fetch(`${base}/api/restaurant/delivery/customer-favorites?agent_guide=${encodeURIComponent(agentGuid)}`)
      .then(async (response) => tryParseJson<{ favorites?: Product[] }>(await response.text()))
      .then((json) => setFavorites(json?.favorites || []))
      .catch(() => setFavorites([]));
  }, [agentGuid, base]);

  async function searchCustomer(value: string) {
    setPhone(value);
    if (value.trim().length < 3) { setHits([]); return; }
    try {
      const response = await fetch(`${base}/api/agents/search?search_text=${encodeURIComponent(value)}`);
      const json = tryParseJson<{ agents?: Customer[] }>(await response.text());
      setHits(json?.agents || []);
    } catch { setHits([]); }
  }

  function chooseCustomer(customer: Customer) {
    setAgentGuid(customer.CardGuide); setName(customer.AgentName || ""); setPhone(customer.Phone || customer.Mobile || "");
    setAddress(customer.FullAdress || customer.Address || ""); setHits([]); setTab("favorites");
  }

  function addLine(product: Product, extras: ModifierItem[] = []) {
    const extrasSum = extras.reduce((sum, item) => sum + n(item.priceDelta), 0);
    const extrasNote = extras.map((item) => item.nameAr || item.nameEn || item.label || "").filter(Boolean).join("\u060c ");
    const basePrice = n(product.Price ?? product.BaseEndUserPrice);
    setCart((old) => {
      const matching = old.find((line) => line.productGuide === product.CardGuide && line.note === extrasNote);
      if (matching) return old.map((line) => line.id === matching.id ? { ...line, qty: line.qty + 1 } : line);
      return [...old, { id: lineId(), productGuide: product.CardGuide, name: product.ProductName, qty: 1, unitPrice: basePrice + extrasSum, note: extrasNote }];
    });
  }

  async function beginAddProduct(product: Product) {
    if (locked) return;
    try {
      const [linksResponse, groupsResponse] = await Promise.all([
        fetch(`${base}/api/restaurant/product-modifiers/${encodeURIComponent(product.CardGuide)}`),
        fetch(`${base}/api/restaurant/modifier-groups`),
      ]);
      const links = tryParseJson<{ groupIds?: string[]; entries?: Array<{ groupId?: string; isEnabled?: boolean }> }>(await linksResponse.text());
      const groupJson = tryParseJson<{ groups?: ModifierGroup[] }>(await groupsResponse.text());
      const enabledIds = (links?.entries || []).filter((entry) => entry.isEnabled !== false).map((entry) => entry.groupId || "");
      const ids = enabledIds.length ? enabledIds : (links?.groupIds || []);
      const groups = (groupJson?.groups || []).filter((group) => ids.includes(group.groupId) && (group.items || []).length);
      if (!groups.length) { addLine(product); return; }
      setPendingModifiers({ product, groups, selected: {} });
    } catch { addLine(product); }
  }

  function toggleModifier(groupId: string, itemId: string) {
    setPendingModifiers((current) => {
      if (!current) return current;
      const group = current.groups.find((entry) => entry.groupId === groupId);
      const selected = current.selected[groupId] || [];
      const next = selected.includes(itemId) ? selected.filter((id) => id !== itemId) : [...selected, itemId];
      const max = Math.max(1, n(group?.maxSelect) || 99);
      return { ...current, selected: { ...current.selected, [groupId]: next.slice(-max) } };
    });
  }

  function confirmModifiers() {
    if (!pendingModifiers) return;
    const extras = pendingModifiers.groups.flatMap((group) => (group.items || []).filter((item) => (pendingModifiers.selected[group.groupId] || []).includes(item.itemId || "")));
    addLine(pendingModifiers.product, extras); setPendingModifiers(null);
  }

  function patchLine(id: string, patch: Partial<CartLine>) { setCart((old) => old.map((line) => line.id === id ? { ...line, ...patch } : line)); }
  function changeQty(id: string, by: number) { setCart((old) => old.flatMap((line) => line.id !== id ? [line] : line.qty + by > 0 ? [{ ...line, qty: line.qty + by }] : [])); }
  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + line.qty * line.unitPrice, 0), [cart]);
  const total = subtotal + shippingFee;

  async function ensureCustomer() {
    if (!name.trim() || !phone.trim()) throw new Error("\u064a\u0644\u0632\u0645 \u0627\u0633\u0645 \u0627\u0644\u0639\u0645\u064a\u0644 \u0648\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062a\u0641");
    const response = await fetch(`${base}/api/agents/delivery-upsert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ AgentName: name.trim(), Phone: phone.trim(), Mobile: phone.trim(), FullAdress: address.trim() }) });
    const json = tryParseJson<{ success?: boolean; CardGuide?: string; detail?: string }>(await response.text());
    if (!response.ok || !json?.success) throw new Error(json?.detail || "\u062a\u0639\u0630\u0631 \u062d\u0641\u0638 \u0627\u0644\u0639\u0645\u064a\u0644");
    const guide = json.CardGuide || agentGuid; setAgentGuid(guide); return guide;
  }

  function ticketFields(agent: string) {
    return { name: name.trim(), phone: phone.trim(), address: address.trim(), area: area.trim() || "\u063a\u064a\u0631 \u0645\u062d\u062f\u062f", channel, agentGuid: agent || undefined,
      shippingFee, shippingProductGuide: shippingGuide || undefined, shippingProductName: shippingName || undefined, shippingMode, noVat,
      paymentMode, prepaidAmount, prepaidMethod: prepaidAmount > 0 ? prepaidMethod : undefined, driverName: driverName.trim() || undefined,
      deliveryTime: deliveryTime.trim() || undefined, requestedItems: requestedItemsText.trim() || undefined };
  }

  async function ensureTicket() {
    if (ticket?.id) return ticket.id;
    const guide = await ensureCustomer();
    const response = await fetch(`${base}/api/restaurant/delivery/intake`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ticketFields(guide)) });
    const json = tryParseJson<{ ticket?: Ticket; detail?: string }>(await response.text());
    if (!response.ok || !json?.ticket) throw new Error(json?.detail || "\u062a\u0639\u0630\u0631 \u0625\u0646\u0634\u0627\u0621 \u062a\u0630\u0643\u0631\u0629 \u0627\u0644\u062a\u0648\u0635\u064a\u0644");
    hydrate(json.ticket); return json.ticket.id;
  }

  function quotePayload(markSent: boolean) { return { lines: cart.map(({ id: _id, ...line }) => line), ...ticketFields(agentGuid), markSent }; }

  async function saveQuote(markSent: boolean) {
    setBusy(true); setMessage("");
    try {
      if (!cart.length && !shippingFee) throw new Error("\u0623\u0636\u0641 \u0635\u0646\u0641\u0627\u064b \u0623\u0648 \u062e\u062f\u0645\u0629 \u0634\u062d\u0646");
      const id = await ensureTicket();
      const response = await fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(id)}/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(quotePayload(markSent)) });
      const json = tryParseJson<{ ticket?: Ticket; quoteText?: string; detail?: string }>(await response.text());
      if (!response.ok) throw new Error(json?.detail || "\u062a\u0639\u0630\u0631 \u062d\u0641\u0638 \u0627\u0644\u0639\u0631\u0636");
      if (json?.ticket) hydrate(json.ticket); setQuoteText(json?.quoteText || quoteText); setMessage(markSent ? "\u062a\u0645 \u062d\u0641\u0638 \u0627\u0644\u0639\u0631\u0636 \u0648\u0625\u0631\u0633\u0627\u0644\u0647" : "\u062a\u0645 \u062d\u0641\u0638 \u0627\u0644\u0645\u0633\u0648\u062f\u0629");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }

  async function copyWhatsApp() {
    if (!quoteText) await saveQuote(true);
    const text = quoteText || ticket?.quoteText || "";
    if (!text) return;
    try { await navigator.clipboard.writeText(text); setMessage("\u062a\u0645 \u0627\u0644\u0646\u0633\u062e \u0625\u0644\u0649 \u0627\u0644\u062d\u0627\u0641\u0638\u0629"); } catch { setMessage("\u062a\u0639\u0630\u0631 \u0627\u0644\u0646\u0633\u062e \u0625\u0644\u0649 \u0627\u0644\u062d\u0627\u0641\u0638\u0629"); }
  }

  async function activate() {
    if (!window.confirm("\u0647\u0644 \u062a\u0624\u0643\u062f \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0637\u0644\u0628 \u0644\u0644\u0645\u0637\u0628\u062e\u061f")) return;
    setBusy(true); setMessage("");
    try {
      const id = await ensureTicket();
      const quote = await fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(id)}/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(quotePayload(true)) });
      if (!quote.ok) throw new Error("\u062a\u0639\u0630\u0631 \u062d\u0641\u0638 \u0627\u0644\u0639\u0631\u0636 \u0642\u0628\u0644 \u0627\u0644\u062a\u0641\u0639\u064a\u0644");
      const response = await fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(id)}/activate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentMethod }) });
      const json = tryParseJson<{ ticket?: Ticket; detail?: string; message?: string }>(await response.text());
      if (!response.ok) throw new Error(json?.detail || "\u062a\u0639\u0630\u0631 \u062a\u0641\u0639\u064a\u0644 \u0627\u0644\u0637\u0644\u0628");
      if (json?.ticket) hydrate(json.ticket); setMessage(json?.message || "\u062a\u0645 \u062a\u0641\u0639\u064a\u0644 \u0627\u0644\u0637\u0644\u0628 \u0644\u0644\u0645\u0637\u0628\u062e");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }

  const catalog = tab === "favorites" ? favorites : products;
  return (
    <main className="delivery-order-page" dir="rtl">
      <header className="dop-top">
        <div><p className="dop-eyebrow">DELIVERY SESSION</p><h1>\u062c\u0644\u0633\u0629 \u0637\u0644\u0628 \u062a\u0648\u0635\u064a\u0644 <span className={`dop-status dop-status--${ticket?.status || "intake"}`}>{statusLabels[String(ticket?.status || "intake")] || "\u0645\u0633\u0648\u062f\u0629"}</span></h1><p className="dop-sub">{channelLabels[channel] || channel}{ticket?.ticketNo ? ` - #${ticket.ticketNo}` : ""}</p></div>
        <button type="button" className="btn" onClick={() => navigate(`/app/${role}/delivery-hub`)}>\u0627\u0644\u0639\u0648\u062f\u0629 \u0625\u0644\u0649 \u0645\u0631\u0643\u0632 \u0627\u0644\u062f\u0644\u064a\u0641\u0631\u064a</button>
      </header>
      {message ? <p className="dop-msg">{message}</p> : null}
      <section className="dop-customer-search">
        <div className="dop-customer-search__bar"><span className="dop-customer-search__icon">\u2315</span><input className="dop-customer-search__input" value={phone} onChange={(event) => void searchCustomer(event.target.value)} placeholder="\u0627\u0628\u062d\u062b \u0628\u0631\u0642\u0645 \u0647\u0627\u062a\u0641 \u0627\u0644\u0639\u0645\u064a\u0644" disabled={locked} /></div>
        {hits.length ? <ul className="dop-customer-search__hits">{hits.map((customer) => <li key={customer.CardGuide}><button type="button" onClick={() => chooseCustomer(customer)}><strong>{customer.AgentName}</strong><span>{customer.Phone || customer.Mobile}</span></button></li>)}</ul> : null}
      </section>
      {(requestedItemsText || ticket?.attachments?.length) ? <section className="dop-request-box">{requestedItemsText ? <><strong>\u0627\u0644\u0623\u0635\u0646\u0627\u0641 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629</strong><p>{requestedItemsText}</p></> : null}{ticket?.attachments?.length ? <div className="dop-atts">{ticket.attachments.map((attachment) => attachment.url ? <a key={attachment.fileName || attachment.url} href={`${base}${attachment.url}`} target="_blank" rel="noreferrer"><img src={`${base}${attachment.url}`} alt="\u0645\u0631\u0641\u0642 \u0627\u0644\u0637\u0644\u0628" /></a> : null)}</div> : null}</section> : null}
      <section className="dop-customer-card"><div className="dop-customer-card__grid">
        <label>\u0627\u0644\u0639\u0645\u064a\u0644<input value={name} onChange={(event) => setName(event.target.value)} disabled={locked} /></label>
        <label>\u0627\u0644\u0645\u0646\u0637\u0642\u0629<input value={area} onChange={(event) => setArea(event.target.value)} disabled={locked} /></label>
        <label className="dop-span2">\u0627\u0644\u0639\u0646\u0648\u0627\u0646<input value={address} onChange={(event) => setAddress(event.target.value)} disabled={locked} /></label>
        <label>\u0627\u0644\u0642\u0646\u0627\u0629<select value={channel} onChange={(event) => setChannel(event.target.value)} disabled={locked}>{Object.entries(channelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>\u0645\u0648\u0639\u062f \u0627\u0644\u062a\u0648\u0635\u064a\u0644<input value={deliveryTime} onChange={(event) => setDeliveryTime(event.target.value)} disabled={locked} placeholder="\u0645\u062b\u0644\u0627\u064b: \u0642\u0628\u0644 8 \u0645\u0633\u0627\u0621\u064b" /></label>
        <label>\u062e\u062f\u0645\u0629 \u0627\u0644\u0634\u062d\u0646<select value={shippingGuide} onChange={(event) => { const service = shipping.find((item) => item.CardGuide === event.target.value); setShippingGuide(event.target.value); setShippingName(service?.ProductName || ""); setShippingFee(n(service?.Price)); }} disabled={locked}><option value="">\u0628\u062f\u0648\u0646 \u0634\u062d\u0646</option>{shipping.map((service) => <option key={service.CardGuide} value={service.CardGuide}>{service.ProductName}</option>)}</select></label>
        <label>\u0627\u0633\u0645 \u0627\u0644\u0637\u064a\u0627\u0631<input value={driverName} onChange={(event) => setDriverName(event.target.value)} disabled={locked} /></label>
        <label className="dop-check"><input type="checkbox" checked={noVat} onChange={(event) => setNoVat(event.target.checked)} disabled={locked} />\u0628\u062f\u0648\u0646 \u0636\u0631\u064a\u0628\u0629</label>
      </div></section>
      <section className="dop-workspace"><div className="dop-catalog">
        <div className="dop-tabs"><button type="button" className={`dop-tab ${tab === "menu" ? "is-on" : ""}`} onClick={() => setTab("menu")}>\u0627\u0644\u0645\u0646\u064a\u0648</button><button type="button" className={`dop-tab dop-tab--fav ${tab === "favorites" ? "is-on" : ""}`} onClick={() => setTab("favorites")}>\u0627\u0644\u0645\u0641\u0636\u0644\u0629</button></div>
        <div className="dop-product-search"><SmartProductSearch onSelect={(product) => void beginAddProduct(product)} /></div>
        <div className="dop-product-grid">{catalog.map((product) => <button type="button" className={`dop-product ${tab === "favorites" ? "dop-product--fav" : ""}`} key={product.CardGuide} onClick={() => void beginAddProduct(product)} disabled={locked}><strong>{product.ProductName}</strong><em>{n(product.Price ?? product.BaseEndUserPrice).toFixed(2)}</em></button>)}</div>
      </div>
        <aside className="dop-cart"><h2>\u0627\u0644\u0633\u0644\u0629</h2>
          <label className="dop-pay">\u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u062a\u062d\u0635\u064a\u0644<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)} disabled={locked}><option value="cash">\u0646\u0642\u062f\u064a</option><option value="card">\u0628\u0637\u0627\u0642\u0629</option><option value="digital">\u0645\u062d\u0641\u0638\u0629</option></select></label>
          <label className="dop-pay">\u062f\u0641\u0639 \u0645\u0633\u0628\u0642<input className="dop-price-edit" type="number" min="0" value={prepaidAmount} onChange={(event) => setPrepaidAmount(n(event.target.value))} disabled={locked} /></label>
          <label className="dop-pay">\u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u062f\u0641\u0639<select value={prepaidMethod} onChange={(event) => setPrepaidMethod(event.target.value)} disabled={locked || prepaidAmount <= 0}><option value="cash">\u0646\u0642\u062f\u064a</option><option value="card">\u0628\u0637\u0627\u0642\u0629</option><option value="digital">\u0645\u062d\u0641\u0638\u0629</option></select></label>
          <ul className="dop-cart-list">{cart.map((line) => <li key={line.id}><div><strong>{line.name}</strong><span>{(line.qty * line.unitPrice).toFixed(2)}</span></div><div className="dop-qty"><button type="button" onClick={() => changeQty(line.id, -1)} disabled={locked}>-</button><span>{line.qty}</span><button type="button" onClick={() => changeQty(line.id, 1)} disabled={locked}>+</button><input className="dop-price-edit" type="number" value={line.unitPrice} onChange={(event) => patchLine(line.id, { unitPrice: n(event.target.value) })} disabled={locked} /></div><input className="dop-line-note" value={line.note} onChange={(event) => patchLine(line.id, { note: event.target.value })} placeholder="\u0645\u0644\u0627\u062d\u0638\u0629 \u0639\u0644\u0649 \u0627\u0644\u0635\u0646\u0641" disabled={locked} /></li>)}</ul>
          <div className="dop-cart-sum"><div><span>\u0627\u0644\u0623\u0635\u0646\u0627\u0641</span><b>{subtotal.toFixed(2)}</b></div><div><span>\u0627\u0644\u0634\u062d\u0646</span><input className="dop-price-edit" type="number" value={shippingFee} onChange={(event) => setShippingFee(n(event.target.value))} disabled={locked} /></div><div className="dop-cart-sum__due"><span>\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a</span><b>{total.toFixed(2)}</b></div></div>
          {locked ? <p className="dop-locked-hint">\u0627\u0644\u0637\u0644\u0628 \u0645\u0642\u0641\u0644 \u0628\u0639\u062f \u0625\u0631\u0633\u0627\u0644\u0647 \u0644\u0644\u0645\u0637\u0628\u062e.</p> : <div className="dop-actions"><button type="button" disabled={busy} onClick={() => void saveQuote(false)}>\u062d\u0641\u0638 \u0645\u0633\u0648\u062f\u0629</button><button type="button" disabled={busy} onClick={() => void saveQuote(true)}>\u062d\u0641\u0638 \u0648\u0625\u0631\u0633\u0627\u0644</button><button type="button" disabled={busy} onClick={() => void copyWhatsApp()}>\u0646\u0633\u062e \u0644\u0644\u0648\u0627\u062a\u0633\u0627\u0628</button><button type="button" className="btn-activate" disabled={busy} onClick={() => void activate()}>\u062a\u0641\u0639\u064a\u0644 \u0627\u0644\u0637\u0644\u0628 \u0644\u0644\u0645\u0637\u0628\u062e</button></div>}
          {quoteText ? <textarea className="dop-quote-text" value={quoteText} readOnly rows={5} /> : null}
        </aside></section>
      {pendingModifiers ? <div className="dop-modifier-backdrop" role="dialog" aria-modal="true"><section className="dop-modifier-panel"><h2>\u0625\u0636\u0627\u0641\u0627\u062a {pendingModifiers.product.ProductName}</h2>{pendingModifiers.groups.map((group) => <fieldset key={group.groupId}><legend>{group.nameAr || group.name || group.title || "\u0625\u0636\u0627\u0641\u0627\u062a"}</legend>{(group.items || []).map((item) => { const itemId = item.itemId || item.nameAr || item.nameEn || ""; return <label key={itemId}><input type="checkbox" checked={(pendingModifiers.selected[group.groupId] || []).includes(itemId)} onChange={() => toggleModifier(group.groupId, itemId)} />{item.nameAr || item.nameEn || item.label} {n(item.priceDelta) ? `(+${n(item.priceDelta).toFixed(2)})` : ""}</label>; })}</fieldset>)}<div className="dop-actions"><button type="button" onClick={() => setPendingModifiers(null)}>\u0625\u0644\u063a\u0627\u0621</button><button type="button" className="btn-activate" onClick={confirmModifiers}>\u0625\u0636\u0627\u0641\u0629 \u0644\u0644\u0633\u0644\u0629</button></div></section></div> : null}
    </main>
  );
}
'''

intro = r'''# \u062f\u0644\u064a\u0644 \u062a\u0634\u063a\u064a\u0644 \u0627\u0644\u062f\u0644\u064a\u0641\u0631\u064a \u0648\u0627\u0644\u0643\u0648\u0644 \u0633\u0646\u062a\u0631 \u2014 \u0645\u0646 \u0627\u0644\u0628\u062f\u0627\u064a\u0629 \u0625\u0644\u0649 \u0627\u0644\u0646\u0647\u0627\u064a\u0629

> \u0648\u062b\u064a\u0642\u0629 \u0644\u0644\u0643\u0627\u0634\u064a\u0631 \u0648\u0645\u062f\u064a\u0631 \u0627\u0644\u062a\u0634\u063a\u064a\u0644 \u0648\u0627\u0644\u0645\u0637\u0648\u0651\u0631 \u2014 \u062a\u0634\u0631\u062d **\u0643\u064a\u0641** \u064a\u0639\u0645\u0644 \u0627\u0633\u062a\u0642\u0628\u0627\u0644 \u0637\u0644\u0628\u0627\u062a \u0627\u0644\u062a\u0648\u0635\u064a\u0644 \u064a\u0648\u0645\u064a\u0627\u064b\u060c \u0648\u0645\u0627 \u0627\u0644\u0641\u0631\u0642 \u0628\u064a\u0646 \u0627\u0644\u0634\u0627\u0634\u0627\u062a\u060c \u0648\u0645\u0627 \u0627\u0644\u0645\u0633\u0627\u0631 \u0645\u0646 \u0627\u0644\u0645\u0643\u0627\u0644\u0645\u0629/\u0627\u0644\u0648\u0627\u062a\u0633\u0627\u0628 \u062d\u062a\u0649 \u062e\u0631\u0648\u062c \u0627\u0644\u0637\u064a\u0627\u0631.

---

## 1) \u0627\u0644\u062f\u0644\u064a\u0641\u0631\u064a \u0641\u064a \u0633\u0637\u0631 \u0648\u0627\u062d\u062f

\u062a\u0630\u0643\u0631\u0629 \u0627\u0644\u062a\u0648\u0635\u064a\u0644 \u062a\u062d\u062a\u0641\u0638 \u0628\u0627\u0644\u0639\u0645\u064a\u0644\u060c \u0648\u0627\u0644\u0642\u0646\u0627\u0629\u060c \u0648\u0627\u0644\u0645\u0631\u0641\u0642\u0627\u062a\u060c \u0648\u062a\u062a\u0628\u0639 \u0627\u0644\u062d\u0627\u0644\u0629. \u062a\u064f\u0641\u062a\u062d \u062c\u0644\u0633\u0629 \u0637\u0644\u0628 \u062a\u0648\u0635\u064a\u0644 \u0645\u062e\u0635\u0635\u0629 \u0644\u0625\u062f\u062e\u0627\u0644 \u0627\u0644\u0633\u0644\u0629\u060c \u0648\u0625\u0646\u0634\u0627\u0621 \u0639\u0631\u0636 \u0645\u0628\u062f\u0626\u064a\u060c \u0648\u062a\u0641\u0639\u064a\u0644 \u0627\u0644\u0645\u0637\u0628\u062e. \u0647\u0630\u0627 \u0627\u0644\u0645\u0633\u0627\u0631 \u0644\u0627 \u064a\u0633\u062a\u062e\u062f\u0645 Waiter POS.

\u0627\u0644\u062d\u0627\u0644\u0627\u062a: `intake` / `draft_quote` -> `quoted` -> `kitchen` -> `ready` -> `out_for_delivery` -> `delivered` -> `settled` | `cancelled`.

## 2) \u0627\u0644\u0634\u0627\u0634\u0627\u062a \u0648\u0627\u0644\u0645\u0633\u0627\u0631\u0627\u062a

- \u0645\u0631\u0643\u0632 \u0627\u0644\u062f\u0644\u064a\u0641\u0631\u064a (`/app/cashier/delivery-hub`): \u0627\u0633\u062a\u0642\u0628\u0627\u0644 \u0627\u0644\u0637\u0644\u0628\u0627\u062a\u060c \u0648\u0627\u0644\u062a\u0630\u0627\u0643\u0631\u060c \u0648\u062a\u062d\u0648\u064a\u0644 \u0627\u0644\u0637\u0627\u0648\u0644\u0627\u062a\u060c \u0648\u0637\u0627\u0628\u0648\u0631 \u0627\u0644\u062a\u0648\u0632\u064a\u0639.
- \u062c\u0644\u0633\u0629 \u0637\u0644\u0628 \u0627\u0644\u062a\u0648\u0635\u064a\u0644 (`/app/cashier/delivery-order`): \u0628\u062d\u062b \u0627\u0644\u0639\u0645\u064a\u0644\u060c \u0648\u0627\u0644\u0645\u0646\u064a\u0648\u060c \u0648\u0627\u0644\u0645\u0641\u0636\u0644\u0629\u060c \u0648\u0627\u0644\u0625\u0636\u0627\u0641\u0627\u062a\u060c \u0648\u0627\u0644\u0633\u0644\u0629\u060c \u0648\u0627\u0644\u0639\u0631\u0636\u060c \u0648\u0627\u0644\u062a\u0641\u0639\u064a\u0644.
- \u0637\u0627\u0628\u0648\u0631 \u0627\u0644\u062a\u0648\u0632\u064a\u0639: \u064a\u0639\u0631\u0636 \u062a\u0630\u0627\u0643\u0631 \u0627\u0644\u062c\u0627\u0647\u0632 \u0648\u0641\u064a \u0627\u0644\u0637\u0631\u064a\u0642 \u0645\u0639 \u0635\u0641\u0648\u0641 KDS \u0627\u0644\u0645\u0631\u062a\u0628\u0637\u0629\u060c \u0644\u062a\u0639\u064a\u064a\u0646 \u0627\u0644\u0637\u064a\u0627\u0631 \u0648\u062a\u0623\u0643\u064a\u062f \u0627\u0644\u062a\u0633\u0644\u064a\u0645 \u0648\u0627\u0644\u062a\u0633\u0648\u064a\u0629.

## 3) \u0627\u0644\u0623\u062f\u0648\u0627\u0631

\u0627\u0644\u0643\u0627\u0634\u064a\u0631\u060c \u0648\u0627\u0644\u0645\u062f\u064a\u0631\u060c \u0648\u0645\u062f\u064a\u0631 \u0627\u0644\u062a\u0634\u063a\u064a\u0644\u060c \u0648\u0627\u0644\u0645\u0637\u0648\u0651\u0631 \u064a\u0645\u0643\u0646\u0647\u0645 \u0627\u0633\u062a\u0642\u0628\u0627\u0644 \u0627\u0644\u0637\u0644\u0628\u060c \u0648\u0628\u0646\u0627\u0621 \u0627\u0644\u0633\u0644\u0629\u060c \u0648\u062a\u062d\u0648\u064a\u0644 \u0627\u0644\u0637\u0627\u0648\u0644\u0629\u060c \u0648\u062a\u0634\u063a\u064a\u0644 \u0637\u0627\u0628\u0648\u0631 \u0627\u0644\u062a\u0648\u0635\u064a\u0644. \u064a\u0635\u0644 \u0625\u0644\u0649 \u0627\u0644\u0645\u0637\u0628\u062e \u0641\u0642\u0637 \u0627\u0644\u0637\u0644\u0628 \u0627\u0644\u0645\u0641\u0639\u0651\u0644 \u0644\u064a\u0639\u0644\u0645\u0647 \u062c\u0627\u0647\u0632\u0627\u064b. \u064a\u0633\u062a\u0644\u0645 \u0627\u0644\u0637\u064a\u0627\u0631 \u0627\u0644\u0637\u0644\u0628 \u0627\u0644\u0645\u0639\u064a\u0651\u0646 \u0644\u0647 \u0648\u064a\u0643\u0645\u0644 \u062a\u062a\u0628\u0639 \u0627\u0644\u062a\u0633\u0644\u064a\u0645.

## 4) \u062f\u0648\u0631\u0629 \u0627\u0644\u062a\u0634\u063a\u064a\u0644

1. \u0648\u0627\u062a\u0633\u0627\u0628: \u0623\u0646\u0634\u0626 \u0627\u0644\u062a\u0630\u0643\u0631\u0629\u060c \u0648\u0623\u0631\u0641\u0642 \u0627\u0644\u0645\u062d\u0627\u062f\u062b\u0629 \u0639\u0646\u062f \u062a\u0648\u0641\u0651\u0631\u0647\u0627\u060c \u0648\u0627\u0628\u0646 \u0639\u0631\u0636\u0627\u064b \u0645\u0628\u062f\u0626\u064a\u0627\u064b\u060c \u062b\u0645 \u0623\u0631\u0633\u0644/\u0627\u0646\u0633\u062e \u0646\u0635 \u0627\u0644\u0639\u0631\u0636. \u0644\u0627 \u062a\u064f\u0641\u0639\u0651\u0644 \u0627\u0644\u0637\u0644\u0628 \u0644\u0644\u0645\u0637\u0628\u062e \u0625\u0644\u0627 \u0628\u0639\u062f \u0645\u0648\u0627\u0641\u0642\u0629 \u0627\u0644\u0639\u0645\u064a\u0644.
2. \u0643\u0648\u0644 \u0633\u0646\u062a\u0631: \u062a\u0641\u062a\u062d \u062a\u0630\u0643\u0631\u0629 \u0627\u0644\u0647\u0627\u062a\u0641 \u0627\u0644\u0633\u0644\u0629 \u0645\u0628\u0627\u0634\u0631\u0629. \u0627\u062e\u062a\u0631 \u0645\u062c\u0645\u0648\u0639\u0627\u062a \u0627\u0644\u0625\u0636\u0627\u0641\u0627\u062a \u0627\u0644\u0645\u0631\u062a\u0628\u0637\u0629 \u0628\u0643\u0644 \u0635\u0646\u0641\u061b \u0648\u062a\u064f\u062d\u0641\u0638 \u0623\u0633\u0645\u0627\u0624\u0647\u0627 \u0648\u0623\u0633\u0639\u0627\u0631\u0647\u0627 \u0641\u064a \u0633\u0637\u0631 \u0627\u0644\u0633\u0644\u0629\u060c \u062b\u0645 \u0627\u062a\u0628\u0639 \u0646\u0641\u0633 \u062d\u0644\u0642\u0629 \u0627\u0644\u0639\u0631\u0636 \u062b\u0645 \u0627\u0644\u0645\u0637\u0628\u062e.
3. \u0627\u0644\u0645\u0648\u0642\u0639/\u0627\u0644\u0645\u0646\u0635\u0629: \u0633\u062c\u0651\u0644 \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u062a\u0630\u0643\u0631\u0629\u060c \u0648\u0646\u0635 \u0627\u0644\u0637\u0644\u0628 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u060c \u0648\u0627\u0644\u0645\u0631\u0641\u0642\u0627\u062a\u060c \u062b\u0645 \u0627\u0628\u0646 \u0627\u0644\u0633\u0644\u0629 \u0648\u0627\u062a\u0628\u0639 \u0646\u0641\u0633 \u062f\u0648\u0631\u0629 \u0627\u0644\u0645\u0637\u0628\u062e.
4. \u062a\u062d\u0648\u064a\u0644 \u0637\u0627\u0648\u0644\u0629 \u064a\u0646\u0634\u0626 \u062a\u0630\u0643\u0631\u0629 \u062a\u0648\u0635\u064a\u0644 \u0645\u0631\u062a\u0628\u0637\u0629 \u0628\u0627\u0644\u0639\u0645\u064a\u0644 \u0648\u0627\u0644\u0635\u0648\u0631 \u0648\u0627\u0644\u062a\u062a\u0628\u0639. \u0623\u0643\u0645\u0644\u0647\u0627 \u0641\u064a \u062c\u0644\u0633\u0629 \u0627\u0644\u062a\u0648\u0635\u064a\u0644\u060c \u0648\u0644\u0627 \u062a\u0633\u062a\u062e\u062f\u0645 Waiter POS.
5. \u0628\u0639\u062f \u0627\u0644\u062a\u0641\u0639\u064a\u0644 \u064a\u062c\u0647\u0651\u0632 KDS \u0627\u0644\u0637\u0644\u0628\u061b \u0648\u064a\u0639\u064a\u0651\u0646 \u0627\u0644\u062a\u0648\u0632\u064a\u0639 \u0637\u064a\u0627\u0631\u0627\u064b\u060c \u0648\u064a\u0633\u062c\u0651\u0644 \u0627\u0644\u062a\u0633\u0644\u064a\u0645 \u0648\u0627\u0644\u062a\u0633\u0648\u064a\u0629.

---

'''

page_path = Path("src/pages/DeliveryOrderPage.tsx")
doc_path = Path("docs/DELIVERY_CALL_CENTER_PLAYBOOK.md")
page_path.write_text(u(page), encoding="utf-8", newline="\n")
current_doc = doc_path.read_text(encoding="utf-8")
marker = "## 5)"
if marker not in current_doc:
    raise RuntimeError("Playbook section 5 marker is missing")
suffix = current_doc[current_doc.index(marker):]
suffix = suffix.replace(u(r"\u0623\u0643\u0645\u0644 \u0627\u0644\u0623\u0635\u0646\u0627\u0641 \u0625\u0646 \u0644\u0632\u0645 \u0645\u0646 POS/\u0643\u0648\u0644 \u0633\u0646\u062a\u0631 \u062b\u0645 \u0627\u0644\u0645\u0637\u0628\u062e \u062b\u0645 \u0627\u0644\u0637\u0627\u0628\u0648\u0631"), u(r"\u0623\u0643\u0645\u0644 \u0627\u0644\u0623\u0635\u0646\u0627\u0641 \u0641\u064a \u062c\u0644\u0633\u0629 \u0627\u0644\u062a\u0648\u0635\u064a\u0644\u060c \u062b\u0645 \u0641\u0639\u0651\u0644 \u0627\u0644\u0637\u0644\u0628 \u0648\u062a\u0627\u0628\u0639\u0647 \u0641\u064a \u0627\u0644\u0637\u0627\u0628\u0648\u0631"))
suffix = suffix.replace(u(r"\u0646\u0642\u0637\u0629 \u0627\u0644\u0628\u064a\u0639 POS \u062f\u0644\u064a\u0641\u0631\u064a"), u(r"\u062c\u0644\u0633\u0629 \u0627\u0644\u062a\u0648\u0635\u064a\u0644"))
suffix = suffix.replace(u(r"\u0643\u0648\u0644 \u0633\u0646\u062a\u0631 WaiterOrder delivery"), u(r"\u062c\u0644\u0633\u0629 \u0627\u0644\u062a\u0648\u0635\u064a\u0644"))
suffix = suffix.replace(u(r"\u0627\u0633\u062a\u062e\u062f\u0645 **\u0643\u0648\u0644 \u0633\u0646\u062a\u0631** \u0644\u0644\u0637\u0644\u0628\u0627\u062a \u0627\u0644\u0645\u0641\u0635\u0651\u0644\u0629 \u0648**POS** \u0644\u0644\u0633\u0631\u064a\u0639"), u(r"\u0627\u0633\u062a\u062e\u062f\u0645 **\u062c\u0644\u0633\u0629 \u0627\u0644\u062a\u0648\u0635\u064a\u0644** \u0644\u0644\u0637\u0644\u0628\u0627\u062a \u0627\u0644\u0645\u0641\u0635\u0651\u0644\u0629 \u0648\u0627\u0644\u0633\u0631\u064a\u0639\u0629"))
doc_path.write_text(u(intro) + suffix, encoding="utf-8", newline="\n")


