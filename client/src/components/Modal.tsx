import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

type Props = {
  title: string;
  description?: string;
  children: ReactNode;
  onClose?: () => void;
  wide?: boolean;
  labelledBy?: string;
};

export default function Modal({ title, description, children, onClose, wide = false, labelledBy }: Props) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && onClose) onClose(); }}>
      <section className={`modal-card ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <header className="modal-heading">
          <div><h2 id={labelledBy}>{title}</h2>{description && <p>{description}</p>}</div>
          {onClose && <button className="modal-close" type="button" aria-label="إغلاق" onClick={onClose}><X size={17} /></button>}
        </header>
        {children}
      </section>
    </div>
  );
}
