import type { CartLine } from "@/lib/pharmacy-types";

type HeldCart = { userId: number; lines: CartLine[] };

let heldCart: HeldCart | null = null;

export function getHeldCart(userId: number): CartLine[] {
  if (!heldCart || heldCart.userId !== userId) return [];
  return heldCart.lines.map(line => ({ ...line }));
}

export function storeHeldCart(userId: number, lines: CartLine[]): CartLine[] {
  heldCart = { userId, lines: lines.map(line => ({ ...line })) };
  return getHeldCart(userId);
}

export function takeHeldCart(userId: number): CartLine[] {
  const lines = getHeldCart(userId);
  if (heldCart?.userId === userId) heldCart = null;
  return lines;
}

export function clearHeldCart(): void {
  heldCart = null;
}

export function clearLegacyHeldCartStorage(): void {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem("m-pharmacy-held-cart");
  } catch {
    // Storage may be unavailable in a privacy-restricted browser; the app does not depend on it.
  }
}
