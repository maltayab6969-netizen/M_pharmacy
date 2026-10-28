import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, ArrowLeft, BarChart3, Clock3, PackageSearch, ShieldCheck, ShoppingBag, TriangleAlert } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { api, formatCurrency, PharmacyApiError } from "@/lib/pharmacy-api";

type Summary = { today: string; yesterday: string; salesChangePercent: number | null; lowStock: number; expiringSoon: number; expired: number; openShifts: number };
type AuditRow = { id: number; action: string; targetType: string; targetId: string | null; createdAt: string; actor: string | null };
const actionNames: Record<string, string> = { medicine_created: "إضافة دواء", medicine_updated: "تعديل بيانات دواء", medicine_deactivated: "أرشفة دواء", user_created: "إضافة مستخدم", user_role_changed: "تغيير دور مستخدم", user_activated: "تفعيل مستخدم", user_deactivated: "تعطيل مستخدم", user_password_reset: "إعادة تعيين كلمة مرور", shift_opened: "بدء وردية", shift_closed: "إغلاق وردية", password_changed: "تغيير كلمة المرور" };

export default function DashboardPage() {
  const [, navigate] = useLocation();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [metrics, activity] = await Promise.all([api<Summary>("/api/dashboard"), api<{ log: AuditRow[] }>("/api/audit")]);
      setSummary(metrics); setAudit(activity.log);
    } catch (error) { toast.error(error instanceof PharmacyApiError ? error.message : "تعذر تحميل لوحة المؤشرات."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const metrics = summary;
  const change = metrics?.salesChangePercent ?? 0;
  const maxSales = Math.max(Number(metrics?.today || 0), Number(metrics?.yesterday || 0), 1);
  const todayHeight = Math.max(8, Number(metrics?.today || 0) / maxSales * 100);
  const yesterdayHeight = Math.max(8, Number(metrics?.yesterday || 0) / maxSales * 100);

  return <div dir="rtl">
    <div className="page-heading"><div><span className="eyebrow">نظرة عامة</span><h1>صباح الخير، مساحة الصيدلية جاهزة</h1><p>تابع حركة البيع والمخزون والورديات من مكان واحد.</p></div><div className="page-actions"><button className="button-secondary" onClick={() => navigate("/inventory")}><PackageSearch size={16} /> المخزون</button><button className="button-primary" onClick={() => navigate("/")}><ShoppingBag size={16} /> فتح نقطة البيع</button></div></div>
    <section className="metrics-grid" aria-label="مؤشرات اليوم">
      <Metric icon={<ShoppingBag size={18} />} tone="blue" label="مبيعات اليوم" value={loading ? "—" : formatCurrency(metrics?.today)} foot={metrics?.salesChangePercent == null ? "لا توجد مقارنة أمس" : `${Math.abs(change)}% ${change >= 0 ? "أعلى" : "أقل"} من أمس`} direction={metrics?.salesChangePercent == null ? "neutral" : change >= 0 ? "positive" : "negative"} trend={change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />} />
      <Metric icon={<PackageSearch size={18} />} tone="orange" label="أصناف تحتاج متابعة" value={loading ? "—" : String((metrics?.lowStock ?? 0) + (metrics?.expiringSoon ?? 0) + (metrics?.expired ?? 0))} foot={`${metrics?.lowStock ?? 0} منخفض · ${metrics?.expiringSoon ?? 0} قريب الصلاحية`} direction="neutral" />
      <Metric icon={<Activity size={18} />} tone="green" label="الورديات المفتوحة" value={loading ? "—" : String(metrics?.openShifts ?? 0)} foot="النشاط الجاري في الصيدلية" direction="neutral" />
      <Metric icon={<TriangleAlert size={18} />} tone="red" label="أدوية منتهية" value={loading ? "—" : String(metrics?.expired ?? 0)} foot="تُمنع تلقائيًا من البيع" direction="negative" />
    </section>

    <div className="report-top">
      <section className="content-card"><div className="content-card-heading"><div><h2>مقارنة المبيعات</h2><p>إجمالي المبيعات المسجلة لكل يوم</p></div><BarChart3 size={18} color="#7a91aa" /></div>
        <div className="chart-placeholder" role="img" aria-label={`مبيعات اليوم ${formatCurrency(metrics?.today)} ومبيعات أمس ${formatCurrency(metrics?.yesterday)}`}>
          <div className="chart-bar-wrap"><strong>{formatCurrency(metrics?.yesterday)}</strong><span className="chart-bar" style={{ height: `${yesterdayHeight}%`, opacity: .48 }} /><span>أمس</span></div>
          <div className="chart-bar-wrap"><strong>{formatCurrency(metrics?.today)}</strong><span className="chart-bar" style={{ height: `${todayHeight}%` }} /><span>اليوم</span></div>
        </div>
        <div className="metric-foot" style={{ marginTop: 12 }}>{metrics?.salesChangePercent == null ? "ستظهر المقارنة بعد تسجيل المبيعات." : <><span className={change >= 0 ? "metric-foot positive" : "metric-foot negative"}>{change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(change)}%</span><span>مقارنة بإجمالي أمس</span></>}</div>
      </section>
      <section className="content-card"><div className="content-card-heading"><div><h2>تنبيهات تتطلب الانتباه</h2><p>الأصناف التي قد تحتاج إجراءً اليوم</p></div><AlertTriangle size={18} color="#c18b2f" /></div>
        <div className="attention-list">
          <Attention icon={<PackageSearch size={17} />} tone="orange" title="مخزون منخفض أو نافد" count={metrics?.lowStock ?? 0} detail="راجِع الكميات وأعد طلب الأصناف اللازمة." onClick={() => navigate("/inventory")} />
          <Attention icon={<Clock3 size={17} />} tone="orange" title="صلاحية قريبة" count={metrics?.expiringSoon ?? 0} detail="أصناف تنتهي صلاحيتها خلال 30 يومًا." onClick={() => navigate("/inventory")} />
          <Attention icon={<ShieldCheck size={17} />} tone="red" title="أصناف منتهية" count={metrics?.expired ?? 0} detail="محجوبة عن نقطة البيع حتى أرشفتها." onClick={() => navigate("/inventory")} />
        </div>
      </section>
    </div>

    <section className="content-card" style={{ marginTop: 14 }}><div className="content-card-heading"><div><h2>آخر إجراءات الإدارة</h2><p>سجل تدقيق للحفاظ على وضوح التغييرات</p></div><button className="button-quiet" onClick={load}><Activity size={15} /> تحديث</button></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>الإجراء</th><th>النوع</th><th>المستخدم</th><th>الوقت</th></tr></thead><tbody>
        {audit.length ? audit.slice(0, 8).map(row => <tr key={row.id}><td><strong>{actionNames[row.action] || row.action}</strong></td><td>{row.targetType === "medicine" ? "دواء" : row.targetType === "user" ? "مستخدم" : row.targetType === "shift" ? "وردية" : "حساب"}{row.targetId ? ` #${row.targetId}` : ""}</td><td>{row.actor || "النظام"}</td><td>{new Intl.DateTimeFormat("ar", { dateStyle: "short", timeStyle: "short" }).format(new Date(row.createdAt))}</td></tr>) : <tr><td colSpan={4} className="table-empty">{loading ? "جارٍ التحميل…" : "لا توجد إجراءات مسجلة بعد."}</td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}

function Metric({ icon, tone, label, value, foot, direction, trend }: { icon: React.ReactNode; tone: string; label: string; value: string; foot: string; direction: "positive" | "negative" | "neutral"; trend?: React.ReactNode }) {
  return <article className="metric-card"><div className="metric-card-head"><span>{label}</span><span className={`metric-icon ${tone}`}>{icon}</span></div><strong className="metric-value">{value}</strong><div className={`metric-foot ${direction}`}>{trend}{foot}</div></article>;
}

function Attention({ icon, tone, title, count, detail, onClick }: { icon: React.ReactNode; tone: string; title: string; count: number; detail: string; onClick: () => void }) {
  return <button className="attention-row" onClick={onClick}><span className={`metric-icon ${tone}`}>{icon}</span><span className="attention-copy"><b>{title}</b><small>{detail}</small></span><strong>{count}</strong><ArrowLeft size={15} /></button>;
}
