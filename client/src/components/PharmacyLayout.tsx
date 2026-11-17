import { useEffect, useState, type ReactNode } from "react";
import { Activity, BarChart3, ChevronDown, ClipboardList, LayoutDashboard, LogOut, Menu, Moon, MoreHorizontal, PackageSearch, Pill, Search, Settings2, ShieldCheck, Sun, Users, Wallet, X } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { usePharmacyAuth } from "@/contexts/PharmacyAuthContext";
import PwaInstallAction from "@/components/PwaInstallAction";

const links = [
  { href: "/", label: "نقطة البيع", mobileLabel: "البيع", Icon: Wallet, roles: ["admin", "pharmacist"] },
  { href: "/inventory", label: "المخزون والأدوية", mobileLabel: "المخزون", Icon: PackageSearch, roles: ["admin", "pharmacist"] },
  { href: "/shifts", label: "الورديات", mobileLabel: "الورديات", Icon: Activity, roles: ["admin", "pharmacist"] },
  { href: "/dashboard", label: "لوحة المؤشرات", mobileLabel: "المؤشرات", Icon: LayoutDashboard, roles: ["admin"] },
  { href: "/reports", label: "التقارير", mobileLabel: "التقارير", Icon: BarChart3, roles: ["admin"] },
  { href: "/users", label: "المستخدمون", mobileLabel: "المستخدمون", Icon: Users, roles: ["admin"] },
];
const mobilePrimaryHrefs = new Set(["/", "/inventory", "/shifts"]);

type Props = { title: string; active: string; children: ReactNode };

export default function PharmacyLayout({ title, active, children }: Props) {
  const { user, logout } = usePharmacyAuth();
  const [, navigate] = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("m-pharmacy-sidebar") === "collapsed");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<"auto" | "light" | "dark">(() => (localStorage.getItem("m-pharmacy-theme") as "auto" | "light" | "dark") || "auto");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const dark = theme === "dark" || (theme === "auto" && systemDark);
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("m-pharmacy-theme", theme);
  }, [theme, systemDark]);

  const toggleTheme = () => {
    const darkNow = theme === "dark" || (theme === "auto" && systemDark);
    setTheme(darkNow ? "light" : "dark");
  };

  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("m-pharmacy-sidebar", next ? "collapsed" : "expanded");
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate("/login");
    } catch {
      toast.error("تعذر تسجيل الخروج. تحقق من الاتصال وحاول مرة أخرى.");
    }
  };

  const visibleLinks = links.filter(link => link.roles.includes(user?.role ?? "pharmacist"));
  const mobileLinks = visibleLinks.filter(link => mobilePrimaryHrefs.has(link.href));
  const hasMoreMobileLinks = visibleLinks.some(link => !mobilePrimaryHrefs.has(link.href));
  const moreMobileActive = mobileOpen || !mobilePrimaryHrefs.has(active);

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      {mobileOpen && <button className="mobile-scrim" aria-label="إغلاق القائمة" onClick={() => setMobileOpen(false)} />}
      <aside id="pharmacy-sidebar" className={`app-sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="sidebar-brand">
          <img src="/assets/pharmacy-app-icon-512.png?v=20261117-2" alt="M Pharmacy" />
          <div className="brand-label"><strong>M Pharmacy</strong><span>نظام الصيدلية</span></div>
          <button className="sidebar-collapse" title={collapsed ? "توسيع القائمة" : "طي القائمة"} onClick={toggleSidebar}>
            <ChevronDown size={16} />
          </button>
          <button className="mobile-close" aria-label="إغلاق القائمة" onClick={() => setMobileOpen(false)}><X size={19} /></button>
        </div>

        <div className="sidebar-section-label">مساحة العمل</div>
        <nav className="sidebar-nav" aria-label="التنقل الرئيسي">
          {visibleLinks.map(({ href, label, Icon }) => (
            <button
              key={href}
              className={`nav-link ${active === href ? "active" : ""}`}
              aria-current={active === href ? "page" : undefined}
              title={collapsed ? label : undefined}
              onClick={() => { navigate(href); setMobileOpen(false); }}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{label}</span>
              {active === href && <i className="nav-active-dot" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-secure-note"><ShieldCheck size={17} /><span>بيانات العمل محمية</span></div>
          <button className="logout-link" onClick={handleLogout}><LogOut size={18} /><span>تسجيل الخروج</span></button>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <button className="mobile-menu" aria-label="فتح القائمة" onClick={() => setMobileOpen(true)}><Menu size={21} /></button>
          <div className="topbar-title"><span>مساحة العمل</span><b>{title}</b></div>
          <div className="topbar-actions">
            <span className="connection-indicator"><i /> النظام متصل</span>
            <PwaInstallAction />
            <button className="icon-button theme-button" onClick={toggleTheme} title={theme === "auto" ? "الوضع تلقائي — اضغط للتبديل" : `الوضع ${theme === "dark" ? "الليلي" : "الفاتح"} — اضغط للتبديل`}>
              {(theme === "dark" || (theme === "auto" && systemDark)) ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <div className="topbar-user"><span className="user-avatar">{user?.name.slice(0, 1) || "م"}</span><span className="user-summary"><b>{user?.name}</b><small>{user?.role === "admin" ? "مدير النظام" : "صيدلي"}</small></span></div>
            <button className="icon-button mobile-logout" title="تسجيل الخروج" onClick={handleLogout}><LogOut size={18} /></button>
          </div>
        </header>
        <main className={`page-content page-${active.replace("/", "") || "pos"}`}>
          {children}
        </main>
        <footer className="app-footer"><span>© {new Date().getFullYear()} M Pharmacy</span><span>رعاية أسرع · تشغيل أوضح</span></footer>
      </div>

      <nav className="mobile-bottom-nav" aria-label="التنقل السريع">
        {mobileLinks.map(({ href, mobileLabel, Icon }) => (
          <button
            key={href}
            type="button"
            className={`mobile-nav-link ${active === href ? "active" : ""}`}
            aria-current={active === href ? "page" : undefined}
            onClick={() => { navigate(href); setMobileOpen(false); }}
          >
            <Icon size={19} strokeWidth={1.9} />
            <span>{mobileLabel}</span>
          </button>
        ))}
        {hasMoreMobileLinks && (
          <button
            type="button"
            className={`mobile-nav-link ${moreMobileActive ? "active" : ""}`}
            aria-label="المزيد من الصفحات"
            aria-expanded={mobileOpen}
            aria-controls="pharmacy-sidebar"
            onClick={() => setMobileOpen(true)}
          >
            <MoreHorizontal size={20} strokeWidth={2} />
            <span>المزيد</span>
          </button>
        )}
      </nav>
    </div>
  );
}
