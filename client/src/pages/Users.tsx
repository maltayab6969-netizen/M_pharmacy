import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { KeyRound, Plus, Search, Shield, UserCheck, UserPlus, UserRound, UserX, Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { api, PharmacyApiError } from "@/lib/pharmacy-api";
import { usePharmacyAuth } from "@/contexts/PharmacyAuthContext";
import Modal from "@/components/Modal";

type Staff = { id: number; name: string | null; username: string | null; role: "admin" | "pharmacist" | "user"; isActive: boolean; createdAt: string };
const emptyUser = { name: "", username: "", password: "", role: "pharmacist" as "admin" | "pharmacist" };

export default function UsersPage() {
  const { user } = usePharmacyAuth();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyUser });
  const [saving, setSaving] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<Staff | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [activeTarget, setActiveTarget] = useState<Staff | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const response = await api<{ users: Staff[] }>("/api/users"); setStaff(response.users); }
    catch (error) { toast.error(error instanceof PharmacyApiError ? error.message : "تعذر تحميل المستخدمين."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("ar");
    return !term ? staff : staff.filter(item => `${item.name ?? ""} ${item.username ?? ""} ${item.role}`.toLocaleLowerCase("ar").includes(term));
  }, [staff, search]);

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true);
    try {
      await api("/api/users", { method: "POST", body: JSON.stringify(form) });
      toast.success("تم إنشاء حساب المستخدم. لن تظهر كلمة المرور مجددًا."); setCreateOpen(false); setForm({ ...emptyUser }); await load();
    } catch (error) { toast.error(error instanceof PharmacyApiError ? error.message : "تعذر إنشاء المستخدم."); }
    finally { setSaving(false); }
  };
  const changeRole = async (target: Staff, role: "admin" | "pharmacist") => {
    if (target.role === role) return;
    try { await api(`/api/users/${target.id}/role`, { method: "PATCH", body: JSON.stringify({ role }) }); toast.success("تم تحديث دور المستخدم."); await load(); }
    catch (error) { toast.error(error instanceof PharmacyApiError ? error.message : "تعذر تحديث الدور."); }
  };
  const savePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!passwordTarget) return; setSaving(true);
    try { await api(`/api/users/${passwordTarget.id}/password`, { method: "PATCH", body: JSON.stringify({ password: newPassword }) }); toast.success("تم تغيير كلمة المرور وإنهاء الجلسات السابقة."); setPasswordTarget(null); setNewPassword(""); await load(); }
    catch (error) { toast.error(error instanceof PharmacyApiError ? error.message : "تعذر تغيير كلمة المرور."); }
    finally { setSaving(false); }
  };
  const toggleActive = async () => {
    if (!activeTarget) return; const next = !activeTarget.isActive;
    try { await api(`/api/users/${activeTarget.id}/active`, { method: "PATCH", body: JSON.stringify({ isActive: next }) }); toast.success(next ? "تم تفعيل الحساب." : "تم تعطيل الحساب وإلغاء جلساته."); setActiveTarget(null); await load(); }
    catch (error) { toast.error(error instanceof PharmacyApiError ? error.message : "تعذر تحديث حالة الحساب."); }
  };

  return <div dir="rtl">
    <div className="page-heading"><div><span className="eyebrow">الفريق والصلاحيات</span><h1>إدارة المستخدمين</h1><p>أدر حسابات الفريق مع أدوار واضحة ودون حذف السجلات التاريخية.</p></div><div className="page-actions"><button className="button-primary" onClick={() => setCreateOpen(true)}><UserPlus size={16} /> إضافة مستخدم</button></div></div>
    <section className="content-card"><div className="table-toolbar"><label className="search-field"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالاسم أو اسم المستخدم…" aria-label="البحث عن مستخدم" /></label><span className="table-count">{filtered.length} حساب</span></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>المستخدم</th><th>اسم الدخول</th><th>الدور</th><th>الحالة</th><th>تاريخ الإضافة</th><th>إجراءات</th></tr></thead><tbody>{filtered.map(item => <tr key={item.id}><td><span className="staff-name"><span className="user-avatar small-avatar">{(item.name || item.username || "م").slice(0, 1)}</span><strong>{item.name || "مستخدم"}{item.id === user?.id && <small> (أنت)</small>}</strong></span></td><td>{item.username || "حساب نظام"}</td><td><label className="role-select-label"><Shield size={13} /><select aria-label={`دور ${item.name}`} value={item.role === "user" ? "pharmacist" : item.role} disabled={!item.isActive} onChange={event => void changeRole(item, event.target.value as "admin" | "pharmacist")}><option value="admin">مدير</option><option value="pharmacist">صيدلي</option></select></label></td><td><span className={`status-pill ${item.isActive ? "good" : "neutral"}`}>{item.isActive ? "نشط" : "معطل"}</span></td><td>{new Intl.DateTimeFormat("ar", { dateStyle: "medium" }).format(new Date(item.createdAt))}</td><td><div className="table-actions"><button className="icon-action" title="إعادة تعيين كلمة المرور" aria-label="إعادة تعيين كلمة المرور" onClick={() => { setPasswordTarget(item); setNewPassword(""); }}><KeyRound size={15} /></button><button className={`icon-action ${item.isActive ? "danger" : ""}`} title={item.isActive ? "تعطيل الحساب" : "تفعيل الحساب"} aria-label={item.isActive ? "تعطيل الحساب" : "تفعيل الحساب"} disabled={item.id === user?.id} onClick={() => setActiveTarget(item)}>{item.isActive ? <UserX size={15} /> : <UserCheck size={15} />}</button></div></td></tr>)}{!filtered.length && <tr><td className="table-empty" colSpan={6}>{loading ? "جارٍ تحميل المستخدمين…" : "لا توجد حسابات مطابقة."}</td></tr>}</tbody></table></div>
      <div className="rbac-note"><Shield size={15} /><span><b>المدير:</b> التحليلات والمستخدمون والأسعار وتدقيق الورديات. <b>الصيدلي:</b> نقطة البيع والورديات النشطة وعرض المخزون فقط.</span></div>
    </section>

    {createOpen && <Modal title="إضافة حساب للفريق" description="كلمة المرور تظهر مرة واحدة فقط بعد الإنشاء؛ يفضّل أن يغيّرها المستخدم بعد أول دخول." onClose={() => setCreateOpen(false)} labelledBy="create-user-title"><form onSubmit={createUser}><div className="form-grid"><label className="form-field span-two"><span>الاسم الكامل *</span><input required minLength={2} maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><label className="form-field span-two"><span>اسم المستخدم *</span><input required minLength={3} maxLength={50} autoComplete="off" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} /><small className="form-hint">حروف أو أرقام أو . أو _ أو -</small></label><label className="form-field span-two"><span>كلمة مرور مؤقتة (12 محرفًا على الأقل) *</span><input required minLength={12} type="password" autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></label><label className="form-field span-two"><span>الدور *</span><select value={form.role} onChange={event => setForm({ ...form, role: event.target.value as "admin" | "pharmacist" })}><option value="pharmacist">صيدلي</option><option value="admin">مدير</option></select></label></div><div className="modal-actions"><button className="button-secondary" type="button" onClick={() => setCreateOpen(false)}>إلغاء</button><button className="button-primary" type="submit" disabled={saving}>{saving ? "جارٍ الإنشاء…" : "إنشاء الحساب"}</button></div></form></Modal>}
    {passwordTarget && <Modal title={`تغيير كلمة مرور ${passwordTarget.name || passwordTarget.username}`} description="سيتم إنهاء جلسات الحساب الحالية عند الحفظ." onClose={() => setPasswordTarget(null)} labelledBy="reset-password-title"><form onSubmit={savePassword}><label className="form-field"><span>كلمة المرور الجديدة *</span><input type="password" required minLength={12} maxLength={256} autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoFocus /><small className="form-hint">12 محرفًا على الأقل.</small></label><div className="modal-actions"><button className="button-secondary" type="button" onClick={() => setPasswordTarget(null)}>إلغاء</button><button className="button-primary" type="submit" disabled={saving}>{saving ? "جارٍ الحفظ…" : "حفظ كلمة المرور"}</button></div></form></Modal>}
    {activeTarget && <Modal title={activeTarget.isActive ? "تعطيل الحساب؟" : "إعادة تفعيل الحساب؟"} description={activeTarget.isActive ? "سيُمنع المستخدم من الدخول وتُلغى جلساته، مع إبقاء أثره التاريخي." : "سيتمكن المستخدم من الدخول بالدور وكلمة المرور المحفوظين."} onClose={() => setActiveTarget(null)} labelledBy="toggle-user-title"><div className="confirm-content"><span className="confirm-icon"><UsersIcon size={18} /></span><span>الحساب: <b>{activeTarget.name || activeTarget.username}</b></span></div><div className="modal-actions"><button className="button-secondary" onClick={() => setActiveTarget(null)}>إلغاء</button><button className="button-primary" onClick={() => void toggleActive()}>{activeTarget.isActive ? "تعطيل الحساب" : "إعادة التفعيل"}</button></div></Modal>}
  </div>;
}
