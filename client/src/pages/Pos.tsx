import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Barcode, Bandage, CreditCard, HeartPulse, Keyboard, LockKeyhole, Minus, PackageSearch, Plus, Search, ShieldCheck, Trash2, Wallet } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { api, formatCurrency, PharmacyApiError, todayUtcISO } from "@/lib/pharmacy-api";
import type { CartLine, PosProduct } from "@/lib/pharmacy-types";
import { getHeldCart, storeHeldCart, takeHeldCart } from "@/lib/held-cart";
import { usePharmacyAuth } from "@/contexts/PharmacyAuthContext";
import Modal from "@/components/Modal";
import Receipt from "@/components/Receipt";

type Shift = { id: number; startingCash: string; status: string; startTime: string | Date };
type Service = { name: string; price: string; icon: string };
type PosData = { medicines: PosProduct[]; popular: PosProduct[]; services: Service[]; shift: Shift | null };
type Invoice = { id: number; number: string; cashier: string; shiftId: number; paymentMethod: "cash" | "card"; subtotal: string; discount: string; net: string; received: string | null; change: string; createdAt: string; items: Array<{ name: string; quantity: number; unitPrice: string; total: string; barcode?: string | null }> };

function productStatus(product: PosProduct) {
  if (product.expiryDate < todayUtcISO()) return { label: "منتهي", className: "expired" };
  if (product.quantity < 1) return { label: "نافد", className: "out" };
  if (product.quantity < 10) return { label: `متبقٍ ${product.quantity}`, className: "low" };
  return { label: "متوفر", className: "good" };
}

