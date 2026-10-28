import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Activity, Archive, Banknote, CheckCircle2, CircleDollarSign, Clock3, CreditCard, Download, FileText, Printer, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "sonner";
import { api, formatCurrency, PharmacyApiError } from "@/lib/pharmacy-api";
import { usePharmacyAuth } from "@/contexts/PharmacyAuthContext";
import Modal from "@/components/Modal";

type Shift = { id: number; userId: number; cashier?: string | null; username?: string | null; startTime: string | Date; endTime: string | Date | null; startingCash: string; expectedCash: string | null; actualCash: string | null; cashDifference: string | null; status: "open" | "closed" };
type ShiftDetail = { shift: Shift; cash: { count: number; total: string }; card: { count: number; total: string }; total: string; expectedCash: string };
type ShiftList = { current: Shift | null; history: Shift[] };

type ZRecord = { shift: Shift; cash: { count: number; total: string }; card: { count: number; total: string }; expectedCash: string; actualCash: string; difference: string };

function dateTime(value: string | Date | null) {
  return value ? new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}
function cents(value: string | number | null | undefined) { return Math.round(Number(value ?? 0) * 100); }
function asMoney(value: number) { return formatCurrency(value / 100); }

export default function ShiftsPage() {
  const { user } = usePharmacyAuth();
  const isAdmin = user?.role === "admin";
  const [data, setData] = useState<ShiftList | null>(null);
  const [detail, setDetail] = useState<ShiftDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [floatValue, setFloatValue] = useState("");
  const [actualCash, setActualCash] = useState("");
  const [starting, setStarting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closingShift, setClosingShift] = useState<Shift | null>(null);
  const [zRecord, setZRecord] = useState<ZRecord | null>(null);
  const [zModal, setZModal] = useState(false);
  const [floatModal, setFloatModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<ShiftList>("/api/shifts"); setData(result);
      if (result.current) {
        try { setDetail(await api<ShiftDetail>(`/api/shifts/${result.current.id}`)); }
        catch { setDetail(null); }
      } else setDetail(null);
    } catch (error) { toast.error(error instanceof PharmacyApiError ? error.message : "تعذر تحميل الورديات."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openShift = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setStarting(true);
    try {
      await api("/api/shifts", { method: "POST", body: JSON.stringify({ startingCash: floatValue || "0.00" }) });
      setFloatModal(false); setFloatValue(""); toast.success("تم بدء الوردية وتسجيل العهدة."); await load();
    } catch (error) { toast.error(error instanceof PharmacyApiError ? error.message : "تعذر بدء الوردية."); }
    finally { setStarting(false); }
  };

  const chooseClose = async (shift: Shift) => {
    try {
      const info = await api<ShiftDetail>(`/api/shifts/${shift.id}`);
      setDetail(info); setClosingShift(info.shift); setActualCash(info.expectedCash);
    } catch (error) { toast.error(error instanceof PharmacyApiError ? error.message : "تعذر تحميل ملخص الوردية."); }
  };

  const expectedCents = closingShift ? (detail?.shift.id === closingShift.id ? cents(detail.expectedCash) : cents(closingShift.startingCash)) : 0;
  const actualCents = cents(actualCash);
  const variance = actualCents - expectedCents;

  const downloadBackup = async (url: string) => {
    try {
      const response = await fetch(url, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("BACKUP_FAILED");
      const blob = await response.blob(); const objectUrl = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = objectUrl; anchor.download = `m-pharmacy-backup-${new Date().toISOString().slice(0, 10)}.sql.gz`; anchor.click(); URL.revokeObjectURL(objectUrl);
      toast.success("تم تنزيل النسخة الاحتياطية المضغوطة.");
    } catch { toast.error("أُغلقت الوردية، لكن تعذر تنزيل النسخة. استخدم زر التنزيل في سجل الوردية."); }
  };

  const closeShift = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!closingShift) return;
    setClosing(true);
    try {
      const result = await api<{ shift: Shift; backupUrl: string | null; summary: { cash: { count: number; total: string }; card: { count: number; total: string }; expectedCash: string } }>(`/api/shifts/${closingShift.id}/close`, { method: "POST", body: JSON.stringify({ actualCash: actualCash || "0.00" }) });
      const record: ZRecord = { shift: result.shift, cash: result.summary.cash, card: result.summary.card, expectedCash: result.summary.expectedCash, actualCash: String(result.shift.actualCash ?? actualCash), difference: String(result.shift.cashDifference ?? "0.00") };
      setZRecord(record); setZModal(true); setClosingShift(null); toast.success("تم إغلاق الوردية وحفظ المطابقة.");
      await load();
      if (result.backupUrl) void downloadBackup(result.backupUrl);
    } catch (error) { toast.error(error instanceof PharmacyApiError ? error.message : "تعذر إغلاق الوردية."); }
    finally { setClosing(false); }
  };

  const viewZ = async (shift: Shift) => {
    try {
      const info = await api<ShiftDetail>(`/api/shifts/${shift.id}`);
      setZRecord({ shift: info.shift, cash: info.cash, card: info.card, expectedCash: info.expectedCash, actualCash: String(info.shift.actualCash ?? "0.00"), difference: String(info.shift.cashDifference ?? "0.00") }); setZModal(true);
    } catch (error) { toast.error(error instanceof PharmacyApiError ? error.message : "تعذر عرض تقرير الوردية."); }
  };

  const history = data?.history ?? [];
  const current = data?.current ?? null;
  const downloadRowBackup = (id: number) => void downloadBackup(`/api/backups/shifts/${id}.sql.gz`);
  const tableCount = useMemo(() => history.length, [history.length]);

  return <div dir="rtl">
    <div className="page-heading"><div><span className="eyebrow">النقد والمطابقة</span><h1>الورديات</h1><p>سجّل العهدة، راقب النقد والبطاقة، وأغلق الصندوق بتقرير واضح.</p></div><div className="page-actions"><button className="button-secondary" onClick={() => void load()}><RefreshCw size={15} /> تحديث</button>{!current && <button className="button-primary" onClick={() => setFloatModal(true)}><Activity size={16} /> بدء وردية</button>}</div></div>

    {current && <section className="content-card current-shift-card"><div className="content-card-heading"><div><h2><span className="status-pill good"><i /> وردية نشطة</span> <span>الوردية #{current.id}</span></h2><p>بدأت {dateTime(current.startTime)} · {user?.name}</p></div><button className="button-primary" onClick={() => void chooseClose(current)}><CheckCircle2 size={16} /> إغلاق الوردية</button></div>
      <div className="shift-summary-grid"><div className="shift-summary-tile"><span>العهدة الافتتاحية</span><b>{formatCurrency(current.startingCash)}</b></div><div className="shift-summary-tile"><span>مبيعات نقدية</span><b>{detail ? formatCurrency(detail.cash.total) : "—"}</b></div><div className="shift-summary-tile"><span>مبيعات بطاقة</span><b>{detail ? formatCurrency(detail.card.total) : "—"}</b></div><div className="shift-summary-tile"><span>النقد المتوقع</span><b>{detail ? formatCurrency(detail.expectedCash) : "—"}</b></div></div>
      <div className="shift-inline-note"><ShieldCheck size={15} /> النقد المتوقع يضم العهدة ومبيعات النقد فقط؛ مدفوعات البطاقة لا تدخل في رصيد الصندوق.</div>
    </section>}

    {!current && <section className="content-card shift-empty-card"><span className="shift-empty-icon"><Wallet size={22} /></span><div><h2>لا توجد وردية نشطة</h2><p>يجب إدخال العهدة الافتتاحية قبل البيع. يمكنك بدء وردية جديدة الآن.</p></div>{!floatModal && <button className="button-primary" onClick={() => setFloatModal(true)}>بدء الوردية</button>}</section>}

    <section className="content-card" style={{ marginTop: 14 }}><div className="content-card-heading"><div><h2>{isAdmin ? "سجل الورديات" : "الوردية الحالية"}</h2><p>{isAdmin ? "مراجعة النشاط والإغلاقات والفروقات المسجلة." : "للحفاظ على الخصوصية، يعرض حساب الصيدلي الورديات النشطة فقط."}</p></div><span className="status-pill neutral">{tableCount} سجل</span></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>الوردية</th>{isAdmin && <th>الصيدلي</th>}<th>البداية</th><th>النهاية</th><th>العهدة</th><th>المتوقع</th><th>الفعلي</th><th>الحالة</th><th>التقرير</th></tr></thead><tbody>
        {history.map(shift => <tr key={shift.id}><td><strong>#{shift.id}</strong></td>{isAdmin && <td>{shift.cashier || shift.username || `مستخدم #${shift.userId}`}</td>}<td>{dateTime(shift.startTime)}</td><td>{dateTime(shift.endTime)}</td><td dir="ltr" style={{ textAlign: "right" }}>{formatCurrency(shift.startingCash)}</td><td dir="ltr" style={{ textAlign: "right" }}>{shift.expectedCash == null ? "—" : formatCurrency(shift.expectedCash)}</td><td dir="ltr" style={{ textAlign: "right" }}>{shift.actualCash == null ? "—" : formatCurrency(shift.actualCash)}</td><td><span className={`status-pill ${shift.status === "open" ? "good" : "neutral"}`}>{shift.status === "open" ? "نشطة" : "مغلقة"}</span></td><td><div className="table-actions">{shift.status === "open" ? <button className="button-quiet button-sm" onClick={() => void chooseClose(shift)}><CheckCircle2 size={14} /> إغلاق</button> : <button className="icon-action" title="عرض تقرير Z" aria-label="عرض تقرير Z" onClick={() => void viewZ(shift)}><FileText size={15} /></button>}{isAdmin && shift.status === "closed" && <button className="icon-action" title="تنزيل نسخة SQL gzip" aria-label="تنزيل النسخة الاحتياطية" onClick={() => downloadRowBackup(shift.id)}><Download size={15} /></button>}</div></td></tr>)}
        {!history.length && <tr><td className="table-empty" colSpan={isAdmin ? 9 : 8}>{loading ? "جارٍ التحميل…" : "لا توجد سجلات ورديات حتى الآن."}</td></tr>}
      </tbody></table></div>
    </section>

    {floatModal && <Modal title="بدء وردية جديدة" description="العهدة الافتتاحية مطلوبة لتفعيل الصندوق." onClose={() => setFloatModal(false)} labelledBy="float-modal-title"><form onSubmit={openShift}><label className="form-field"><span>العهدة النقدية (USD) *</span><input type="number" min="0" step="0.01" required value={floatValue} onChange={event => setFloatValue(event.target.value)} placeholder="0.00" autoFocus /><small className="form-hint">يبدأ احتساب النقد المتوقع من هذا الرصيد.</small></label><div className="modal-actions"><button className="button-secondary" type="button" onClick={() => setFloatModal(false)}>إلغاء</button><button className="button-primary" disabled={starting}>{starting ? "جارٍ البدء…" : "بدء الوردية"}</button></div></form></Modal>}

    {closingShift && <Modal title={`إغلاق الوردية #${closingShift.id}`} description="أدخل النقد الفعلي في الصندوق لمراجعة الفارق قبل الإغلاق." onClose={() => setClosingShift(null)} labelledBy="close-shift-modal-title"><div className="shift-summary-grid"><div className="shift-summary-tile"><span>مبيعات نقدية</span><b>{detail?.shift.id === closingShift.id ? formatCurrency(detail.cash.total) : "—"}</b></div><div className="shift-summary-tile"><span>مبيعات بطاقة</span><b>{detail?.shift.id === closingShift.id ? formatCurrency(detail.card.total) : "—"}</b></div></div><form onSubmit={closeShift}><label className="form-field"><span>النقد الفعلي في الصندوق (USD) *</span><input type="number" min="0" step="0.01" required value={actualCash} onChange={event => setActualCash(event.target.value)} autoFocus /></label><div className={`cash-variance ${variance === 0 ? "positive" : variance < 0 ? "negative" : ""}`}><span>الفرق عن المتوقع · المتوقع {asMoney(expectedCents)}</span><strong>{variance > 0 ? "+" : ""}{asMoney(variance)}</strong></div><div className="modal-actions"><button type="button" className="button-secondary" onClick={() => setClosingShift(null)}>إلغاء</button><button className="button-primary" disabled={closing}>{closing ? "جارٍ الإغلاق…" : "تأكيد الإغلاق وإصدار Z"}</button></div></form></Modal>}

    {zModal && zRecord && <Modal title={`تقرير Z · الوردية #${zRecord.shift.id}`} description="ملخص قابل للطباعة لمطابقة نهاية الوردية." onClose={() => setZModal(false)} labelledBy="z-report-modal-title"><article className="printable-receipt" dir="rtl"><header className="receipt-brand"><img src="/assets/logo.svg" alt="M Pharmacy" /><strong>M Pharmacy</strong><small>تقرير إغلاق الوردية · Z-Report</small></header><div className="receipt-meta"><div><span>رقم الوردية</span><b>#{zRecord.shift.id}</b></div><div><span>الصيدلي</span><b>{zRecord.shift.cashier || user?.name}</b></div><div><span>بدأت</span><b>{dateTime(zRecord.shift.startTime)}</b></div><div><span>أغلقت</span><b>{dateTime(zRecord.shift.endTime)}</b></div></div><table className="receipt-items"><tbody><tr><td>العهدة</td><td>{formatCurrency(zRecord.shift.startingCash)}</td></tr><tr><td>مبيعات نقدية ({zRecord.cash.count})</td><td>{formatCurrency(zRecord.cash.total)}</td></tr><tr><td>مبيعات بطاقة ({zRecord.card.count})</td><td>{formatCurrency(zRecord.card.total)}</td></tr><tr><td>النقد المتوقع</td><td>{formatCurrency(zRecord.expectedCash)}</td></tr><tr><td>النقد الفعلي</td><td>{formatCurrency(zRecord.actualCash)}</td></tr><tr><td><b>الفرق</b></td><td><b>{formatCurrency(zRecord.difference)}</b></td></tr></tbody></table><div className="receipt-total"><div className="grand"><span>حالة الوردية</span><b>مغلقة</b></div></div><div className="receipt-qr"><small>تم حفظ سجل المطابقة في النظام</small></div></article><div className="receipt-actions"><button className="button-secondary" onClick={() => setZModal(false)}>إغلاق</button><button className="button-primary" onClick={() => window.print()}><Printer size={16} /> طباعة Z</button></div><div className="backup-note"><Archive size={14} /><span>يُنزّل المدير نسخة SQL مضغوطة بعد الإغلاق لحفظها خارج النظام.</span></div></Modal>}
  </div>;
}
