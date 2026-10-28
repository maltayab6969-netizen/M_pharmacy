import { randomBytes } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { Router } from "express";
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  appState,
  auditLogs,
  categories,
  invoiceItems,
  invoices,
  medicines,
  sessions,
  shifts,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { createSqlBackup } from "./backup";
import { addAggregateCents, addMoneyCents, ApiError, currentDayISO, dateOnly, formatMoney, isValidISODate, moneyToCents, parseMoneyCents, SERVICES } from "./domain";
import {
  authenticate,
  AuthenticatedRequest,
  hashPassword,
  issuePreAuthCookie,
  issueSession,
  optionalAuthenticate,
  publicUser,
  requireAdmin,
  requireCsrf,
  requireUser,
  revokeCurrentSession,
  validatePreAuth,
  verifyPassword,
} from "./security";
import { bootstrapRequired } from "./bootstrap";

const router = Router();
type Handler = (req: Request, res: Response) => Promise<void>;
const route = (handler: Handler): RequestHandler => (req, res, next) => {
  void handler(req, res).catch(next);
};

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new ApiError(503, "قاعدة البيانات غير متاحة مؤقتًا.", "DATABASE_UNAVAILABLE");
  return db;
}

function bodyOrThrow<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new ApiError(422, first?.message || "تحقق من البيانات المدخلة.", "VALIDATION_FAILED");
  }
  return result.data;
}

function numericId(raw: string | undefined, label = "المعرف"): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new ApiError(404, `${label} غير موجود.`, "NOT_FOUND");
  return value;
}

function decimalFromCents(cents: number): string {
  return formatMoney(cents);
}

function cents(value: string | number | null | undefined): number {
  return moneyToCents(value);
}

function currencyInput(value: unknown, label: string): string {
  return decimalFromCents(parseMoneyCents(value, label));
}

function expiryMessage(name: string): string {
  return `لا يمكن بيع الدواء «${name}» لأنه منتهي الصلاحية.`;
}

async function audit(
  tx: any,
  actorId: number,
  action: string,
  targetType: string,
  targetId: number | string | null,
  details?: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditLogs).values({
    actorId,
    action,
    targetType,
    targetId: targetId === null ? null : String(targetId),
    details: details ? JSON.stringify(details) : null,
  });
}

async function lockAdminRoster(tx: any): Promise<void> {
  await tx.insert(appState).values({ id: 1, bootstrapDone: false }).onDuplicateKeyUpdate({ set: { id: 1 } });
  await tx.select({ id: appState.id }).from(appState).where(eq(appState.id, 1)).limit(1).for("update");
}

function appUser(req: Request) {
  return requireUser(req);
}

async function activeShiftFor(userId: number) {
  const db = await dbOrThrow();
  const [shift] = await db.select().from(shifts)
    .where(and(eq(shifts.userId, userId), eq(shifts.status, "open")))
    .orderBy(desc(shifts.id)).limit(1);
  return shift ?? null;
}

async function loadInvoice(invoiceId: number) {
  const db = await dbOrThrow();
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!invoice) return null;
  const [cashier] = await db.select({ name: users.name, username: users.username })
    .from(users).where(eq(users.id, invoice.userId)).limit(1);
  const lineItems = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
  return {
    id: invoice.id,
    number: invoice.invoiceNumber,
    userId: invoice.userId,
    cashier: cashier?.name || cashier?.username || "مستخدم",
    shiftId: invoice.shiftId,
    paymentMethod: invoice.paymentMethod,
    subtotal: invoice.totalAmount,
    discount: invoice.discount,
    net: invoice.netAmount,
    received: invoice.cashReceived,
    change: invoice.changeGiven,
    createdAt: invoice.createdAt,
    items: lineItems.map(item => ({
      name: item.productName,
      barcode: item.barcodeSnapshot,
      serviceName: item.serviceName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.totalPrice,
    })),
  };
}

// Health and authenticated application bootstrap.
router.get("/auth/status", optionalAuthenticate(), route(async (req, res) => {
  const user = (req as AuthenticatedRequest).pharmacyUser ?? null;
  const csrfToken = user ? (req as AuthenticatedRequest).pharmacyCsrf! : issuePreAuthCookie(res);
  res.set("Cache-Control", "no-store").json({ user, csrfToken, setupRequired: await bootstrapRequired() });
}));

router.post("/auth/login", route(async (req, res) => {
  validatePreAuth(req);
  const input = bodyOrThrow(z.object({
    username: z.string().trim().min(1).max(50),
    password: z.string().min(1).max(256),
    remember: z.boolean().optional().default(false),
  }), req.body);
  const db = await dbOrThrow();
  const [user] = await db.select().from(users).where(and(eq(users.username, input.username), eq(users.isActive, true))).limit(1);
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new ApiError(401, "اسم المستخدم أو كلمة المرور غير صحيحة.", "LOGIN_INVALID");
  }
  const safe = publicUser(user);
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  const csrfToken = await issueSession(res, user.id, input.remember);
  res.set("Cache-Control", "no-store").json({ ok: true, user: safe, csrfToken });
}));

