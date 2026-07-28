import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getApiBase } from "../lib/apiBase";
import { tryParseJson } from "../lib/tryParseJson";
import SmartProductSearch from "../components/SmartProductSearch";
import "../styles/deliveryOrderPage.css";

type Product = { CardGuide: string; ProductName: string; Price?: number; BaseEndUserPrice?: number };
type Line = { id: string; productGuide: string; name: string; qty: number; unitPrice: number; note: string };
type Ticket = { id: string; ticketNo?: number; status?: string; channel?: string; customerName?: string; phone?: string; area?: string; address?: string; agentGuid?: string; shippingFee?: number; shippingProductGuide?: string; shippingProductName?: string; paymentMode?: string; quoteLines?: Line[]; quoteText?: string };
type Customer = { CardGuide: string; AgentName: string; Phone?: string; Mobile?: string; FullAdress?: string; Address?: string };

const statusLabels: Record<string, string> = { intake: "استقبال", draft_quote: "مسودة مبدئية", quoted: "عرض مرسل", confirmed: "مؤكد", kitchen: "في المطبخ", ready: "جاهز", out_for_delivery: "خرج للتوصيل", delivered: "تم التسليم", settled: "مسوى", cancelled: "ملغى" };
const channelLabels: Record<string, string> = { whatsapp: "واتساب", phone: "اتصال", platform: "منصة", pos: "توصيل" };
const lockedStatuses = new Set(["kitchen", "ready", "out_for_delivery", "delivered", "settled", "cancelled"]);
const n = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const id = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function DeliveryOrderPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const role = String(user?.role || "cashier");
  const backTo = `/app/${role}/delivery-hub`;
  const base = getApiBase();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [favorites, setFavorites] = useState<Product[]>([]);
  const [shipping, setShipping] = useState<Product[]>([]);
  const [cart, setCart] = useState<Line[]>([]);
  const [phone, setPhone] = useState(""); const [name, setName] = useState(""); const [address, setAddress] = useState(""); const [area, setArea] = useState("");
  const [agentGuid, setAgentGuid] = useState(""); const [channel, setChannel] = useState("whatsapp"); const [paymentMode, setPaymentMode] = useState("cash");
  const [shippingFee, setShippingFee] = useState(0); const [shippingGuide, setShippingGuide] = useState(""); const [shippingName, setShippingName] = useState("");
  const [customerHits, setCustomerHits] = useState<Customer[]>([]); const [tab, setTab] = useState<"menu" | "favorites">("menu");
  const [quoteText, setQuoteText] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const locked = lockedStatuses.has(String(ticket?.status || "").toLowerCase());

  const hydrate = useCallback((t: Ticket) => {
    setTicket(t); setPhone(t.phone || ""); setName(t.customerName || ""); setArea(t.area || ""); setAddress(t.address || ""); setAgentGuid(t.agentGuid || "");
    setChannel(t.channel || "whatsapp"); setPaymentMode(t.paymentMode || "cash"); setShippingFee(n(t.shippingFee)); setShippingGuide(t.shippingProductGuide || ""); setShippingName(t.shippingProductName || "");
    setCart((t.quoteLines || []).map(x => ({ ...x, id: x.id || id(), qty: n(x.qty) || 1, unitPrice: n(x.unitPrice), note: x.note || "" }))); setQuoteText(t.quoteText || "");
  }, []);

  useEffect(() => { const tid = params.get("deliveryTicketId"); if (!tid) return; fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(tid)}`, { cache: "no-store" }).then(async r => { const j = tryParseJson<{ticket?: Ticket; detail?: string}>(await r.text()); if (!r.ok || !j?.ticket) throw new Error(j?.detail || "تعذر تحميل الطلب"); hydrate(j.ticket); }).catch(e => setMessage(String(e))); }, [base, hydrate, params]);
  useEffect(() => { Promise.all([fetch(`${base}/api/products`), fetch(`${base}/api/restaurant/delivery/shipping-services`)]).then(async ([p,s]) => { const pj = tryParseJson<{products?: Product[]}>(await p.text()); const sj = tryParseJson<{services?: Product[]}>(await s.text()); setProducts(pj?.products || []); setShipping(sj?.services || []); }).catch(() => setMessage("تعذر تحميل الأصناف")); }, [base]);
  useEffect(() => { if (!agentGuid) { setFavorites([]); return; } fetch(`${base}/api/restaurant/delivery/customer-favorites?agent_guide=${encodeURIComponent(agentGuid)}`).then(async r => { const j = tryParseJson<{favorites?: Product[]}>(await r.text()); setFavorites(j?.favorites || []); }).catch(() => setFavorites([])); }, [agentGuid, base]);

  async function searchCustomer(value: string) { setPhone(value); if (value.trim().length < 3) return setCustomerHits([]); try { const r = await fetch(`${base}/api/agents/search?search_text=${encodeURIComponent(value)}`); const j = tryParseJson<{agents?: Customer[]}>(await r.text()); setCustomerHits(j?.agents || []); } catch { setCustomerHits([]); } }
  function chooseCustomer(c: Customer) { setAgentGuid(c.CardGuide); setName(c.AgentName || ""); setPhone(c.Phone || c.Mobile || ""); setAddress(c.FullAdress || c.Address || ""); setCustomerHits([]); setTab("favorites"); }
  function addProduct(p: Product) { if (locked) return; setCart(old => { const x = old.find(line => line.productGuide === p.CardGuide && !line.note); return x ? old.map(line => line.id === x.id ? { ...line, qty: line.qty + 1 } : line) : [...old, { id: id(), productGuide: p.CardGuide, name: p.ProductName, qty: 1, unitPrice: n(p.Price ?? p.BaseEndUserPrice), note: "" }]; }); }
  function updateLine(lineId: string, patch: Partial<Line>) { setCart(old => old.map(x => x.id === lineId ? { ...x, ...patch } : x)); }
  function changeQty(lineId: string, amount: number) { setCart(old => old.flatMap(x => x.id !== lineId ? [x] : x.qty + amount <= 0 ? [] : [{ ...x, qty: x.qty + amount }])); }
  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + line.qty * line.unitPrice, 0), [cart]); const total = subtotal + shippingFee;

  async function ensureCustomer() { if (!name.trim() || !phone.trim()) throw new Error("أدخل اسم العميل ورقم الهاتف"); const r = await fetch(`${base}/api/agents/delivery-upsert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ AgentName: name.trim(), Phone: phone.trim(), Mobile: phone.trim(), FullAdress: address.trim() }) }); const j = tryParseJson<{success?: boolean; CardGuide?: string; detail?: string}>(await r.text()); if (!r.ok || !j?.success) throw new Error(j?.detail || "تعذر حفظ العميل"); setAgentGuid(j.CardGuide || ""); return j.CardGuide || agentGuid; }
  async function ensureTicket() { if (ticket?.id) return ticket.id; const guide = await ensureCustomer(); const r = await fetch(`${base}/api/restaurant/delivery/intake`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), phone: phone.trim(), area: area.trim() || "توصيل", address: address.trim(), channel, shippingFee, shippingProductGuide: shippingGuide || undefined, shippingProductName: shippingName || undefined, paymentMode, agentGuid: guide }) }); const j = tryParseJson<{ticket?: Ticket; detail?: string}>(await r.text()); if (!r.ok || !j?.ticket) throw new Error(j?.detail || "تعذر إنشاء الطلب"); hydrate(j.ticket); return j.ticket.id; }
  function payload(markSent: boolean) { return { lines: cart.map(({id: _id, ...line}) => line), shippingFee, shippingProductGuide: shippingGuide || undefined, shippingProductName: shippingName || undefined, paymentMode, customerName: name.trim(), phone: phone.trim(), area: area.trim(), address: address.trim(), agentGuid: agentGuid || undefined, markSent }; }
  async function saveQuote(markSent: boolean) { setBusy(true); setMessage(""); try { if (!cart.length && !shippingFee) throw new Error("أضف صنفاً أو رسم توصيل"); const tid = await ensureTicket(); const r = await fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(tid)}/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(markSent)) }); const j = tryParseJson<{ticket?: Ticket; quoteText?: string; detail?: string}>(await r.text()); if (!r.ok) throw new Error(j?.detail || "تعذر حفظ العرض"); if (j?.ticket) hydrate(j.ticket); setQuoteText(j?.quoteText || quoteText); setMessage(markSent ? "تم حفظ وإرسال العرض" : "تم حفظ المسودة"); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  async function copyWhatsApp() {
    let text = quoteText;
    if (!text) {
      setBusy(true);
      try {
        if (!cart.length && !shippingFee) throw new Error("أضف صنفاً أو رسم توصيل");
        const tid = await ensureTicket();
        const r = await fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(tid)}/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(true)) });
        const j = tryParseJson<{ticket?: Ticket; quoteText?: string; detail?: string}>(await r.text());
        if (!r.ok) throw new Error(j?.detail || "تعذر حفظ العرض");
        if (j?.ticket) hydrate(j.ticket);
        text = j?.quoteText || "";
        setQuoteText(text);
      } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); return; } finally { setBusy(false); }
    }
    if (text) { await navigator.clipboard.writeText(text); setMessage("تم نسخ نص واتساب"); }
  }
  async function activate() { if (!window.confirm("إرسال الطلب إلى المطبخ؟")) return; setBusy(true); try { const tid = await ensureTicket(); await fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(tid)}/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(true)) }); const r = await fetch(`${base}/api/restaurant/delivery/tickets/${encodeURIComponent(tid)}/activate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentMethod: paymentMode }) }); const j = tryParseJson<{ticket?: Ticket; detail?: string; message?: string}>(await r.text()); if (!r.ok) throw new Error(j?.detail || "تعذر تفعيل الطلب"); if (j?.ticket) hydrate(j.ticket); setMessage(j?.message || "تم إرسال الطلب للمطبخ"); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }

  const catalog = tab === "favorites" ? favorites : products;
  return <main className="delivery-order-page" dir="rtl"><header className="dop-top"><div><p className="dop-kicker">DELIVERY SESSION</p><h1>جلسة طلب توصيل <span className={`dop-status dop-status--${ticket?.status || "intake"}`}>{statusLabels[ticket?.status || "intake"] || ticket?.status || "جديد"}</span></h1><p className="dop-sub">{channelLabels[channel] || channel} {ticket?.ticketNo ? `#${ticket.ticketNo}` : ""} - {user?.name || ""}</p></div><button type="button" className="btn" onClick={() => navigate(backTo)}>رجوع لإدارة الدليفري</button></header>
    <section className="dop-customer-search"><div className="dop-customer-search__bar"><span className="dop-customer-search__icon">&#9742;</span><input className="dop-customer-search__input" value={phone} onChange={e => searchCustomer(e.target.value)} placeholder="الصق رقم هاتف العميل" disabled={locked}/></div>{customerHits.length > 0 && <ul className="dop-customer-search__hits">{customerHits.map(c => <li key={c.CardGuide}><button onClick={() => chooseCustomer(c)}><strong>{c.AgentName}</strong><span>{c.Phone || c.Mobile}</span></button></li>)}</ul>}</section>
    {message && <p className="dop-msg">{message}</p>}<section className="dop-customer-card"><div className="dop-customer-card__grid"><label>الاسم<input value={name} onChange={e => setName(e.target.value)} disabled={locked}/></label><label>المنطقة<input value={area} onChange={e => setArea(e.target.value)} disabled={locked}/></label><label className="dop-span2">العنوان<input value={address} onChange={e => setAddress(e.target.value)} disabled={locked}/></label><label>القناة<select value={channel} onChange={e => setChannel(e.target.value)} disabled={locked}>{Object.entries(channelLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>الدفع<select value={paymentMode} onChange={e => setPaymentMode(e.target.value)} disabled={locked}><option value="cash">نقدي</option><option value="card">شبكة</option><option value="online">أونلاين</option></select></label><label>الشحن<select value={shippingGuide} onChange={e => { const s = shipping.find(x => x.CardGuide === e.target.value); setShippingGuide(e.target.value); setShippingName(s?.ProductName || ""); setShippingFee(n(s?.Price)); }} disabled={locked}><option value="">بدون</option>{shipping.map(s => <option key={s.CardGuide} value={s.CardGuide}>{s.ProductName} ({n(s.Price).toFixed(2)})</option>)}</select></label></div></section>
    <section className="dop-workspace"><div className="dop-catalog"><div className="dop-tabs"><button className={`dop-tab ${tab === "menu" ? "is-on" : ""}`} onClick={() => setTab("menu")}>المنيو</button><button className={`dop-tab dop-tab--fav ${tab === "favorites" ? "is-on" : ""}`} onClick={() => setTab("favorites")}>المفضلة</button></div><div className="dop-product-search"><SmartProductSearch onSelect={addProduct}/></div><div className="dop-product-grid">{catalog.map(p => <button className={`dop-product ${tab === "favorites" ? "dop-product--fav" : ""}`} key={p.CardGuide} onClick={() => addProduct(p)} disabled={locked}><strong>{p.ProductName}</strong><em>{n(p.Price ?? p.BaseEndUserPrice).toFixed(2)}</em></button>)}</div></div>
      <aside className="dop-cart"><h2>السلة</h2><ul className="dop-cart-list">{cart.map(line => <li key={line.id}><div><strong>{line.name}</strong><span>{(line.qty * line.unitPrice).toFixed(2)}</span></div><div className="dop-qty"><button onClick={() => changeQty(line.id,-1)} disabled={locked}>-</button><span>{line.qty}</span><button onClick={() => changeQty(line.id,1)} disabled={locked}>+</button><input className="dop-price-edit" type="number" value={line.unitPrice} onChange={e => updateLine(line.id,{unitPrice:n(e.target.value)})} disabled={locked}/></div><input className="dop-line-note" value={line.note} onChange={e => updateLine(line.id,{note:e.target.value})} placeholder="إضافات / ملاحظة" disabled={locked}/></li>)}</ul><div className="dop-cart-sum"><div><span>الأصناف</span><b>{subtotal.toFixed(2)}</b></div><div><span>الشحن</span><input className="dop-price-edit" type="number" value={shippingFee} onChange={e => setShippingFee(n(e.target.value))} disabled={locked}/></div><div className="dop-cart-sum__due"><span>الإجمالي</span><b>{total.toFixed(2)}</b></div></div>{locked ? <p className="dop-locked-hint">الطلب مقفل بعد إرساله للمطبخ.</p> : <div className="dop-actions"><button onClick={() => saveQuote(false)} disabled={busy}>حفظ مسودة</button><button onClick={() => saveQuote(true)} disabled={busy}>حفظ وإرسال</button><button onClick={copyWhatsApp} disabled={busy}>نسخ نص واتساب</button><button className="btn-activate" onClick={activate} disabled={busy}>تفعيل وإرسال للمطبخ</button></div>}{quoteText && <textarea className="dop-quote-text" value={quoteText} readOnly rows={5}/>}</aside></section>
  </main>;
}
