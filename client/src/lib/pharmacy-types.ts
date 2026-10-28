import type { PharmacyUser } from "./pharmacy-api";

export type AuthState = {
  loading: boolean;
  user: PharmacyUser | null;
  csrfToken: string;
  setupRequired: boolean;
  refresh: () => Promise<void>;
  login: (username: string, password: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
};

export type MedicineRow = {
  id: number;
  barcode: string | null;
  name: string;
  activeIngredient: string | null;
  categoryId: number | null;
  categoryName: string | null;
  buyPrice?: string;
  sellPrice: string;
  quantity: number;
  expiryDate: string;
};

export type PosProduct = {
  id: number;
  barcode: string | null;
  name: string;
  activeIngredient: string | null;
  price: string;
  quantity: number;
  expiryDate: string;
};

export type CartLine = {
  key: string;
  medicineId?: number;
  serviceName?: string;
  name: string;
  barcode?: string | null;
  price: number;
  quantity: number;
  available?: number;
};