router.post("/auth/logout", authenticate(), requireCsrf, route(async (req, res) => {
  await revokeCurrentSession(req, res);
  res.set("Cache-Control", "no-store").json({ ok: true });
}));

router.get("/auth/me", authenticate(), route(async (req, res) => {
  const request = req as AuthenticatedRequest;
  res.set("Cache-Control", "no-store").json({ user: appUser(req), csrfToken: request.pharmacyCsrf });
}));

router.post("/auth/verify-password", authenticate(), requireCsrf, route(async (req, res) => {
  const input = bodyOrThrow(z.object({ password: z.string().min(1).max(256) }), req.body);
  const user = appUser(req);
  const db = await dbOrThrow();
  const [record] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1);
  res.json({ ok: await verifyPassword(input.password, record?.passwordHash) });
}));

router.post("/auth/change-password", authenticate(), requireCsrf, route(async (req, res) => {
  const input = bodyOrThrow(z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(10).max(256) }), req.body);
  const actor = appUser(req);
  const db = await dbOrThrow();
  const [record] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, actor.id)).limit(1);
  if (!(await verifyPassword(input.currentPassword, record?.passwordHash))) throw new ApiError(422, "كلمة المرور الحالية غير صحيحة.", "PASSWORD_INVALID");
  await db.update(users).set({ passwordHash: await hashPassword(input.newPassword) }).where(eq(users.id, actor.id));
  const hash = (req as AuthenticatedRequest).pharmacySessionHash;
  await db.delete(sessions).where(and(eq(sessions.userId, actor.id), hash ? sql`${sessions.tokenHash} <> ${hash}` : sql`1=1`));
  await audit(db, actor.id, "password_changed", "user", actor.id);
  res.json({ ok: true, message: "تم تغيير كلمة المرور وإنهاء الجلسات الأخرى." });
}));

// POS catalog and checkout.
router.get("/pos", authenticate(), route(async (req, res) => {
  const db = await dbOrThrow();
  const user = appUser(req);
  const all = await db.select({
    id: medicines.id,
    barcode: medicines.barcode,
    name: medicines.name,
    activeIngredient: medicines.activeIngredient,
    price: medicines.sellPrice,
    quantity: medicines.quantity,
    expiryDate: medicines.expiryDate,
  }).from(medicines).where(eq(medicines.isActive, true)).orderBy(medicines.name);
  const soldRows = await db.select({
    medicineId: invoiceItems.medicineId,
    quantity: sql<number>`COALESCE(SUM(${invoiceItems.quantity}), 0)`,
  }).from(invoiceItems).where(isNotNull(invoiceItems.medicineId)).groupBy(invoiceItems.medicineId);
  const sold = new Map(soldRows.map(row => [Number(row.medicineId), Number(row.quantity)]));
  const today = currentDayISO();
  const products = all.map(item => ({
    id: Number(item.id),
    barcode: item.barcode,
    name: item.name,
    activeIngredient: item.activeIngredient,
    price: item.price,
    quantity: Number(item.quantity),
    expiryDate: dateOnly(item.expiryDate) ?? "",
  }));
  const popular = products.filter(item => item.quantity > 0 && item.expiryDate >= today)
    .sort((a, b) => (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0) || a.name.localeCompare(b.name, "ar"))
    .slice(0, 12);
  res.set("Cache-Control", "no-store").json({ medicines: products, popular, services: SERVICES, shift: await activeShiftFor(user.id) });
}));

const checkoutSchema = z.object({
  idempotencyKey: z.string().uuid(),
  items: z.array(z.object({
    medicineId: z.number().int().positive().optional(),
    serviceName: z.string().max(100).optional(),
    quantity: z.number().int().min(1).max(10000),
  })).min(1).max(100),
  method: z.enum(["cash", "card"]),
  discount: z.union([z.string(), z.number()]).optional().default(0),
  cashReceived: z.union([z.string(), z.number()]).nullable().optional(),
});

