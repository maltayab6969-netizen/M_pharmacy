export function registerPwaServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  const register = () => {
    void navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    }).catch(error => {
      console.warn("تعذر تسجيل عامل تطبيق M Pharmacy.", error);
    });
  };

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
