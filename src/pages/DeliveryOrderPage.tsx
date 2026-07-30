import { useCallback, useEffect, useMemo, useState } from "react";
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
  quoteText?: string; attachments?: Attachment[]; quoteTotals?: { total?: number };
};
type PaymentAllocation = {
  id: string; smsId?: string; amount?: number; fromPhone?: string; fromName?: string;
  refNo?: string; smsAt?: string; createdAt?: string;
};
type PaymentSuggestion = {
  id: string; sender?: string; amount?: number; allocatedAmount?: number; availableAmount?: number;
  suggestedAmount?: number; fromPhone?: string; fromName?: string; refNo?: string; smsAt?: string;
  createdAt?: string; confidence?: number; matchScore?: number; matchReasons?: string[];
  phoneMatch?: boolean; nameMatch?: boolean;
};
type PaymentMatch = {
  invoiceTotal: number; prepaidAmount?: number; allocatedAmount: number;
  coveredAmount?: number; remainingDue: number;
  allocations: PaymentAllocation[]; suggestions: PaymentSuggestion[];
};

type Customer = { CardGuide: string; AgentName: string; Phone?: string; Mobile?: string; FullAdress?: string; Address?: string };
type ModifierItem = { itemId?: string; nameAr?: string; nameEn?: string; label?: string; priceDelta?: number };
type ModifierGroup = { groupId: string; nameAr?: string; name?: string; title?: string; minSelect?: number; maxSelect?: number; items?: ModifierItem[] };
type PendingModifiers = { product: Product; groups: ModifierGroup[]; selected: Record<string, string[]> };

const n = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const lineId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const lockedStatuses = new Set(["kitchen", "ready", "out_for_delivery", "delivered", "settled", "cancelled"]);