router.post("/checkout", authenticate(), requireCsrf, route(async (req, res) => {
  const input = bodyOrThrow(checkoutSchema, req.body);
  const actor = appUser(req);
  const db = await dbOrThrow();
  const [already] = await db.select({ id: invoices.id, userId: invoices.userId }).from(invoices).where(eq(invoices.idempotencyKey, input.idempotencyKey)).limit(1);
  if (already) {
    if (Number(already.userId) !== actor.id) throw new ApiError(409, "مفتاح الفاتورة مستخدم مسبقًا.", "IDEMPOTENCY_CONFLICT");
    res.json({ ok: true, invoice: await loadInvoice(already.id) });
    return;
  }

  try {
    const invoiceId = await db.transaction(async tx => {
      const openRows = await tx.select().from(shifts)
        .where(and(eq(shifts.userId, actor.id), eq(shifts.status, "open")))
        .orderBy(desc(shifts.id)).limit(1).for("update");
      const currentShift = openRows[0];
      if (!currentShift) throw new ApiError(409, "ابدأ الوردية وسجّل رصيد الصندوق قبل البيع.", "SHIFT_REQUIRED");

      let grossCents = 0;
      const lines: Array<{ medicineId: number | null; serviceName: string | null; productName: string; barcode: string | null; quantity: number; priceCents: number; costCents: number }> = [];
      for (const item of input.items) {
        if (item.medicineId !== undefined && item.serviceName) throw new ApiError(422, "اختر دواءً أو خدمة واحدة لكل سطر.", "INVALID_LINE");
        if (item.medicineId !== undefined) {
          const [medicine] = await tx.select().from(medicines).where(and(eq(medicines.id, item.medicineId), eq(medicines.isActive, true))).limit(1).for("update");
          if (!medicine) throw new ApiError(422, "أحد الأدوية لم يعد متاحًا للبيع.", "MEDICINE_UNAVAILABLE");
          const expiry = dateOnly(medicine.expiryDate) ?? "";
          if (expiry < currentDayISO()) throw new ApiError(422, expiryMessage(medicine.name), "MEDICINE_EXPIRED");
          if (Number(medicine.quantity) < item.quantity) throw new ApiError(422, `المخزون لا يكفي للكمية المطلوبة من «${medicine.name}».`, "STOCK_INSUFFICIENT");
          const priceCents = moneyToCents(medicine.sellPrice);
          const costCents = moneyToCents(medicine.buyPrice);
          await tx.update(medicines).set({ quantity: Number(medicine.quantity) - item.quantity }).where(eq(medicines.id, medicine.id));
          lines.push({ medicineId: medicine.id, serviceName: null, productName: medicine.name, barcode: medicine.barcode, quantity: item.quantity, priceCents, costCents });
          grossCents = addMoneyCents(grossCents, priceCents * item.quantity, "إجمالي الفاتورة");
        } else {
          const service = SERVICES.find(candidate => candidate.name === item.serviceName);
          if (!service) throw new ApiError(422, "الخدمة المطلوبة غير معتمدة في نقطة البيع.", "SERVICE_INVALID");
          const priceCents = moneyToCents(service.price);
          lines.push({ medicineId: null, serviceName: service.name, productName: service.name, barcode: null, quantity: item.quantity, priceCents, costCents: 0 });
          grossCents = addMoneyCents(grossCents, priceCents * item.quantity, "إجمالي الفاتورة");
        }
      }
      const discountInput = parseMoneyCents(input.discount, "الخصم");
      const discountCents = Math.min(grossCents, discountInput);
      const netCents = grossCents - discountCents;
      let receivedCents = 0;
      let changeCents = 0;
      if (input.method === "cash") {
        if (input.cashReceived == null) throw new ApiError(422, "أدخل المبلغ النقدي المستلم.", "CASH_REQUIRED");
        receivedCents = parseMoneyCents(input.cashReceived, "المبلغ المستلم");
        if (receivedCents < netCents) throw new ApiError(422, "المبلغ المستلم أقل من الإجمالي المستحق.", "CASH_INSUFFICIENT");
        changeCents = receivedCents - netCents;
      }
      const now = new Date();
      const random = randomBytes(5).toString("hex").toUpperCase();
      const invoiceNumber = `MP-${now.toISOString().slice(2, 10).replaceAll("-", "")}-${random}`;
      const inserted = await tx.insert(invoices).values({
        invoiceNumber,
        idempotencyKey: input.idempotencyKey,
        userId: actor.id,
        shiftId: currentShift.id,
        paymentMethod: input.method,
        totalAmount: formatMoney(grossCents),
        discount: formatMoney(discountCents),
        netAmount: formatMoney(netCents),
        cashReceived: input.method === "cash" ? formatMoney(receivedCents) : null,
        changeGiven: formatMoney(changeCents),
      });
      const id = Number(inserted[0].insertId);
      await tx.insert(invoiceItems).values(lines.map(line => ({
        invoiceId: id,
        medicineId: line.medicineId,
        serviceName: line.serviceName,
        productName: line.productName,
        barcodeSnapshot: line.barcode,
        quantity: line.quantity,
        unitPrice: formatMoney(line.priceCents),
        unitCost: formatMoney(line.costCents),
        totalPrice: formatMoney(line.priceCents * line.quantity),
      })));
      return id;
    });
    res.status(201).json({ ok: true, invoice: await loadInvoice(invoiceId) });
  } catch (error) {
    const candidate = error as { code?: string };
    if (candidate.code === "ER_DUP_ENTRY") {
      const [duplicate] = await db.select({ id: invoices.id, userId: invoices.userId }).from(invoices).where(eq(invoices.idempotencyKey, input.idempotencyKey)).limit(1);
      if (duplicate) {
        if (Number(duplicate.userId) !== actor.id) throw new ApiError(409, "مفتاح الفاتورة مستخدم مسبقًا.", "IDEMPOTENCY_CONFLICT");
        res.json({ ok: true, invoice: await loadInvoice(duplicate.id) });
        return;
      }
    }
    throw error;
  }
}));