export default function PosPage() {
  const { user } = usePharmacyAuth();
  const [, navigate] = useLocation();
  const [data, setData] = useState<PosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedResult, setSelectedResult] = useState(0);
  const [activeTab, setActiveTab] = useState<"popular" | "all">("popular");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [heldCart, setHeldCart] = useState<CartLine[]>(() => getHeldCart(user?.id ?? -1));
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [discount, setDiscount] = useState("");
  const [floatValue, setFloatValue] = useState("");
  const [showFloatModal, setShowFloatModal] = useState(false);
  const [startingShift, setStartingShift] = useState(false);
  const [paying, setPaying] = useState(false);
  const [expiryAlert, setExpiryAlert] = useState("");
  const [lastInvoice, setLastInvoice] = useState<Invoice | null>(null);
  const [locked, setLocked] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const pendingKeyRef = useRef("");
  const pendingSignatureRef = useRef("");

  const loadPos = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<PosData>("/api/pos");
      setData(result);
      if (!result.shift) setShowFloatModal(true);
    } catch (error) {
      toast.error(error instanceof PharmacyApiError ? error.message : "تعذر تحميل نقطة البيع.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadPos(); }, [loadPos]);
  useEffect(() => { setSelectedResult(0); }, [query, activeTab]);

  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + Math.round(line.price * 100) * line.quantity, 0), [cart]);
  const discountCents = Math.min(subtotal, Math.max(0, Math.round((Number(discount) || 0) * 100)));
  const totalCents = subtotal - discountCents;
  const tenderCents = Math.max(0, Math.round((Number(cashReceived) || 0) * 100));
  const changeCents = Math.max(0, tenderCents - totalCents);
  const totalItems = cart.reduce((sum, line) => sum + line.quantity, 0);

  const addProduct = (product: PosProduct) => {
    if (product.expiryDate < todayUtcISO()) {
      const message = `لا يمكن بيع «${product.name}» لأنه منتهي الصلاحية.`;
      setExpiryAlert(message);
      toast.error(message);
      return;
    }
    if (product.quantity < 1) { toast.error(`«${product.name}» غير متوفر في المخزون.`); return; }
    setCart(current => {
      const key = `medicine:${product.id}`;
      const found = current.find(line => line.key === key);
      if (found && found.quantity >= product.quantity) { toast.error(`الكمية المتاحة من «${product.name}» هي ${product.quantity} فقط.`); return current; }
      if (found) return current.map(line => line.key === key ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { key, medicineId: product.id, name: product.name, barcode: product.barcode, price: Number(product.price), quantity: 1, available: product.quantity }];
    });
  };

  const addService = (service: Service) => {
    const key = `service:${service.name}`;
    setCart(current => {
      const found = current.find(line => line.key === key);
      if (found) return current.map(line => line.key === key ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { key, serviceName: service.name, name: service.name, price: Number(service.price), quantity: 1 }];
    });
  };

  const changeQuantity = (line: CartLine, delta: number) => setCart(current => current.flatMap(item => {
    if (item.key !== line.key) return [item];
    const next = item.quantity + delta;
    if (next < 1) return [];
    if (item.available != null && next > item.available) { toast.error(`المخزون المتاح من «${item.name}» هو ${item.available}.`); return [item]; }
    return [{ ...item, quantity: next }];
  }));

  const holdOrRestoreCart = () => {
    if (cart.length) {
      setHeldCart(storeHeldCart(user?.id ?? -1, cart));
      setCart([]);
      setDiscount("");
      setCashReceived("");
      toast.success("تم تعليق السلة مؤقتًا في هذه الجلسة.");
      return;
    }
    const saved = takeHeldCart(user?.id ?? -1);
    if (!saved.length) { toast.info("لا توجد سلة معلقة للاستعادة."); return; }
    setCart(saved);
    setHeldCart([]);
    toast.success("تمت استعادة السلة المعلقة.");
  };

  const startShift = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStartingShift(true);
    try {
      const result = await api<{ shift: Shift }>("/api/shifts", { method: "POST", body: JSON.stringify({ startingCash: floatValue || "0.00" }) });
      setData(current => current ? { ...current, shift: result.shift } : current);
      setShowFloatModal(false);
      toast.success("بدأت الوردية وتم تسجيل العهدة.");
    } catch (error) { toast.error(error instanceof PharmacyApiError ? error.message : "تعذر بدء الوردية."); }
    finally { setStartingShift(false); }
  };

  const checkout = useCallback(async () => {
    if (!cart.length) { toast.info("أضف صنفًا واحدًا على الأقل إلى السلة."); return; }
    if (!data?.shift) { setShowFloatModal(true); toast.error("يلزم بدء الوردية وإدخال العهدة قبل البيع."); return; }
    if (method === "cash" && tenderCents < totalCents) { toast.error("المبلغ المستلم أقل من إجمالي الفاتورة."); return; }
    const signature = JSON.stringify({ lines: cart.map(line => [line.key, line.quantity]), method, discount, cashReceived: method === "cash" ? cashReceived : null });
    if (pendingSignatureRef.current !== signature) {
      pendingSignatureRef.current = signature;
      pendingKeyRef.current = crypto.randomUUID();
    }
    setPaying(true);
    try {
      const result = await api<{ invoice: Invoice }>("/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: pendingKeyRef.current,
          items: cart.map(line => ({ ...(line.medicineId ? { medicineId: line.medicineId } : { serviceName: line.serviceName }), quantity: line.quantity })),
          method,
          discount: (discountCents / 100).toFixed(2),
          cashReceived: method === "cash" ? (tenderCents / 100).toFixed(2) : null,
        }),
      });
      setLastInvoice(result.invoice);
      setCart([]);
      setDiscount("");
      setCashReceived("");
      pendingKeyRef.current = "";
      pendingSignatureRef.current = "";
      toast.success("تمت الفاتورة وتحديث المخزون.");
      void loadPos();
    } catch (error) {
      if (error instanceof PharmacyApiError && error.code === "SHIFT_REQUIRED") setShowFloatModal(true);
      toast.error(error instanceof PharmacyApiError ? error.message : "تعذر إكمال البيع. يمكن إعادة المحاولة بأمان.");
    } finally { setPaying(false); }
  }, [cart, data?.shift, method, tenderCents, totalCents, discount, discountCents, cashReceived, loadPos]);

  const lockScreen = () => { setLocked(true); setUnlockPassword(""); };
  const unlock = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const result = await api<{ ok: boolean }>("/api/auth/verify-password", { method: "POST", body: JSON.stringify({ password: unlockPassword }) });
      if (!result.ok) { toast.error("كلمة المرور غير صحيحة."); return; }
      setLocked(false); setUnlockPassword("");
    } catch (error) { toast.error(error instanceof PharmacyApiError ? error.message : "تعذر التحقق من كلمة المرور."); }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (locked) return;
      if (event.key === "F2") { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key === "F4") { event.preventDefault(); holdOrRestoreCart(); }
      if (event.key === "F8") { event.preventDefault(); void checkout(); }
      if (event.key === "F9") { event.preventDefault(); navigate("/shifts"); }
      if (event.key === "F10") { event.preventDefault(); lockScreen(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, holdOrRestoreCart, checkout, navigate]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const source = activeTab === "popular" && !query.trim() ? data.popular : data.medicines;
    const term = query.trim().toLocaleLowerCase("ar");
    if (!term) return source;
    return data.medicines.filter(product => `${product.name} ${product.activeIngredient ?? ""} ${product.barcode ?? ""}`.toLocaleLowerCase("ar").includes(term)).slice(0, 30);
  }, [data, activeTab, query]);

  const onSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length) setSelectedResult(index => Math.max(0, Math.min(filtered.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (filtered.length) addProduct(filtered[Math.min(selectedResult, filtered.length - 1)]);
    else toast.info("لم يتم العثور على دواء بهذا الاسم أو الباركود.");
  };

  return (
    <div className="pos-page" dir="rtl">
      <header className="pos-heading">
        <div className="pos-heading-main"><img className="pos-heading-logo" src="/assets/logo.svg" alt="M Pharmacy" /><div><h1>نقطة البيع</h1><p>{data?.shift ? `الوردية #${data.shift.id} · بدأت ${new Intl.DateTimeFormat("ar", { hour: "2-digit", minute: "2-digit" }).format(new Date(data.shift.startTime))}` : "ابدأ ورديتك لتسجيل المبيعات"}</p></div></div>
        <div className="pos-hotkeys" aria-label="اختصارات لوحة المفاتيح">
          <button className="hotkey-chip" onClick={() => searchRef.current?.focus()}><kbd>F2</kbd><Search size={13} />بحث</button>
          <button className="hotkey-chip" onClick={holdOrRestoreCart}><kbd>F4</kbd><span>{cart.length ? "تعليق" : heldCart.length ? "استعادة" : "تعليق"}</span></button>
          <button className="hotkey-chip" onClick={() => void checkout()}><kbd>F8</kbd><span>دفع</span></button>
          <button className="hotkey-chip" onClick={() => navigate("/shifts")}><kbd>F9</kbd><span>وردية</span></button>
          <button className="hotkey-chip" onClick={lockScreen}><kbd>F10</kbd><LockKeyhole size={12} /></button>
        </div>
      </header>

      {!data?.shift && !loading && <div className="shift-required-banner"><span><ShieldCheck size={16} /> إدخال عهدة الصندوق وبدء الوردية مطلوب قبل إتمام أي بيع.</span><button className="button-primary button-sm" onClick={() => setShowFloatModal(true)}>بدء الوردية</button></div>}
      {expiryAlert && <div className="expiry-blocker" role="alert"><AlertTriangle size={19} /><div><h3>تم منع بيع دواء منتهي الصلاحية</h3><p>{expiryAlert}</p></div><button className="icon-action danger" onClick={() => setExpiryAlert("")} aria-label="إغلاق"><Trash2 size={16} /></button></div>}

      <div className="pos-workspace">
        <section className="pos-catalog" aria-label="البحث والكتالوج">
          <div className="pos-catalog-head"><div><h2>البحث عن منتج</h2><p>ابحث بالاسم أو المادة الفعالة أو امسح الباركود</p></div><span className="barcode-hint"><Barcode size={16} /> مسح سريع</span></div>
          <div className="pos-search-row"><label className="search-field pos-search"><Search size={19} /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onSearchKey} placeholder="ابحث عن دواء أو امسح الباركود…" aria-label="البحث عن دواء أو باركود" aria-controls="pos-product-results" aria-activedescendant={filtered[selectedResult] ? `catalog-result-${filtered[selectedResult].id}` : undefined} autoComplete="off" /><kbd>F2</kbd></label></div>
          <div className="catalog-tabs" role="tablist" aria-label="قائمة الأصناف">
            <button className={`catalog-tab ${activeTab === "popular" ? "active" : ""}`} role="tab" aria-selected={activeTab === "popular"} onClick={() => setActiveTab("popular")}>الأكثر طلبًا</button>
            <button className={`catalog-tab ${activeTab === "all" ? "active" : ""}`} role="tab" aria-selected={activeTab === "all"} onClick={() => setActiveTab("all")}>كل الأدوية</button>
          </div>
          <div className="catalog-label"><span>{query ? "نتائج البحث" : activeTab === "popular" ? "الأصناف الشائعة" : "كتالوج الأدوية"}</span><span>{loading ? "جارٍ التحميل…" : `${filtered.length} صنف`}</span></div>
          {loading ? <div className="no-results"><span className="loading-mark" /><span>جارٍ تحميل المخزون</span></div> : filtered.length ? (
            <div id="pos-product-results" className={query ? "catalog-results" : "product-grid"}>
              {filtered.map((product, index) => {
                const status = productStatus(product);
                return query ? (
                  <button id={`catalog-result-${product.id}`} key={product.id} className={`catalog-result ${index === selectedResult ? "keyboard-selected" : ""}`} onClick={() => addProduct(product)} disabled={status.className === "expired" || status.className === "out"}>
                    <span className="catalog-result-main"><b>{product.name}</b><small>{product.activeIngredient || product.barcode || "دواء"}</small></span>
                    <span className="catalog-result-side"><span className={`stock-badge ${status.className}`}>{status.label}</span><strong>{formatCurrency(product.price)}</strong><Plus size={16} /></span>
                  </button>
                ) : (
                  <button key={product.id} className={`product-card ${status.className}`} onClick={() => addProduct(product)} disabled={status.className === "expired" || status.className === "out"}>
                    <span className={`stock-badge ${status.className}`}>{status.label}</span><span className="product-card-name">{product.name}</span><span className="product-card-ingredient">{product.activeIngredient || "دواء"}</span>
                    <span className="product-card-bottom"><span className="product-card-price">{formatCurrency(product.price)}</span><Plus size={14} color="#8293a8" /></span>
                  </button>
                );
              })}
            </div>
          ) : <div className="no-results"><PackageSearch size={26} /><span>لا توجد منتجات مطابقة للبحث.</span></div>}

          {!query && <><div className="catalog-label" style={{ marginTop: 20 }}><span>خدمات سريعة</span><span>تضاف مباشرة إلى السلة</span></div><div className="product-grid service-grid">{(data?.services ?? []).map(service => <button key={service.name} className="quick-service-card" onClick={() => addService(service)}><span className="service-icon">{service.icon === "heart-pulse" ? <HeartPulse size={17} /> : <Bandage size={17} />}</span><b>{service.name}</b><small>{formatCurrency(service.price)} · خدمة</small></button>)}</div></>}
        </section>

        <section className="pos-cart" aria-label="سلة المبيعات">
          <div className="pos-cart-head"><div className="cart-title-wrap"><h2>السلة الحالية</h2><span className="cart-count">{totalItems}</span></div><button className="cart-clear" onClick={() => { setCart([]); setDiscount(""); setCashReceived(""); }} disabled={!cart.length}><Trash2 size={13} /> تفريغ</button></div>
          <div className="cart-lines">
            {!cart.length ? <div className="cart-empty"><span className="empty-icon"><Wallet size={22} /></span><b>السلة فارغة</b><p>اختر دواءً من الكتالوج أو ابحث عنه لإضافته إلى الفاتورة.</p>{heldCart.length > 0 && <button className="button-secondary button-sm" style={{ marginTop: 10 }} onClick={holdOrRestoreCart}>استعادة السلة المعلقة</button>}</div> : cart.map(line => <div className="cart-line" key={line.key}>
              <div className="cart-line-name" title={line.name}>{line.name}</div><div className="cart-line-price">{formatCurrency(line.price * line.quantity)}</div>
              <div className="cart-line-sub"><span>{formatCurrency(line.price)} للوحدة</span>{line.available != null && <span>· المتاح {line.available}</span>}</div>
              <div className="quantity-control"><button aria-label={`تقليل ${line.name}`} onClick={() => changeQuantity(line, -1)}><Minus size={12} /></button><b>{line.quantity}</b><button aria-label={`زيادة ${line.name}`} onClick={() => changeQuantity(line, 1)}><Plus size={12} /></button></div>
            </div>)}
          </div>

          <div className="cart-summary">
            <div className="cart-total-row"><span>المجموع الفرعي</span><strong>{formatCurrency(subtotal / 100)}</strong></div>
            <div className="cart-total-row"><span>الخصم</span><label className="discount-input"><input aria-label="قيمة الخصم بالدولار" type="number" min="0" step="0.01" value={discount} onChange={event => setDiscount(event.target.value)} placeholder="0.00" /><span>USD</span></label></div>
            <div className="cart-total-row total"><span>الإجمالي المستحق</span><strong>{formatCurrency(totalCents / 100)}</strong></div>
            <div className="payment-methods" role="group" aria-label="طريقة الدفع"><button className={`payment-method ${method === "cash" ? "active" : ""}`} onClick={() => setMethod("cash")}><Wallet size={15} /> نقدًا</button><button className={`payment-method ${method === "card" ? "active" : ""}`} onClick={() => setMethod("card")}><CreditCard size={15} /> بطاقة</button></div>
            {method === "cash" && <div className="cash-section"><label className="form-field"><span>المبلغ المستلم</span><input type="number" min="0" step="0.01" value={cashReceived} onChange={event => setCashReceived(event.target.value)} placeholder="0.00" aria-label="المبلغ النقدي المستلم" /></label><div className="cash-presets">{[20, 50, 100].map(amount => <button className="cash-preset" key={amount} onClick={() => setCashReceived(String(amount))}>${amount}</button>)}<button className="cash-preset" onClick={() => setCashReceived((totalCents / 100).toFixed(2))}>بالضبط</button></div><div className={`cash-change ${tenderCents < totalCents ? "insufficient" : ""}`}><span>{tenderCents >= totalCents ? "الباقي للعميل" : "المتبقي للدفع"}</span><strong>{formatCurrency(tenderCents >= totalCents ? changeCents / 100 : (totalCents - tenderCents) / 100)}</strong></div></div>}
            <button className="button-primary checkout-button" onClick={() => void checkout()} disabled={paying || !cart.length || !data?.shift}>{paying ? <span className="button-spinner" /> : <><Keyboard size={15} /><span>إتمام البيع</span><kbd>F8</kbd></>}</button>
            <div className="cart-footnote"><ShieldCheck size={13} /> يتحقق النظام من الصلاحية والمخزون قبل تسجيل البيع</div>
          </div>
        </section>
      </div>

      {showFloatModal && !data?.shift && <Modal title="بدء وردية جديدة" description="أدخل رصيد الصندوق الافتتاحي لتفعيل نقطة البيع." labelledBy="start-shift-title"><form onSubmit={startShift}><label className="form-field"><span>العهدة النقدية الافتتاحية (USD)</span><input type="number" min="0" step="0.01" required value={floatValue} onChange={event => setFloatValue(event.target.value)} placeholder="0.00" autoFocus /><small className="form-hint">يبدأ رصيد الصندوق من هذا المبلغ قبل تسجيل أي عملية بيع.</small></label><div className="modal-actions"><button className="button-primary" type="submit" disabled={startingShift}>{startingShift ? "جارٍ البدء…" : "بدء الوردية"}</button></div></form></Modal>}
      {lastInvoice && <Receipt invoice={lastInvoice} onClose={() => setLastInvoice(null)} />}
      {locked && <Modal title="الشاشة مقفلة" description={`هذه الوردية للمستخدم ${user?.name}. أدخل كلمة مرورك للمتابعة.`} labelledBy="lock-title"><div className="lock-icon-wrap"><LockKeyhole size={23} /></div><form onSubmit={unlock}><label className="form-field"><span>كلمة المرور</span><input type="password" value={unlockPassword} onChange={event => setUnlockPassword(event.target.value)} autoFocus autoComplete="current-password" /></label><div className="modal-actions"><button className="button-primary" type="submit">فتح الشاشة</button></div></form></Modal>}
    </div>
  );
}
