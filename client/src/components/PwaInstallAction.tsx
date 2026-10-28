import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

type Props = { variant?: "topbar" | "login" };

export default function PwaInstallAction({ variant = "topbar" }: Props) {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setInstalled(standalone);
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
      toast.success("تم تثبيت M Pharmacy على جهازك.");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const install = async () => {
    if (!promptEvent) {
      if (ios) {
        toast.info("في Safari اضغط «مشاركة» ثم اختر «إضافة إلى الشاشة الرئيسية».", { duration: 8000 });
      } else {
        toast.info("افتح قائمة المتصفح واختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».", { duration: 7000 });
      }
      return;
    }

    const pending = promptEvent;
    setPromptEvent(null);
    try {
      await pending.prompt();
      const choice = await pending.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
    } catch {
      toast.error("تعذر بدء التثبيت من المتصفح. استخدم قائمة المتصفح لإضافة التطبيق.");
    }
  };

  const label = variant === "login" ? "تثبيت على الهاتف" : "تثبيت التطبيق";
  return (
    <button
      type="button"
      className={`pwa-install-action pwa-install-${variant}`}
      onClick={() => void install()}
      aria-label={label}
      title={label}
    >
      <Download size={16} aria-hidden="true" />
      <span className="pwa-install-label">{label}</span>
    </button>
  );
}