const statusLabels: Record<string, string> = { intake: "استقبال", draft_quote: "مسودة مبدئية", quoted: "عرض مرسل", kitchen: "في المطبخ", ready: "جاهز", out_for_delivery: "في الطريق", delivered: "تم التسليم", settled: "مسدد", cancelled: "ملغي" };
const channelLabels: Record<string, string> = { whatsapp: "واتساب", phone: "كول سنتر", platform: "منصة / تطبيق", table_convert: "تحويل طاولة" };

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
  const [paymentMatch, setPaymentMatch] = useState<PaymentMatch | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, number>>({});
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [showAllPayments, setShowAllPayments] = useState(false);
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
        if (!response.ok || !json?.ticket) throw new Error(json?.detail || "تعذر جلب التذكرة");
        hydrate(json.ticket);
      } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    })();
  }, [base, hydrate, params]);

  const loadPaymentSuggestions = useCallback(async (ticketId: string) => {
    setPaymentBusy(true);
    try {
      const response = await fetch(
        `${base}/api/restaurant/delivery/tickets/${encodeURIComponent(ticketId)}/payment-suggestions?limit=100`,
        { cache: "no-store" },
      );
      const json = tryParseJson<(PaymentMatch & { detail?: string })>(await response.text());
      if (!response.ok || !json) throw new Error(json?.detail || "تعذر جلب ترشيحات التحويل");
      setPaymentMatch(json);
      setPaymentAmounts((current) => {
        const next = { ...current };
        for (const row of json.suggestions || []) {
          if (next[row.id] == null) next[row.id] = n(row.suggestedAmount);
        }
        return next;
      });
      setSelectedPaymentId((current) => {
        if ((json.suggestions || []).some((row) => row.id === current && n(row.availableAmount) > 0)) return current;
        const exactMatches = (json.suggestions || []).filter(
          (row) => row.phoneMatch
            && n(row.confidence) >= 85
            && Math.abs(n(row.availableAmount) - n(json.remainingDue)) < 0.01,
        );
        const namedExactMatches = exactMatches.filter((row) => row.nameMatch);
        if (namedExactMatches.length === 1) return namedExactMatches[0].id;
        return exactMatches.length === 1 ? exactMatches[0].id : "";
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPaymentBusy(false);
    }
  }, [base]);

  useEffect(() => {
    if (!ticket?.id || n(ticket.quoteTotals?.total) <= 0) {
      setPaymentMatch(null);
      return;
    }
    void loadPaymentSuggestions(ticket.id);
  }, [loadPaymentSuggestions, ticket?.id, ticket?.quoteTotals?.total]);

  useEffect(() => {
    void Promise.all([fetch(`${base}/api/products`), fetch(`${base}/api/restaurant/delivery/shipping-services`)])
      .then(async ([productsResponse, shippingResponse]) => {
        const productJson = tryParseJson<{ products?: Product[] }>(await productsResponse.text());
        const shippingJson = tryParseJson<{ services?: Product[] }>(await shippingResponse.text());
        setProducts(productJson?.products || []); setShipping(shippingJson?.services || []);
      })
      .catch(() => setMessage("تعذر جلب الأصناف"));
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
    const extrasNote = extras.map((item) => item.nameAr || item.nameEn || item.label || "").filter(Boolean).join("، ");
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
    if (!name.trim() || !phone.trim()) throw new Error("يلزم اسم العميل ورقم الهاتف");
    const response = await fetch(`${base}/api/agents/delivery-upsert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ AgentName: name.trim(), Phone: phone.trim(), Mobile: phone.trim(), FullAdress: address.trim() }) });
    const json = tryParseJson<{ success?: boolean; CardGuide?: string; detail?: string }>(await response.text());
    if (!response.ok || !json?.success) throw new Error(json?.detail || "تعذر حفظ العميل");
    const guide = json.CardGuide || agentGuid; setAgentGuid(guide); return guide;
  }

  function ticketFields(agent: string) {
    return { name: name.trim(), phone: phone.trim(), address: address.trim(), area: area.trim() || "غير محدد", channel, agentGuid: agent || undefined,
      shippingFee, shippingProductGuide: shippingGuide || undefined, shippingProductName: shippingName || undefined, shippingMode, noVat,
      paymentMode, prepaidAmount, prepaidMethod: prepaidAmount > 0 ? prepaidMethod : undefined, driverName: driverName.trim() || undefined,
      deliveryTime: deliveryTime.trim() || undefined, requestedItems: requestedItemsText.trim() || undefined };
  }

  async function ensureTicket() {
    if (ticket?.id) return ticket.id;
    const guide = await ensureCustomer();
    const response = await fetch(`${base}/api/restaurant/delivery/intake`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ticketFields(guide)) });
    const json = tryParseJson<{ ticket?: Ticket; detail?: string }>(await response.text());
    if (!response.ok || !json?.ticket) throw new Error(json?.detail || "تعذر إنشاء تذكرة التوصيل");
    hydrate(json.ticket); return json.ticket.id;
  }

  function quotePayload(markSent: boolean) { return { lines: cart.map(({ id: _id, ...line }) => line), ...ticketFields(agentGuid), markSent }; }

  async function saveQuote(markSent: boolean) {
    setBusy(true); setMessage("");
    try {
      if (!cart.length && !shippingFee) throw new Error("أضف صنفاً أو خدمة شحن");
      const id = await ensureTicket();
      const response = await fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(id)}/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(quotePayload(markSent)) });
      const json = tryParseJson<{ ticket?: Ticket; quoteText?: string; detail?: string }>(await response.text());
      if (!response.ok) throw new Error(typeof json?.detail === "string" ? json.detail : `تعذر حفظ المبدئية (${response.status})`);
      if (json?.ticket) hydrate(json.ticket); setQuoteText(json?.quoteText || quoteText); setMessage(markSent ? "تم حفظ المبدئية — يمكنك نسخ الجدول الآن" : "تم الحفظ على التذكرة (لم تُرسل للعميل بعد)");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }

  async function ensureQuoteText() {
    let text = quoteText || ticket?.quoteText || "";
    if (text) return text;
    if (!cart.length && !shippingFee) throw new Error("أضف أصنافاً أو شحن قبل إنشاء المبدئية");
    const id = await ensureTicket();
    const response = await fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(id)}/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(quotePayload(true)) });
    const json = tryParseJson<{ ticket?: Ticket; quoteText?: string; detail?: string }>(await response.text());
    if (!response.ok) throw new Error(typeof json?.detail === "string" ? json.detail : `تعذر حفظ المبدئية (${response.status})`);
    if (json?.ticket) hydrate(json.ticket);
    text = json?.quoteText || "";
    setQuoteText(text);
    return text;
  }

  async function copyWhatsApp() {
    setBusy(true); setMessage("");
    try {
      const text = await ensureQuoteText();
      if (!text) throw new Error("لا توجد مبدئية للنسخ — أضف أصنافاً أو شحن أولاً");
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // احتياطي لو المتصفح منع الحافظة
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setMessage("تم نسخ الجدول — افتح واتساب عند العميل والصق (Ctrl+V)");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }


  async function activate() {
    if (!window.confirm("هل تؤكد إرسال الطلب للمطبخ؟")) return;
    setBusy(true); setMessage("");
    try {
      const id = await ensureTicket();
      const quote = await fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(id)}/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(quotePayload(true)) });
      if (!quote.ok) throw new Error("تعذر حفظ العرض قبل التفعيل");
      const response = await fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(id)}/activate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentMethod }) });
      const json = tryParseJson<{ ticket?: Ticket; detail?: string; message?: string }>(await response.text());
      if (!response.ok) throw new Error(typeof json?.detail === "string" ? json.detail : `تعذر حفظ المبدئية (${response.status})`);
      if (json?.ticket) hydrate(json.ticket); setMessage(json?.message || "تم تفعيل الطلب للمطبخ");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }

  async function allocatePayment(row: PaymentSuggestion) {
    if (!ticket?.id) return;
    const amount = n(paymentAmounts[row.id]);
    if (amount <= 0) { setMessage("أدخل مبلغ الربط"); return; }
    setPaymentBusy(true); setMessage("");
    try {
      const response = await fetch(
        `${base}/api/restaurant/delivery/tickets/${encodeURIComponent(ticket.id)}/payment-allocations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            smsId: row.id,
            amount,
            clientRequestId: (typeof crypto !== "undefined" && "randomUUID" in crypto)
              ? crypto.randomUUID()
              : `${ticket.id}-${row.id}-${Date.now()}`,
          }),
        },
      );
      const json = tryParseJson<{ detail?: string }>(await response.text());
      if (!response.ok) throw new Error(json?.detail || "تعذر ربط التحويل");
      setMessage(`تم ربط ${amount.toFixed(2)} من التحويل بالفاتورة`);
      await loadPaymentSuggestions(ticket.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPaymentBusy(false);
    }
  }

  async function removePaymentAllocation(allocation: PaymentAllocation) {
    if (!ticket?.id || !window.confirm(`فك ربط مبلغ ${n(allocation.amount).toFixed(2)}؟`)) return;
    setPaymentBusy(true); setMessage("");
    try {
      const response = await fetch(
        `${base}/api/restaurant/delivery/tickets/${encodeURIComponent(ticket.id)}/payment-allocations/${encodeURIComponent(allocation.id)}`,
        { method: "DELETE" },
      );
      const json = tryParseJson<{ detail?: string }>(await response.text());
      if (!response.ok) throw new Error(json?.detail || "تعذر فك الربط");
      setMessage("تم فك ربط التحويل");
      await loadPaymentSuggestions(ticket.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPaymentBusy(false);
    }
  }

  async function confirmSelectedPayment() {
    const row = visiblePaymentSuggestions.find((candidate) => candidate.id === selectedPaymentId);
    if (!row) { setMessage("اختر التحويل المطلوب ربطه أولاً"); return; }
    const amount = n(paymentAmounts[row.id] ?? row.suggestedAmount);
    const owner = row.fromName || row.fromPhone || "محوّل غير معروف";
    if (!window.confirm(`تأكيد ربط ${amount.toFixed(2)} ج من تحويل ${owner} بالفاتورة؟`)) return;
    await allocatePayment(row);
    setSelectedPaymentId("");
  }

  const catalog = tab === "favorites" ? favorites : products;
  const paymentLocked = ["settled", "cancelled"].includes(String(ticket?.status || ""));
  const visiblePaymentSuggestions = (paymentMatch?.suggestions || []).filter((row) => n(row.availableAmount) > 0);
  const shownPaymentSuggestions = showAllPayments ? visiblePaymentSuggestions : visiblePaymentSuggestions.slice(0, 12);
  const exactMatchCount = visiblePaymentSuggestions.filter(
    (row) => row.phoneMatch
      && n(row.confidence) >= 85
      && Math.abs(n(row.availableAmount) - n(paymentMatch?.remainingDue)) < 0.01,
  ).length;
  return (
    <main className="delivery-order-page" dir="rtl">
      <header className="dop-top">
        <div><p className="dop-eyebrow">DELIVERY SESSION</p><h1>جلسة طلب توصيل <span className={`dop-status dop-status--${ticket?.status || "intake"}`}>{statusLabels[String(ticket?.status || "intake")] || "مسودة"}</span></h1><p className="dop-sub">{channelLabels[channel] || channel}{ticket?.ticketNo ? ` - #${ticket.ticketNo}` : ""}</p></div>
        <button type="button" className="btn" onClick={() => navigate(`/app/${role}/delivery-hub`)}>العودة إلى مركز الدليفري</button>
      </header>
      {message ? <p className="dop-msg">{message}</p> : null}
      <section className="dop-customer-search">
        <div className="dop-customer-search__bar"><span className="dop-customer-search__icon">⌕</span><input className="dop-customer-search__input" value={phone} onChange={(event) => void searchCustomer(event.target.value)} placeholder="ابحث برقم هاتف العميل" disabled={locked} /></div>
        {hits.length ? <ul className="dop-customer-search__hits">{hits.map((customer) => <li key={customer.CardGuide}><button type="button" onClick={() => chooseCustomer(customer)}><strong>{customer.AgentName}</strong><span>{customer.Phone || customer.Mobile}</span></button></li>)}</ul> : null}
      </section>
      {(requestedItemsText || ticket?.attachments?.length) ? <section className="dop-request-box">{requestedItemsText ? <><strong>الأصناف المطلوبة</strong><p>{requestedItemsText}</p></> : null}{ticket?.attachments?.length ? <div className="dop-atts">{ticket.attachments.map((attachment) => attachment.url ? <a key={attachment.fileName || attachment.url} href={`${base}${attachment.url}`} target="_blank" rel="noreferrer"><img src={`${base}${attachment.url}`} alt="مرفق الطلب" /></a> : null)}</div> : null}</section> : null}
      <section className="dop-customer-card"><div className="dop-customer-card__grid">
        <label>العميل<input value={name} onChange={(event) => setName(event.target.value)} disabled={locked} /></label>
        <label>المنطقة<input value={area} onChange={(event) => setArea(event.target.value)} disabled={locked} /></label>
        <label className="dop-span2">العنوان<input value={address} onChange={(event) => setAddress(event.target.value)} disabled={locked} /></label>
        <label>القناة<select value={channel} onChange={(event) => setChannel(event.target.value)} disabled={locked}>{Object.entries(channelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>موعد التوصيل<input value={deliveryTime} onChange={(event) => setDeliveryTime(event.target.value)} disabled={locked} placeholder="مثلاً: قبل 8 مساءً" /></label>
        <label>خدمة الشحن<select value={shippingGuide} onChange={(event) => { const service = shipping.find((item) => item.CardGuide === event.target.value); setShippingGuide(event.target.value); setShippingName(service?.ProductName || ""); setShippingFee(n(service?.Price)); }} disabled={locked}><option value="">بدون شحن</option>{shipping.map((service) => <option key={service.CardGuide} value={service.CardGuide}>{service.ProductName}</option>)}</select></label>
        <label>اسم الطيار<input value={driverName} onChange={(event) => setDriverName(event.target.value)} disabled={locked} /></label>
        <label className="dop-check"><input type="checkbox" checked={noVat} onChange={(event) => setNoVat(event.target.checked)} disabled={locked} />بدون ضريبة</label>
      </div></section>
      <section className="dop-workspace"><div className="dop-catalog">
        <div className="dop-tabs"><button type="button" className={`dop-tab ${tab === "menu" ? "is-on" : ""}`} onClick={() => setTab("menu")}>المنيو</button><button type="button" className={`dop-tab dop-tab--fav ${tab === "favorites" ? "is-on" : ""}`} onClick={() => setTab("favorites")}>المفضلة</button></div>
        <div className="dop-product-search"><SmartProductSearch onSelect={(product) => void beginAddProduct(product)} /></div>
        <div className="dop-product-grid">{catalog.map((product) => <button type="button" className={`dop-product ${tab === "favorites" ? "dop-product--fav" : ""}`} key={product.CardGuide} onClick={() => void beginAddProduct(product)} disabled={locked}><strong>{product.ProductName}</strong><em>{n(product.Price ?? product.BaseEndUserPrice).toFixed(2)}</em></button>)}</div>
      </div>
        <aside className="dop-cart"><h2>السلة</h2>
          <label className="dop-pay">طريقة التحصيل<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)} disabled={locked}><option value="cash">نقدي</option><option value="card">بطاقة</option><option value="digital">محفظة</option></select></label>
          <label className="dop-pay">دفع مسبق<input className="dop-price-edit" type="number" min="0" value={prepaidAmount} onChange={(event) => setPrepaidAmount(n(event.target.value))} disabled={locked} /></label>
          <label className="dop-pay">طريقة الدفع<select value={prepaidMethod} onChange={(event) => setPrepaidMethod(event.target.value)} disabled={locked || prepaidAmount <= 0}><option value="cash">نقدي</option><option value="card">بطاقة</option><option value="digital">محفظة</option></select></label>
          <ul className="dop-cart-list">{cart.map((line) => <li key={line.id}><div><strong>{line.name}</strong><span>{(line.qty * line.unitPrice).toFixed(2)}</span></div><div className="dop-qty"><button type="button" onClick={() => changeQty(line.id, -1)} disabled={locked}>-</button><span>{line.qty}</span><button type="button" onClick={() => changeQty(line.id, 1)} disabled={locked}>+</button><input className="dop-price-edit" type="number" value={line.unitPrice} onChange={(event) => patchLine(line.id, { unitPrice: n(event.target.value) })} disabled={locked} /></div><input className="dop-line-note" value={line.note} onChange={(event) => patchLine(line.id, { note: event.target.value })} placeholder="ملاحظة على الصنف" disabled={locked} /></li>)}</ul>
          <div className="dop-cart-sum"><div><span>الأصناف</span><b>{subtotal.toFixed(2)}</b></div><div><span>الشحن</span><input className="dop-price-edit" type="number" value={shippingFee} onChange={(event) => setShippingFee(n(event.target.value))} disabled={locked} /></div><div className="dop-cart-sum__due"><span>الإجمالي</span><b>{total.toFixed(2)}</b></div></div>
          {locked ? <p className="dop-locked-hint">الطلب مقفل بعد إرساله للمطبخ.</p> : <div className="dop-actions"><button type="button" disabled={busy} onClick={() => void saveQuote(false)}>حفظ على التذكرة</button><button type="button" className="btn-activate" disabled={busy} onClick={() => void saveQuote(true)}>حفظ المبدئية</button><button type="button" className="btn-activate" disabled={busy} onClick={() => void copyWhatsApp()}>نسخ الجدول للصق في واتساب</button><button type="button" className="btn-activate" disabled={busy} onClick={() => void activate()}>العميل وافق — تفعيل للمطبخ</button></div>}
          {quoteText ? <div className="dop-quote-card" id="delivery-quote-card"><div className="dop-quote-card__head">فاتورة مبدئية{ticket?.ticketNo ? ` #${ticket.ticketNo}` : ""}</div><textarea className="dop-quote-text" value={quoteText} readOnly rows={8} /><p className="dop-quote-hint">1) احفظ المبدئية  2) انسخ الجدول  3) الصق في واتساب (Ctrl+V)</p></div> : null}
          {ticket?.id && n(ticket.quoteTotals?.total) > 0 ? <section className="dop-payment-match">
            <div className="dop-payment-match__head">
              <div><strong>ترشيح تحويلات الدفع</strong><span>{paymentLocked ? "التذكرة مقفلة — اربط التحويل قبل التسوية." : "النظام يرشّح فقط — الكاشير يراجع ويؤكد مبلغ الربط."}</span></div>
              <button type="button" className="btn" disabled={paymentBusy} onClick={() => void loadPaymentSuggestions(ticket.id)}>{paymentBusy ? "جارٍ التحديث…" : "تحديث"}</button>
            </div>
            <div className="dop-payment-summary">
              <div><span>الفاتورة</span><b>{n(paymentMatch?.invoiceTotal ?? ticket.quoteTotals?.total).toFixed(2)}</b></div>
              <div><span>مسبق</span><b>{n(paymentMatch?.prepaidAmount ?? ticket.prepaidAmount).toFixed(2)}</b></div>
              <div><span>تحويلات مربوطة</span><b>{n(paymentMatch?.allocatedAmount).toFixed(2)}</b></div>
              <div className={n(paymentMatch?.remainingDue) <= 0 ? "is-paid" : "is-due"}><span>المتبقي</span><b>{n(paymentMatch?.remainingDue ?? Math.max(0, n(ticket.quoteTotals?.total) - n(ticket.prepaidAmount))).toFixed(2)}</b></div>
            </div>
            {(paymentMatch?.allocations || []).length ? <div className="dop-payment-allocations">
              <h3>التحويلات المؤكدة</h3>
              {(paymentMatch?.allocations || []).map((row) => <div key={row.id} className="dop-payment-allocation">
                <div><strong>{n(row.amount).toFixed(2)} ج</strong><span>{row.fromName || row.fromPhone || "محوّل غير معروف"}{row.refNo ? ` · عملية ${row.refNo}` : ""}</span></div>
                <button type="button" disabled={paymentBusy || paymentLocked} onClick={() => void removePaymentAllocation(row)}>فك الربط</button>
              </div>)}
            </div> : null}
            {n(paymentMatch?.remainingDue) <= 0 && n(paymentMatch?.invoiceTotal) > 0 ? <p className="dop-payment-complete">✓ المبلغ مكتمل. عند تسوية الدليفري اختر «محفظة/تحويل».</p> : null}
            {n(paymentMatch?.remainingDue) > 0 ? <div className="dop-payment-confirm">
              <div>
                <strong>{selectedPaymentId ? "تحويل محدد وجاهز للتأكيد" : exactMatchCount > 1 ? `${exactMatchCount} تحويلات متطابقة — اختر الصحيح حسب التاريخ` : "اختر التحويل المراد ربطه"}</strong>
                <span>الأخضر: الهاتف والمبلغ متطابقان · الأزرق: الهاتف متطابق · الأصفر: ترشيح جزئي</span>
              </div>
              <button type="button" disabled={paymentBusy || paymentLocked || !selectedPaymentId} onClick={() => void confirmSelectedPayment()}>
                تأكيد وربط المحدد
              </button>
            </div> : null}
            <div className="dop-payment-table-wrap">
              <table className="dop-payment-table">
                <thead><tr><th>اختيار</th><th>الترشيح</th><th>التحويل</th><th>المتاح</th><th>مبلغ الربط</th></tr></thead>
                <tbody>{shownPaymentSuggestions.map((row) => {
                  const exact = Boolean(row.phoneMatch)
                    && n(row.confidence) >= 85
                    && Math.abs(n(row.availableAmount) - n(paymentMatch?.remainingDue)) < 0.01;
                  const rowClass = exact ? "is-exact-match" : row.phoneMatch ? "is-phone-match" : n(row.matchScore) >= 15 ? "is-partial-match" : "";
                  return <tr key={row.id} className={`${rowClass} ${selectedPaymentId === row.id ? "is-selected" : ""}`}>
                  <td><input className="dop-payment-select" type="checkbox" aria-label={`اختيار تحويل ${n(row.amount).toFixed(2)}`} checked={selectedPaymentId === row.id} disabled={paymentBusy || paymentLocked} onChange={() => setSelectedPaymentId((current) => current === row.id ? "" : row.id)} /></td>
                  <td><b>{row.fromName || row.fromPhone || "رقم مختلف/غير معروف"} <em className={`dop-match-badge ${exact ? "is-exact" : row.phoneMatch ? "is-phone" : "is-partial"}`}>{exact ? "تطابق كامل" : row.phoneMatch ? "نفس الهاتف" : "ترشيح"}</em></b><small>{(row.matchReasons || []).join(" · ") || "مطابقة يدوية"}{row.refNo ? ` · ${row.refNo}` : ""}</small></td>
                  <td>{n(row.amount).toFixed(2)} ج<small>{row.smsAt || row.createdAt || ""}</small></td>
                  <td>{n(row.availableAmount).toFixed(2)}</td>
                  <td><input type="number" min="0.01" step="0.01" max={n(row.availableAmount)} value={paymentAmounts[row.id] ?? n(row.suggestedAmount)} onChange={(event) => setPaymentAmounts((old) => ({ ...old, [row.id]: n(event.target.value) }))} /></td>
                </tr>})}</tbody>
              </table>
              {!shownPaymentSuggestions.length ? <p className="dop-payment-empty">لا توجد تحويلات واردة متاحة حالياً.</p> : null}
            </div>
            {visiblePaymentSuggestions.length > 12 ? <button type="button" className="dop-payment-more" onClick={() => setShowAllPayments((v) => !v)}>{showAllPayments ? "عرض الأعلى فقط" : `عرض كل التحويلات (${visiblePaymentSuggestions.length})`}</button> : null}
          </section> : null}

        </aside></section>
      {pendingModifiers ? <div className="dop-modifier-backdrop" role="dialog" aria-modal="true"><section className="dop-modifier-panel"><h2>إضافات {pendingModifiers.product.ProductName}</h2>{pendingModifiers.groups.map((group) => <fieldset key={group.groupId}><legend>{group.nameAr || group.name || group.title || "إضافات"}</legend>{(group.items || []).map((item) => { const itemId = item.itemId || item.nameAr || item.nameEn || ""; return <label key={itemId}><input type="checkbox" checked={(pendingModifiers.selected[group.groupId] || []).includes(itemId)} onChange={() => toggleModifier(group.groupId, itemId)} />{item.nameAr || item.nameEn || item.label} {n(item.priceDelta) ? `(+${n(item.priceDelta).toFixed(2)})` : ""}</label>; })}</fieldset>)}<div className="dop-actions"><button type="button" onClick={() => setPendingModifiers(null)}>إلغاء</button><button type="button" className="btn-activate" onClick={confirmModifiers}>إضافة للسلة</button></div></section></div> : null}
    </main>
  );
}
