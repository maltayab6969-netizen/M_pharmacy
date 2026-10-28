import { useCallback, useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, BarChart3, CalendarDays, FileText, RefreshCw, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { api, formatCurrency, PharmacyApiError, todayUtcISO } from "@/lib/pharmacy-api";

const today = todayUtcISO();
const monthStart = `${today.slice(0, 8)}01`;
type Report = { from: string; to: string; revenue: string; invoiceCount: number; cost: string; grossProfit: string; top: Array<{ name: string; quantity: number; revenue: string }> };

export default function ReportsPage() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!from || !to || from > to) { toast.error("حدد نطاق تاريخ صحيحًا."); return; }
    setLoading(true);
    try { setReport(await api<Report>(`/api/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)); }
    catch (error) { toast.error(error instanceof PharmacyApiError ? error.message : "تعذر تحميل التقرير."); }
    finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);

  return <div dir="rtl">
    <div className="page-heading"><div><span className="eyebrow">أداء الصيدلية</span><h1>التقارير المالية</h1><p>ملخص مبيعات يعتمد على الفواتير المحفوظة وتكلفة الأصناف وقت البيع.</p></div><div className="page-actions"><button className="button-secondary" onClick={() => void load()}><RefreshCw size={15} /> تحديث التقرير</button></div></div>
    <section className="content-card"><div className="date-filter"><label className="form-field"><span>من تاريخ</span><input type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} /></label><label className="form-field"><span>إلى تاريخ</span><input type="date" value={to} min={from} max={today} onChange={event => setTo(event.target.value)} /></label><button className="button-primary" onClick={() => void load()}><CalendarDays size={15} /> تطبيق النطاق</button><span className="report-range-note">{from} — {to}</span></div></section>
    <section className="metrics-grid" style={{ marginTop: 14 }}>
      <Metric title="صافي الإيراد" value={report?.revenue} tone="blue" icon={<TrendingUp size={18} />} loading={loading} />
      <Metric title="عدد الفواتير" value={report ? String(report.invoiceCount) : undefined} tone="green" icon={<FileText size={18} />} loading={loading} />
      <Metric title="تكلفة الأصناف" value={report?.cost} tone="orange" icon={<BarChart3 size={18} />} loading={loading} />
      <Metric title="الربح الإجمالي" value={report?.grossProfit} tone="blue" icon={<TrendingUp size={18} />} loading={loading} />
    </section>
    <section className="content-card"><div className="content-card-heading"><div><h2>أكثر الأصناف والخدمات مبيعًا</h2><p>الترتيب بحسب الإيراد خلال النطاق المحدد.</p></div><BarChart3 size={18} color="#7890a8" /></div><div className="table-wrap"><table className="data-table"><thead><tr><th>الترتيب</th><th>الصنف / الخدمة</th><th>الكمية المباعة</th><th>الإيراد</th></tr></thead><tbody>{report?.top.map((item, index) => <tr key={item.name}><td><span className="status-pill neutral">{String(index + 1).padStart(2, "0")}</span></td><td><strong>{item.name}</strong></td><td>{item.quantity}</td><td dir="ltr" style={{ textAlign: "right" }}><strong>{formatCurrency(item.revenue)}</strong></td></tr>)}{(!report?.top.length) && <tr><td className="table-empty" colSpan={4}>{loading ? "جارٍ التحميل…" : "لا توجد فواتير في الفترة المحددة."}</td></tr>}</tbody></table></div><div className="report-footnote"><FileText size={14} /><span>تُحتسب التكلفة من القيمة المحفوظة في كل فاتورة؛ وتُخصم الحسومات من الإيراد قبل حساب الربح.</span></div></section>
  </div>;
}

function Metric({ title, value, tone, icon, loading }: { title: string; value?: string; tone: string; icon: React.ReactNode; loading: boolean }) {
  return <article className="metric-card"><div className="metric-card-head"><span>{title}</span><span className={`metric-icon ${tone}`}>{icon}</span></div><strong className="metric-value">{loading ? "—" : value?.startsWith("$") ? value : title === "عدد الفواتير" ? value ?? "0" : formatCurrency(value)}</strong><div className="metric-foot">يحسب حسب الفواتير المحفوظة</div></article>;
}