router.get("/invoices/:id", authenticate(), route(async (req, res) => {
  const actor = appUser(req);
  const invoice = await loadInvoice(numericId(req.params.id, "الفاتورة"));
  if (!invoice || (actor.role !== "admin" && invoice.userId !== actor.id)) throw new ApiError(404, "الفاتورة غير موجودة.", "NOT_FOUND");
  res.set("Cache-Control", "no-store").json({ invoice });
}));

// Inventory: view for staff, mutations for administrators only.
router.get("/medicines", authenticate(), route(async (req, res) => {
  const actor = appUser(req);
  const db = await dbOrThrow();
  const rows = await db.select({
    id: medicines.id,
    barcode: medicines.barcode,
    name: medicines.name,
    activeIngredient: medicines.activeIngredient,
    categoryId: medicines.categoryId,
    categoryName: categories.name,
    buyPrice: medicines.buyPrice,
    sellPrice: medicines.sellPrice,
    quantity: medicines.quantity,
    expiryDate: medicines.expiryDate,
  }).from(medicines).leftJoin(categories, eq(medicines.categoryId, categories.id))
    .where(eq(medicines.isActive, true)).orderBy(medicines.name);
  const safeRows = rows.map(row => {
    const { buyPrice, ...view } = row;
    return { ...(actor.role === "admin" ? { buyPrice } : {}), ...view, expiryDate: dateOnly(row.expiryDate) };
  });
  res.set("Cache-Control", "no-store").json({ medicines: safeRows });
}));

const medicineSchema = z.object({
  barcode: z.string().trim().max(64).optional().default(""),
  name: z.string().trim().min(1).max(150),
  activeIngredient: z.string().trim().max(150).optional().default(""),
  categoryName: z.string().trim().max(100).optional().default(""),
  buyPrice: z.union([z.string(), z.number()]),
  sellPrice: z.union([z.string(), z.number()]),
  quantity: z.number().int().min(0).max(2_000_000),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "أدخل تاريخ صلاحية صحيحًا.").refine(isValidISODate, "أدخل تاريخ صلاحية صحيحًا."),
});

async function resolveCategory(tx: any, name: string): Promise<number | null> {
  if (!name.trim()) return null;
  const clean = name.trim();
  await tx.insert(categories).values({ name: clean }).onDuplicateKeyUpdate({ set: { name: clean } });
  const [category] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.name, clean)).limit(1);
  return category?.id ?? null;
}

router.post("/medicines", authenticate(), requireCsrf, route(async (req, res) => {
  const actor = requireAdmin(req);
  const input = bodyOrThrow(medicineSchema, req.body);
  const buyPrice = currencyInput(input.buyPrice, "سعر الشراء");
  const sellPrice = currencyInput(input.sellPrice, "سعر البيع");
  const db = await dbOrThrow();
  const categoryId = await resolveCategory(db, input.categoryName);
  const result = await db.transaction(async tx => {
    const inserted = await tx.insert(medicines).values({
      barcode: input.barcode || null,
      name: input.name,
      activeIngredient: input.activeIngredient || null,
      categoryId,
      buyPrice,
      sellPrice,
      quantity: input.quantity,
      expiryDate: input.expiryDate,
      isActive: true,
    });
    const id = Number(inserted[0].insertId);
    await audit(tx, actor.id, "medicine_created", "medicine", id, { name: input.name });
    return id;
  });
  res.status(201).json({ ok: true, id: result });
}));

router.patch("/medicines/:id", authenticate(), requireCsrf, route(async (req, res) => {
  const actor = requireAdmin(req);
  const id = numericId(req.params.id, "الدواء");
  const input = bodyOrThrow(medicineSchema, req.body);
  const db = await dbOrThrow();
  const categoryId = await resolveCategory(db, input.categoryName);
  await db.transaction(async tx => {
    const [existing] = await tx.select({ id: medicines.id }).from(medicines).where(and(eq(medicines.id, id), eq(medicines.isActive, true))).limit(1).for("update");
    if (!existing) throw new ApiError(404, "الدواء غير موجود.", "NOT_FOUND");
    await tx.update(medicines).set({
      barcode: input.barcode || null,
      name: input.name,
      activeIngredient: input.activeIngredient || null,
      categoryId,
      buyPrice: currencyInput(input.buyPrice, "سعر الشراء"),
      sellPrice: currencyInput(input.sellPrice, "سعر البيع"),
      quantity: input.quantity,
      expiryDate: input.expiryDate,
    }).where(eq(medicines.id, id));
    await audit(tx, actor.id, "medicine_updated", "medicine", id, { name: input.name });
  });
  res.json({ ok: true });
}));

