import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, Download, Edit3, PackageSearch, Plus, Search, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, PharmacyApiError, todayUtcISO } from "@/lib/pharmacy-api";
import type { MedicineRow } from "@/lib/pharmacy-types";
import { usePharmacyAuth } from "@/contexts/PharmacyAuthContext";
import Modal from "@/components/Modal";

const emptyMedicine = { barcode: "", name: "", activeIngredient: "", categoryName: "", buyPrice: "", sellPrice: "", quantity: 0, expiryDate: "" };
type MedicineForm = typeof emptyMedicine;

function inventoryState(item: MedicineRow) {
  if (item.expiryDate < todayUtcISO()) return { label: "منتهي الصلاحية", className: "bad" };
  if (item.quantity <= 0) return { label: "نافد", className: "bad" };
  if (item.quantity < 10) return { label: "مخزون منخفض", className: "low" };
  const soon = new Date(); soon.setDate(soon.getDate() + 30);
  if (item.expiryDate <= soon.toISOString().slice(0, 10)) return { label: "قريب الصلاحية", className: "low" };
  return { label: "متوفر", className: "good" };
}

export default function InventoryPage() {
  const { user } = usePharmacyAuth();
  const [items, setItems] = useState<MedicineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<MedicineRow | null>(null);
  const [deactivating, setDeactivating] = useState<MedicineRow | null>(null);
  const [form, setForm] = useState<MedicineForm>(emptyMedicine);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const isAdmin = user?.role === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    try { const response = await api<{ medicines: MedicineRow[] }>("/api/medicines"); setItems(response.medicines); }
    catch (error) { toast.error(error instanceof PharmacyApiError ? error.message : "تعذر تحميل المخزون."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("ar");
    if (!term) return items;
    return items.filter(item => `${item.name} ${item.activeIngredient ?? ""} ${item.barcode ?? ""} ${item.categoryName ?? ""}`.toLocaleLowerCase("ar").includes(term));
  }, [items, search]);

  const openNew = () => { setEditing(null); setForm({ ...emptyMedicine }); setModalOpen(true); };
  const openEdit = (item: MedicineRow) => {
    setEditing(item); setModalOpen(true);
    setForm({ barcode: item.barcode ?? "", name: item.name, activeIngredient: item.activeIngredient ?? "", categoryName: item.categoryName ?? "", buyPrice: item.buyPrice ?? "0.00", sellPrice: item.sellPrice, quantity: item.quantity, expiryDate: item.expiryDate });
  };
  const saveMedicine = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true);
    try {
      const path = editing ? `/api/medicines/${editing.id}` : "/api/medicines";
      await api(path, { method: editing ? "PATCH" : "POST", body: JSON.stringify({ ...form, quantity: Number(form.quantity) }) });
      toast.success(editing ? "تم تحديث بيانات الدواء." : "تمت إضافة الدواء للمخزون.");
      setEditing(null); setForm({ ...emptyMedicine }); setModalOpen(false); await load();
    } catch (error) { toast.error(error instanceof PharmacyApiError ? error.message : "تعذر حفظ بيانات الدواء."); }
    finally { setSaving(false); }
  };
  const deactivate = async () => {
    if (!deactivating) return;
    try {
      await api(`/api/medicines/${deactivating.id}/deactivate`, { method: "POST", body: "{}" });
      toast.success("تمت أرشفة الدواء مع الحفاظ على الفواتير التاريخية."); setDeactivating(null); await load();
    } catch (error) { toast.error(error instanceof PharmacyApiError ? error.message : "تعذر أرشفة الدواء."); }
  };
  const exportReorder = async () => {
    try {
      const response = await fetch("/api/medicines/export.csv", { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("EXPORT_FAILED");
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = "m-pharmacy-reorder.csv"; link.click(); URL.revokeObjectURL(url); toast.success("تم تنزيل قائمة إعادة الطلب.");
    } catch { toast.error("تعذر تنزيل قائمة إعادة الطلب."); }
  };

  return <div dir="rtl">
    <div className="page-heading"><div><span className="eyebrow">إدارة الأصناف</span><h1>المخزون والأدوية</h1><p>تابع الكميات والأسعار والصلاحية، مع إبقاء السجل التاريخي للفواتير.</p></div><div className="page-actions">{isAdmin && <button className="button-secondary" onClick={exportReorder}><Download size={16} /> قائمة إعادة الطلب</button>}{isAdmin && <button className="button-primary" onClick={openNew}><Plus size={16} /> إضافة دواء</button>}</div></div>
    <section className="content-card">
      <div className="table-toolbar"><label className="search-field"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالاسم أو المادة الفعالة أو الباركود…" aria-label="البحث في المخزون" /></label><span className="table-count">{filtered.length} صنف</span></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>الدواء</th><th>الباركود</th><th>التصنيف</th><th>سعر البيع</th><th>الكمية</th><th>الصلاحية</th><th>الحالة</th>{isAdmin && <th>إجراءات</th>}</tr></thead><tbody>
        {filtered.map(item => { const state = inventoryState(item); return <tr key={item.id}><td><strong>{item.name}</strong><br /><small className="table-subtext">{item.activeIngredient || "—"}</small></td><td>{item.barcode || "—"}</td><td>{item.categoryName || "غير مصنف"}</td><td dir="ltr" style={{ textAlign: "right" }}>{Number(item.sellPrice).toFixed(2)} USD</td><td><span className="stock-cell"><b>{item.quantity}</b> وحدة</span></td><td>{new Intl.DateTimeFormat("ar", { dateStyle: "medium" }).format(new Date(`${item.expiryDate}T12:00:00`))}</td><td><span className={`status-pill ${state.className}`}><i />{state.label}</span></td>{isAdmin && <td><div className="table-actions"><button className="icon-action" onClick={() => openEdit(item)} title="تعديل" aria-label={`تعديل ${item.name}`}><Edit3 size={15} /></button><button className="icon-action danger" onClick={() => setDeactivating(item)} title="أرشفة" aria-label={`أرشفة ${item.name}`}><Trash2 size={15} /></button></div></td>}</tr>; })}
        {!filtered.length && <tr><td colSpan={isAdmin ? 8 : 7} className="table-empty">{loading ? "جارٍ تحميل الأدوية…" : "لا توجد أدوية مطابقة. أضف دواءً جديدًا أو غيّر البحث."}</td></tr>}
      </tbody></table></div>
      <div className="inventory-note"><ShieldCheck size={15} /><span>تُمنع الأدوية المنتهية من البيع آليًا، وتُحفظ بيانات الفواتير التاريخية عند أرشفة الصنف.</span></div>
    </section>

    {isAdmin && modalOpen && <MedicineModal form={form} setForm={setForm} editing={editing} saving={saving} onClose={() => { setModalOpen(false); setEditing(null); }} onSubmit={saveMedicine} />}
    {deactivating && <Modal title="أرشفة الدواء؟" description="لن يظهر الدواء في نقطة البيع بعد الأرشفة، وستظل الفواتير السابقة محفوظة." labelledBy="deactivate-medicine-title"><div className="confirm-content"><span className="confirm-icon"><AlertCircle size={19} /></span><span>هل تريد أرشفة <b>{deactivating.name}</b>؟ يمكن مراجعة سجله ضمن التقارير التاريخية.</span></div><div className="modal-actions"><button className="button-secondary" onClick={() => setDeactivating(null)}>إلغاء</button><button className="button-danger" onClick={() => void deactivate()}>أرشفة الدواء</button></div></Modal>}
  </div>;
}

function MedicineModal({ form, setForm, editing, saving, onClose, onSubmit }: { form: MedicineForm; setForm: (value: MedicineForm) => void; editing: MedicineRow | null; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const change = (key: keyof MedicineForm, value: string | number) => setForm({ ...form, [key]: value });
  return <Modal title={editing ? "تعديل دواء" : "إضافة دواء للمخزون"} description="أدخل بيانات واضحة حتى تظهر الشارات والتنبيهات بشكل صحيح." onClose={onClose} wide labelledBy="medicine-modal-title"><form onSubmit={onSubmit}><div className="form-grid">
    <label className="form-field"><span>اسم الدواء *</span><input required maxLength={150} value={form.name} onChange={event => change("name", event.target.value)} /></label>
    <label className="form-field"><span>المادة الفعالة</span><input maxLength={150} value={form.activeIngredient} onChange={event => change("activeIngredient", event.target.value)} /></label>
    <label className="form-field"><span>الباركود</span><input maxLength={64} value={form.barcode} onChange={event => change("barcode", event.target.value)} /></label>
    <label className="form-field"><span>التصنيف</span><input maxLength={100} value={form.categoryName} onChange={event => change("categoryName", event.target.value)} placeholder="مثال: مسكنات" /></label>
    <label className="form-field"><span>سعر الشراء (USD) *</span><input type="number" min="0" step="0.01" required value={form.buyPrice} onChange={event => change("buyPrice", event.target.value)} /></label>
    <label className="form-field"><span>سعر البيع (USD) *</span><input type="number" min="0" step="0.01" required value={form.sellPrice} onChange={event => change("sellPrice", event.target.value)} /></label>
    <label className="form-field"><span>الكمية الحالية *</span><input type="number" min="0" step="1" required value={form.quantity} onChange={event => change("quantity", Number(event.target.value))} /></label>
    <label className="form-field"><span>تاريخ انتهاء الصلاحية *</span><input type="date" required value={form.expiryDate} onChange={event => change("expiryDate", event.target.value)} /></label>
  </div><div className="modal-actions"><button className="button-secondary" type="button" onClick={onClose}>إلغاء</button><button className="button-primary" type="submit" disabled={saving}>{saving ? "جارٍ الحفظ…" : editing ? "حفظ التعديلات" : "إضافة الدواء"}</button></div></form></Modal>;
}
