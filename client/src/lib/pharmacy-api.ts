export type Role = "admin" | "pharmacist";
export type PharmacyUser = { id: number; name: string; username: string; role: Role };
export type ApiErrorBody = { ok?: false; error?: string; code?: string };

let csrfToken = "";
export function setCsrfToken(value: string | null | undefined) {
  csrfToken = value ?? "";
}
export function getCsrfToken() {
  return csrfToken;
}

export class PharmacyApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = "PharmacyApiError";
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (options.method && !["GET", "HEAD", "OPTIONS"].includes(options.method.toUpperCase()) && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(path, { ...options, headers, credentials: "include", cache: "no-store" });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (!response.ok) throw new PharmacyApiError("تعذر إتمام الطلب. حاول مرة أخرى.", response.status);
    return undefined as T;
  }
  const data = await response.json() as T & ApiErrorBody;
  if (!response.ok) throw new PharmacyApiError(data.error || "تعذر إتمام الطلب.", response.status, data.code);
  return data;
}

export function formatCurrency(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0);
}

export function todayUtcISO() {
  return new Date().toISOString().slice(0, 10);
}
