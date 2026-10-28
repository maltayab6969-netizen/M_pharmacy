import { useEffect, useState } from "react";
import { Printer, X } from "lucide-react";
import QRCode from "qrcode";
import { formatCurrency } from "@/lib/pharmacy-api";
import Modal from "./Modal";

type ReceiptInvoice = {
  id: number;
  number: string;
  cashier: string;
  shiftId: number;
  paymentMethod: "cash" | "card";
  subtotal: string;
  discount: string;
  net: string;
  received: string | null;
  change: string;
  createdAt: string | Date;
  items: Array<{ name: string; barcode?: string | null; quantity: number; unitPrice: string; total: string }>;
};

type Props = { invoice: ReceiptInvoice; onClose: () => void };

export default function Receipt({ invoice, onClose }: Props) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    void QRCode.toDataURL(`M|${invoice.number}|${invoice.net}|${new Date(invoice.createdAt).toISOString()}`, { width: 180, margin: 1, errorCorrectionLevel: "M" })
      .then(setQr).catch(() => setQr(""));
  }, [invoice]);
  const date = new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(invoice.createdAt));
  return (
    <Modal title="الفاتورة جاهزة" description={`رقم الفاتورة ${invoice.number}`} onClose={onClose} labelledBy="receipt-title">
      <article className="printable-receipt" dir="rtl">
        <header className="receipt-brand"><img src="/assets/logo.svg" alt="M" /><strong>M Pharmacy</strong><small>إيصال بيع</small></header>
        <div className="receipt-meta">
          <div><span>رقم الفاتورة</span><b>{invoice.number}</b></div>
          <div><span>التاريخ</span><b>{date}</b></div>
          <div><span>الصيدلي</span><b>{invoice.cashier}</b></div>
          <div><span>رقم الوردية</span><b>#{invoice.shiftId}</b></div>
        </div>
        <table className="receipt-items"><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th></tr></thead><tbody>
          {invoice.items.map((item, index) => <tr key={`${item.name}-${index}`}><td>{item.name}</td><td>{item.quantity}</td><td>{formatCurrency(item.total)}</td></tr>)}
        </tbody></table>
        <div className="receipt-total">
          <div><span>الإجمالي</span><b>{formatCurrency(invoice.subtotal)}</b></div>
          <div><span>الخصم</span><b>{formatCurrency(invoice.discount)}</b></div>
          <div className="grand"><span>الصافي</span><b>{formatCurrency(invoice.net)}</b></div>
          <div><span>طريقة الدفع</span><b>{invoice.paymentMethod === "cash" ? "نقدًا" : "بطاقة"}</b></div>
          {invoice.paymentMethod === "cash" && <><div><span>المبلغ المستلم</span><b>{formatCurrency(invoice.received)}</b></div><div><span>الباقي</span><b>{formatCurrency(invoice.change)}</b></div></>}
        </div>
        <div className="receipt-qr">{qr && <img src={qr} alt={`رمز QR للفاتورة ${invoice.number}`} />}<small>{invoice.number}</small><small>شكرًا لزيارتكم</small></div>
      </article>
      <div className="receipt-actions"><button className="button-secondary" onClick={onClose}><X size={16} /> إغلاق</button><button className="button-primary" onClick={() => window.print()}><Printer size={16} /> طباعة الإيصال</button></div>
    </Modal>
  );
}
