export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "REQUEST_FAILED",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const SERVICES = [
  { name: "قياس ضغط الدم", price: "5.00", icon: "heart-pulse" },
  { name: "ضماد", price: "2.00", icon: "bandage" },
] as const;

export const MAX_MONEY_CENTS = 9_999_999_999;

export function addMoneyCents(current: number, addition: number, label: string): number {
  const total = current + addition;
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(addition) || current < 0 || addition < 0 || !Number.isSafeInteger(total) || total > MAX_MONEY_CENTS) {
    throw new ApiError(422, `قيمة ${label} تتجاوز الحد المسموح.`, "MONEY_LIMIT_EXCEEDED");
  }
  return total;
}

export function addAggregateCents(current: number, addition: number, label: string): number {
  const total = current + addition;
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(addition) || current < 0 || addition < 0 || !Number.isSafeInteger(total)) {
    throw new ApiError(422, `يتجاوز ${label} الحد الدقيق الممكن حسابه.`, "AGGREGATE_LIMIT_EXCEEDED");
  }
  return total;
}

export function parseMoneyCents(value: unknown, label = "المبلغ"): number {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new ApiError(422, `تحقق من قيمة ${label}.`, "INVALID_MONEY");
  }
  const text = String(value).trim();
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(text)) {
    throw new ApiError(422, `أدخل ${label} موجبًا أو صفرًا بمنزلتين عشريتين كحد أقصى.`, "INVALID_MONEY");
  }
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_MONEY_CENTS) {
    throw new ApiError(422, `قيمة ${label} كبيرة جدًا.`, "INVALID_MONEY");
  }
  return cents;
}

export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("Money must be an integer number of cents");
  return (cents / 100).toFixed(2);
}

export function moneyToCents(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
}

export function currentDayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function dateOnly(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
