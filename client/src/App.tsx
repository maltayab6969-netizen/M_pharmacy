import { useEffect } from "react";
import { Redirect, Route, Switch, useLocation } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import ErrorBoundary from "./components/ErrorBoundary";
import PharmacyLayout from "./components/PharmacyLayout";
import { PharmacyAuthProvider, usePharmacyAuth } from "./contexts/PharmacyAuthContext";
import LoginPage from "./pages/Login";
import PosPage from "./pages/Pos";
import DashboardPage from "./pages/Dashboard";
import InventoryPage from "./pages/Inventory";
import ShiftsPage from "./pages/Shifts";
import ReportsPage from "./pages/Reports";
import UsersPage from "./pages/Users";

function LoadingScreen() {
  return <div className="loading-screen" dir="rtl"><img src="/assets/logo.svg" alt="" /><span className="loading-mark" /><p>جارٍ فتح مساحة العمل…</p></div>;
}

function Guard({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const { loading, user } = usePharmacyAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Redirect to="/login" />;
  if (admin && user.role !== "admin") return <Redirect to="/" />;
  return <>{children}</>;
}

function AppRoutes() {
  const { loading, user } = usePharmacyAuth();
  const [path, navigate] = useLocation();
  useEffect(() => {
    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";
    document.title = "M Pharmacy · نقطة البيع";
    if (loading || (user && path === "/login") || (!user && path !== "/login")) return;
    if (path === "/") document.title = "نقطة البيع · M Pharmacy";
    else if (path === "/dashboard") document.title = "لوحة المؤشرات · M Pharmacy";
    else if (path === "/inventory") document.title = "المخزون · M Pharmacy";
    else if (path === "/shifts") document.title = "الورديات · M Pharmacy";
    else if (path === "/reports") document.title = "التقارير · M Pharmacy";
    else if (path === "/users") document.title = "المستخدمون · M Pharmacy";
  }, [path, loading, user, navigate]);

  return (
    <Switch>
      <Route path="/login"><LoginPage /></Route>
      <Route path="/"><Guard><PharmacyLayout title="نقطة البيع" active="/"><PosPage /></PharmacyLayout></Guard></Route>
      <Route path="/dashboard"><Guard admin><PharmacyLayout title="لوحة المؤشرات" active="/dashboard"><DashboardPage /></PharmacyLayout></Guard></Route>
      <Route path="/inventory"><Guard><PharmacyLayout title="المخزون والأدوية" active="/inventory"><InventoryPage /></PharmacyLayout></Guard></Route>
      <Route path="/shifts"><Guard><PharmacyLayout title="الورديات" active="/shifts"><ShiftsPage /></PharmacyLayout></Guard></Route>
      <Route path="/reports"><Guard admin><PharmacyLayout title="التقارير المالية" active="/reports"><ReportsPage /></PharmacyLayout></Guard></Route>
      <Route path="/users"><Guard admin><PharmacyLayout title="إدارة المستخدمين" active="/users"><UsersPage /></PharmacyLayout></Guard></Route>
      <Route><div className="not-found" dir="rtl"><img src="/assets/logo.svg" alt="M Pharmacy" /><h1>هذه الصفحة غير متاحة</h1><p>تحقق من الرابط أو ارجع إلى نقطة البيع.</p><button className="button-primary" onClick={() => navigate(user ? "/" : "/login")}>العودة إلى مساحة العمل</button></div></Route>
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <PharmacyAuthProvider>
        <Toaster position="top-left" richColors dir="rtl" closeButton />
        <AppRoutes />
      </PharmacyAuthProvider>
    </ErrorBoundary>
  );
}
