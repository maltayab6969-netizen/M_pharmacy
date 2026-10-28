import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { PharmacyApiError } from "@/lib/pharmacy-api";
import { usePharmacyAuth } from "@/contexts/PharmacyAuthContext";

export default function LoginPage() {
  const { user, loading, setupRequired, login } = usePharmacyAuth();
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && user) navigate("/");
  }, [loading, user, navigate]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (setupRequired) {
      setError("لم يتم تهيئة مدير النظام. يرجى التواصل مع مالك الموقع لإكمال الإعداد الآمن.");
      return;
    }
    setSubmitting(true);
    try {
      await login(username.trim(), password, remember);
      toast.success("تم تسجيل الدخول بنجاح.");
      navigate("/");
    } catch (cause) {
      const message = cause instanceof PharmacyApiError ? cause.message : "تعذر تسجيل الدخول الآن. تحقق من الاتصال وحاول مجددًا.";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page" dir="rtl">
      <section className="login-brand-panel">
        <div className="login-brand-top"><img src="/assets/logo.svg" alt="شعار M Pharmacy" /><span>M PHARMACY</span></div>
        <div className="brand-visual" aria-hidden="true">
          <span className="visual-orbit orbit-one" /><span className="visual-orbit orbit-two" />
          <span className="visual-cross"><i /><b /></span>
          <span className="visual-dot dot-one" /><span className="visual-dot dot-two" />
          <div className="visual-card"><ShieldCheck size={23} /><span>رعاية أسرع، تشغيل أوضح</span></div>
        </div>
        <div className="login-brand-copy">
          <span className="eyebrow light-eyebrow">إدارة صيدليتك بوضوح</span>
          <h1>مساحة عمل واحدة.<br /><em>رعاية أفضل.</em></h1>
          <p>مبيعات ومخزون وورديات، في تجربة هادئة صُممت لتناسب إيقاع الصيدلية.</p>
        </div>
        <div className="login-brand-foot"><span>منصة تشغيل صيدلية آمنة</span><span>01 — M PHARMACY</span></div>
      </section>

      <section className="login-form-panel">
        <div className="login-mobile-brand"><img src="/assets/logo.svg" alt="M Pharmacy" /><strong>M Pharmacy</strong></div>
        <div className="login-card">
          <div className="login-card-icon"><LockKeyhole size={20} /></div>
          <span className="eyebrow">الدخول إلى مساحة العمل</span>
          <h2>مرحبًا بعودتك</h2>
          <p className="login-description">سجّل الدخول للمتابعة إلى نقطة البيع وإدارة الصيدلية.</p>

          {setupRequired ? (
            <div className="setup-notice" role="status"><ShieldCheck size={20} /><div><b>إعداد آمن مطلوب</b><span>يجب على مالك الموقع تهيئة حساب المدير الأول عبر إعداد محمي. لا يوجد تسجيل مفتوح أو كلمة مرور افتراضية.</span></div></div>
          ) : (
            <form className="login-form" onSubmit={submit}>
              <label className="floating-field">
                <UserRound size={18} />
                <input id="login-username" name="username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} placeholder=" " required autoFocus />
                <span>اسم المستخدم</span>
              </label>
              <label className="floating-field password-field">
                <LockKeyhole size={18} />
                <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder=" " required />
                <span>كلمة المرور</span>
                <button className="password-visibility" type="button" aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </label>
              <div className="login-options"><label className="remember-choice"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} /><span>تذكرني لمدة 30 يومًا</span></label><span className="session-note"><ShieldCheck size={14} /> جلسة آمنة</span></div>
              {error && <div className="login-error" role="alert">{error}</div>}
              <button className="login-submit" type="submit" disabled={submitting || loading}>
                {submitting ? <span className="button-spinner" /> : <><span>تسجيل الدخول</span><ArrowLeft size={18} /></>}
              </button>
            </form>
          )}
          <div className="login-security-note"><ShieldCheck size={16} /><span>بيانات حسابك مشفّرة ولا تُشارك خارج نظام الصيدلية.</span></div>
        </div>
        <div className="login-footer"><span>© {new Date().getFullYear()} M Pharmacy</span><span>الدعم عبر مدير النظام</span></div>
      </section>
    </main>
  );
}