router.post("/medicines/:id/deactivate", authenticate(), requireCsrf, route(async (req, res) => {
  const actor = requireAdmin(req);
  const id = numericId(req.params.id, "الدواء");
  const db = await dbOrThrow();
  await db.transaction(async tx => {
    const [medicine] = await tx.select({ id: medicines.id, name: medicines.name }).from(medicines)
      .where(and(eq(medicines.id, id), eq(medicines.isActive, true))).limit(1).for("update");
    if (!medicine) throw new ApiError(404, "الدواء غير موجود.", "NOT_FOUND");
    await tx.update(medicines).set({ isActive: false }).where(eq(medicines.id, id));
    await audit(tx, actor.id, "medicine_deactivated", "medicine", id, { name: medicine.name });
  });
  res.json({ ok: true });
}));

router.get("/medicines/export.csv", authenticate(), route(async (req, res) => {
  requireAdmin(req);
  const db = await dbOrThrow();
  const rows = await db.select({ name: medicines.name, ingredient: medicines.activeIngredient, barcode: medicines.barcode, quantity: medicines.quantity })
    .from(medicines).where(and(eq(medicines.isActive, true), lt(medicines.quantity, 10))).orderBy(medicines.quantity);
  const quote = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = ["\uFEFFاسم الدواء,المادة الفعالة,الباركود,المتوفر", ...rows.map(row => [row.name, row.ingredient, row.barcode, row.quantity].map(quote).join(","))].join("\r\n");
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="m-pharmacy-reorder-${currentDayISO()}.csv"`, "Cache-Control": "no-store" }).send(csv);
}));

// Manager dashboard and financial reporting.
router.get("/dashboard", authenticate(), route(async (req, res) => {
  requireAdmin(req);
  const db = await dbOrThrow();
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const [todayInvoices, yesterdayInvoices, stockRows, shiftRows] = await Promise.all([
    db.select({ netAmount: invoices.netAmount }).from(invoices).where(gte(invoices.createdAt, todayStart)),
    db.select({ netAmount: invoices.netAmount }).from(invoices).where(and(gte(invoices.createdAt, yesterdayStart), lt(invoices.createdAt, todayStart))),
    db.select({ quantity: medicines.quantity, expiryDate: medicines.expiryDate }).from(medicines).where(eq(medicines.isActive, true)),
    db.select({ id: shifts.id, status: shifts.status }).from(shifts),
  ]);
  const salesToday = todayInvoices.reduce((sum, row) => addAggregateCents(sum, cents(row.netAmount), "مبيعات اليوم"), 0);
  const salesYesterday = yesterdayInvoices.reduce((sum, row) => addAggregateCents(sum, cents(row.netAmount), "مبيعات الأمس"), 0);
  const today = currentDayISO();
  const soonDate = new Date(`${today}T00:00:00Z`);
  soonDate.setUTCDate(soonDate.getUTCDate() + 30);
  const soon = soonDate.toISOString().slice(0, 10);
  res.set("Cache-Control", "no-store").json({
    today: formatMoney(salesToday),
    yesterday: formatMoney(salesYesterday),
    salesChangePercent: salesYesterday ? Number(((salesToday - salesYesterday) / salesYesterday * 100).toFixed(1)) : null,
    lowStock: stockRows.filter(row => Number(row.quantity) < 10).length,
    expiringSoon: stockRows.filter(row => { const date = dateOnly(row.expiryDate) ?? ""; return date >= today && date <= soon; }).length,
    expired: stockRows.filter(row => (dateOnly(row.expiryDate) ?? "") < today).length,
    openShifts: shiftRows.filter(row => row.status === "open").length,
  });
}));

router.get("/reports", authenticate(), route(async (req, res) => {
  requireAdmin(req);
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  if (!isValidISODate(from) || !isValidISODate(to) || from > to) throw new ApiError(422, "حدد نطاق تاريخ صحيحًا.", "DATE_RANGE_INVALID");
  const db = await dbOrThrow();
  const start = new Date(`${from}T00:00:00.000Z`);
  const until = new Date(`${to}T00:00:00.000Z`);
  until.setUTCDate(until.getUTCDate() + 1);
  const periodInvoices = await db.select().from(invoices).where(and(gte(invoices.createdAt, start), lt(invoices.createdAt, until)));
  const ids = periodInvoices.map(invoice => invoice.id);
  const items = ids.length ? await db.select().from(invoiceItems).where(inArray(invoiceItems.invoiceId, ids)) : [];
  const revenue = periodInvoices.reduce((sum, invoice) => addAggregateCents(sum, cents(invoice.netAmount), "إيراد الفترة"), 0);
  const cost = items.reduce((sum, item) => addAggregateCents(sum, cents(item.unitCost) * Number(item.quantity), "تكلفة الفترة"), 0);
  const topMap = new Map<string, { quantity: number; revenue: number }>();
  for (const item of items) {
    const previous = topMap.get(item.productName) ?? { quantity: 0, revenue: 0 };
    previous.quantity = addAggregateCents(previous.quantity, Number(item.quantity), "كمية الصنف المباع");
    previous.revenue = addAggregateCents(previous.revenue, cents(item.totalPrice), "إيراد الصنف المباع");
    topMap.set(item.productName, previous);
  }
  const top = [...topMap.entries()].map(([name, value]) => ({ name, ...value, revenue: formatMoney(value.revenue) }))
    .sort((a, b) => Number(b.revenue) - Number(a.revenue)).slice(0, 10);
  res.set("Cache-Control", "no-store").json({
    from,
    to,
    revenue: formatMoney(revenue),
    invoiceCount: periodInvoices.length,
    cost: formatMoney(cost),
    grossProfit: formatMoney(revenue - cost),
    top,
  });
}));

// User and shift management.
router.get("/users", authenticate(), route(async (req, res) => {
  requireAdmin(req);
  const db = await dbOrThrow();
  const rows = await db.select({ id: users.id, name: users.name, username: users.username, role: users.role, isActive: users.isActive, createdAt: users.createdAt })
    .from(users).where(isNotNull(users.username)).orderBy(users.name);
  res.set("Cache-Control", "no-store").json({ users: rows });
}));

router.post("/users", authenticate(), requireCsrf, route(async (req, res) => {
  const actor = requireAdmin(req);
  const input = bodyOrThrow(z.object({
    name: z.string().trim().min(2).max(100),
    username: z.string().trim().min(3).max(50).regex(/^[\p{L}\p{N}._-]+$/u, "اسم المستخدم يقبل الحروف والأرقام والنقطة والشرطة فقط."),
    password: z.string().min(12).max(256),
    role: z.enum(["admin", "pharmacist"]),
  }), req.body);
  const db = await dbOrThrow();
  try {
    const result = await db.transaction(async tx => {
      if (input.role === "admin") await lockAdminRoster(tx);
      const inserted = await tx.insert(users).values({
        openId: `mp_${randomBytes(18).toString("hex")}`,
        name: input.name,
        username: input.username,
        passwordHash: await hashPassword(input.password),
        role: input.role,
        loginMethod: "password",
        isActive: true,
      });
      const id = Number(inserted[0].insertId);
      await audit(tx, actor.id, "user_created", "user", id, { username: input.username, role: input.role });
      return id;
    });
    res.status(201).json({ ok: true, id: result });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") throw new ApiError(409, "اسم المستخدم مستخدم بالفعل.", "USERNAME_EXISTS");
    throw error;
  }
}));

router.patch("/users/:id/password", authenticate(), requireCsrf, route(async (req, res) => {
  const actor = requireAdmin(req);
  const id = numericId(req.params.id, "المستخدم");
  const input = bodyOrThrow(z.object({ password: z.string().min(12).max(256) }), req.body);
  const db = await dbOrThrow();
  await db.transaction(async tx => {
    const [target] = await tx.select({ id: users.id, username: users.username }).from(users).where(eq(users.id, id)).limit(1).for("update");
    if (!target) throw new ApiError(404, "المستخدم غير موجود.", "NOT_FOUND");
    await tx.update(users).set({ passwordHash: await hashPassword(input.password) }).where(eq(users.id, id));
    await tx.delete(sessions).where(eq(sessions.userId, id));
    await audit(tx, actor.id, "user_password_reset", "user", id, { username: target.username });
  });
  res.json({ ok: true, message: "تم تحديث كلمة المرور وإنهاء الجلسات السابقة." });
}));

router.patch("/users/:id/role", authenticate(), requireCsrf, route(async (req, res) => {
  const actor = requireAdmin(req);
  const id = numericId(req.params.id, "المستخدم");
  const input = bodyOrThrow(z.object({ role: z.enum(["admin", "pharmacist"]) }), req.body);
  const db = await dbOrThrow();
  await db.transaction(async tx => {
    await lockAdminRoster(tx);
    const [target] = await tx.select({ id: users.id, role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, id)).limit(1).for("update");
    if (!target) throw new ApiError(404, "المستخدم غير موجود.", "NOT_FOUND");
    if (target.role === "admin" && input.role !== "admin" && target.isActive) {
      const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.isActive, true)));
      if (admins.length <= 1) throw new ApiError(409, "لا يمكن تغيير دور آخر مدير نشط.", "LAST_ADMIN");
    }
    await tx.update(users).set({ role: input.role }).where(eq(users.id, id));
    await audit(tx, actor.id, "user_role_changed", "user", id, { role: input.role });
  });
  res.json({ ok: true });
}));

router.patch("/users/:id/active", authenticate(), requireCsrf, route(async (req, res) => {
  const actor = requireAdmin(req);
  const id = numericId(req.params.id, "المستخدم");
  const input = bodyOrThrow(z.object({ isActive: z.boolean() }), req.body);
  if (id === actor.id && !input.isActive) throw new ApiError(409, "لا يمكنك تعطيل حسابك الحالي.", "SELF_DEACTIVATION");
  const db = await dbOrThrow();
  await db.transaction(async tx => {
    await lockAdminRoster(tx);
    const [target] = await tx.select({ id: users.id, username: users.username, role: users.role, isActive: users.isActive })
      .from(users).where(eq(users.id, id)).limit(1).for("update");
    if (!target) throw new ApiError(404, "المستخدم غير موجود.", "NOT_FOUND");
    if (target.role === "admin" && target.isActive && !input.isActive) {
      const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.isActive, true)));
      if (admins.length <= 1) throw new ApiError(409, "لا يمكن تعطيل آخر مدير نشط.", "LAST_ADMIN");
    }
    await tx.update(users).set({ isActive: input.isActive }).where(eq(users.id, id));
    if (!input.isActive) await tx.delete(sessions).where(eq(sessions.userId, id));
    await audit(tx, actor.id, input.isActive ? "user_activated" : "user_deactivated", "user", id, { username: target.username });
  });
  res.json({ ok: true });
}));

const floatSchema = z.object({ startingCash: z.union([z.string(), z.number()]) });
router.get("/shifts", authenticate(), route(async (req, res) => {
  const actor = appUser(req);
  const db = await dbOrThrow();
  const current = await activeShiftFor(actor.id);
  if (actor.role === "admin") {
    const history = await db.select({
      id: shifts.id,
      userId: shifts.userId,
      cashier: users.name,
      username: users.username,
      startTime: shifts.startTime,
      endTime: shifts.endTime,
      startingCash: shifts.startingCash,
      expectedCash: shifts.expectedCash,
      actualCash: shifts.actualCash,
      cashDifference: shifts.cashDifference,
      status: shifts.status,
    }).from(shifts).innerJoin(users, eq(shifts.userId, users.id)).orderBy(desc(shifts.id)).limit(100);
    res.set("Cache-Control", "no-store").json({ current, history: history.map(row => ({ ...row, cashier: row.cashier || row.username })) });
    return;
  }
  res.set("Cache-Control", "no-store").json({ current, history: current ? [current] : [] });
}));

router.post("/shifts", authenticate(), requireCsrf, route(async (req, res) => {
  const actor = appUser(req);
  const input = bodyOrThrow(floatSchema, req.body);
  const startingCash = currencyInput(input.startingCash, "العهدة الافتتاحية");
  const db = await dbOrThrow();
  const id = await db.transaction(async tx => {
    const [lockedUser] = await tx.select({ id: users.id }).from(users).where(eq(users.id, actor.id)).limit(1).for("update");
    if (!lockedUser) throw new ApiError(401, "الحساب غير متاح.", "UNAUTHENTICATED");
    const [existing] = await tx.select({ id: shifts.id }).from(shifts)
      .where(and(eq(shifts.userId, actor.id), eq(shifts.status, "open"))).limit(1);
    if (existing) throw new ApiError(409, "لديك وردية مفتوحة بالفعل.", "SHIFT_ALREADY_OPEN");
    const inserted = await tx.insert(shifts).values({ userId: actor.id, startTime: new Date(), startingCash, status: "open" });
    const shiftId = Number(inserted[0].insertId);
    await audit(tx, actor.id, "shift_opened", "shift", shiftId, { startingCash });
    return shiftId;
  });
  const [shift] = await db.select().from(shifts).where(eq(shifts.id, id)).limit(1);
  res.status(201).json({ ok: true, shift });
}));

router.get("/shifts/:id", authenticate(), route(async (req, res) => {
  const actor = appUser(req);
  const id = numericId(req.params.id, "الوردية");
  const db = await dbOrThrow();
  const [shift] = await db.select({ shift: shifts, name: users.name, username: users.username })
    .from(shifts).innerJoin(users, eq(shifts.userId, users.id)).where(eq(shifts.id, id)).limit(1);
  if (!shift || (actor.role !== "admin" && (shift.shift.userId !== actor.id || shift.shift.status !== "open"))) {
    throw new ApiError(404, "الوردية غير موجودة أو لا تملك صلاحية عرضها.", "NOT_FOUND");
  }
  const sales = await db.select().from(invoices).where(eq(invoices.shiftId, id));
  const cash = sales.filter(row => row.paymentMethod === "cash");
  const card = sales.filter(row => row.paymentMethod === "card");
  const cashTotal = cash.reduce((sum, row) => addAggregateCents(sum, cents(row.netAmount), "إجمالي مبيعات النقد"), 0);
  const cardTotal = card.reduce((sum, row) => addAggregateCents(sum, cents(row.netAmount), "إجمالي مبيعات البطاقة"), 0);
  res.set("Cache-Control", "no-store").json({
    shift: { ...shift.shift, cashier: shift.name || shift.username },
    cash: { count: cash.length, total: formatMoney(cashTotal) },
    card: { count: card.length, total: formatMoney(cardTotal) },
    total: formatMoney(addAggregateCents(cashTotal, cardTotal, "إجمالي مبيعات الوردية")),
    expectedCash: formatMoney(addAggregateCents(cents(shift.shift.startingCash), cashTotal, "النقد المتوقع")),
  });
}));

router.post("/shifts/:id/close", authenticate(), requireCsrf, route(async (req, res) => {
  const actor = appUser(req);
  const id = numericId(req.params.id, "الوردية");
  const input = bodyOrThrow(z.object({ actualCash: z.union([z.string(), z.number()]) }), req.body);
  const actualCash = currencyInput(input.actualCash, "النقد الفعلي");
  const db = await dbOrThrow();
  const summary = await db.transaction(async tx => {
    const [shift] = await tx.select().from(shifts).where(eq(shifts.id, id)).limit(1).for("update");
    if (!shift || shift.status !== "open") throw new ApiError(409, "الوردية مغلقة بالفعل أو غير موجودة.", "SHIFT_CLOSED");
    if (actor.role !== "admin" && shift.userId !== actor.id) throw new ApiError(403, "لا تملك صلاحية إغلاق هذه الوردية.", "FORBIDDEN");
    const cashSales = await tx.select({ netAmount: invoices.netAmount }).from(invoices)
      .where(and(eq(invoices.shiftId, id), eq(invoices.paymentMethod, "cash")));
    const cardSales = await tx.select({ netAmount: invoices.netAmount }).from(invoices)
      .where(and(eq(invoices.shiftId, id), eq(invoices.paymentMethod, "card")));
    const cashTotal = cashSales.reduce((sum, row) => addAggregateCents(sum, cents(row.netAmount), "إجمالي مبيعات النقد"), 0);
    const cardTotal = cardSales.reduce((sum, row) => addAggregateCents(sum, cents(row.netAmount), "إجمالي مبيعات البطاقة"), 0);
    const expectedCents = addMoneyCents(cents(shift.startingCash), cashTotal, "النقد المتوقع");
    const differenceCents = cents(actualCash) - expectedCents;
    await tx.update(shifts).set({
      endTime: new Date(),
      expectedCash: formatMoney(expectedCents),
      actualCash,
      cashDifference: formatMoney(differenceCents),
      status: "closed",
    }).where(and(eq(shifts.id, id), eq(shifts.status, "open")));
    await audit(tx, actor.id, "shift_closed", "shift", id, { expected: formatMoney(expectedCents), actual: actualCash, difference: formatMoney(differenceCents) });
    return { cash: { count: cashSales.length, total: formatMoney(cashTotal) }, card: { count: cardSales.length, total: formatMoney(cardTotal) }, expectedCash: formatMoney(expectedCents) };
  });
  const [closed] = await db.select().from(shifts).where(eq(shifts.id, id)).limit(1);
  res.json({ ok: true, shift: closed, summary, backupUrl: actor.role === "admin" ? `/api/backups/shifts/${id}.sql.gz` : null });
}));

router.get("/backups/shifts/:id.sql.gz", authenticate(), route(async (req, res) => {
  requireAdmin(req);
  const id = numericId(req.params.id, "الوردية");
  const db = await dbOrThrow();
  const [shift] = await db.select({ id: shifts.id, status: shifts.status }).from(shifts).where(eq(shifts.id, id)).limit(1);
  if (!shift || shift.status !== "closed") throw new ApiError(404, "لا تتوفر نسخة لهذا الإغلاق.", "NOT_FOUND");
  const archive = await createSqlBackup();
  res.set({
    "Content-Type": "application/gzip",
    "Content-Disposition": `attachment; filename="m-pharmacy-backup-shift-${id}.sql.gz"`,
    "Cache-Control": "private, no-store",
    "Content-Length": String(archive.byteLength),
  }).send(archive);
}));

router.get("/audit", authenticate(), route(async (req, res) => {
  requireAdmin(req);
  const db = await dbOrThrow();
  const log = await db.select({
    id: auditLogs.id,
    action: auditLogs.action,
    targetType: auditLogs.targetType,
    targetId: auditLogs.targetId,
    details: auditLogs.details,
    createdAt: auditLogs.createdAt,
    actor: users.name,
    username: users.username,
  }).from(auditLogs).leftJoin(users, eq(auditLogs.actorId, users.id)).orderBy(desc(auditLogs.id)).limit(100);
  res.set("Cache-Control", "no-store").json({ log: log.map(row => ({ ...row, actor: row.actor || row.username })) });
}));

export const pharmacyRouter = router;

export const pharmacyErrorHandler: import("express").ErrorRequestHandler = (error, _req, res, _next) => {
  const candidate = error as { status?: number; code?: string; issues?: Array<{ message?: string }> };
  if (error instanceof ApiError) {
    res.status(error.status).set("Cache-Control", "no-store").json({ ok: false, error: error.message, code: error.code });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(422).set("Cache-Control", "no-store").json({ ok: false, error: error.issues[0]?.message || "تحقق من البيانات المدخلة.", code: "VALIDATION_FAILED" });
    return;
  }
  const status = typeof candidate.status === "number" && candidate.status >= 400 && candidate.status < 500 ? candidate.status : 500;
  if (status >= 500) console.error("[M Pharmacy API] Request failed:", error);
  res.status(status).set("Cache-Control", "no-store").json({ ok: false, error: status >= 500 ? "تعذر تنفيذ الطلب بسبب خطأ داخلي. حاول مرة أخرى." : "تعذر تنفيذ الطلب.", code: status >= 500 ? "INTERNAL_ERROR" : (candidate.code || "REQUEST_FAILED") });
};
