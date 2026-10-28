import {
  boolean,
  date,
  datetime,
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/** Application accounts retain the template's OAuth columns for migration compatibility. */
export const users = mysqlTable(
  "users",
  {
    id: int("id").autoincrement().primaryKey(),
    openId: varchar("openId", { length: 64 }).notNull().unique(),
    name: text("name"),
    email: varchar("email", { length: 320 }),
    loginMethod: varchar("loginMethod", { length: 64 }),
    role: mysqlEnum("role", ["user", "admin", "pharmacist"]).default("user").notNull(),
    username: varchar("username", { length: 50 }),
    passwordHash: varchar("password_hash", { length: 255 }),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  },
  table => ({ usernameUnique: uniqueIndex("users_username_unique").on(table.username) }),
);

export const categories = mysqlTable("categories", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
});

export const medicines = mysqlTable(
  "medicines",
  {
    id: int("id").autoincrement().primaryKey(),
    barcode: varchar("barcode", { length: 64 }),
    name: varchar("name", { length: 150 }).notNull(),
    activeIngredient: varchar("active_ingredient", { length: 150 }),
    categoryId: int("category_id").references(() => categories.id, { onDelete: "set null" }),
    buyPrice: decimal("buy_price", { precision: 10, scale: 2 }).default("0.00").notNull(),
    sellPrice: decimal("sell_price", { precision: 10, scale: 2 }).default("0.00").notNull(),
    quantity: int("quantity").default(0).notNull(),
    expiryDate: date("expiry_date", { mode: "string" }).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({
    barcodeIdx: index("medicines_barcode_idx").on(table.barcode),
    nameIdx: index("medicines_name_idx").on(table.name),
    ingredientIdx: index("medicines_ingredient_idx").on(table.activeIngredient),
    expiryQuantityIdx: index("medicines_expiry_quantity_idx").on(table.expiryDate, table.quantity),
  }),
);

export const shifts = mysqlTable(
  "shifts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull().references(() => users.id),
    startTime: datetime("start_time").notNull(),
    endTime: datetime("end_time"),
    startingCash: decimal("starting_cash", { precision: 10, scale: 2 }).default("0.00").notNull(),
    expectedCash: decimal("expected_cash", { precision: 10, scale: 2 }),
    actualCash: decimal("actual_cash", { precision: 10, scale: 2 }),
    cashDifference: decimal("cash_difference", { precision: 10, scale: 2 }),
    status: mysqlEnum("status", ["open", "closed"]).default("open").notNull(),
  },
  table => ({ userStatusIdx: index("shifts_user_status_idx").on(table.userId, table.status) }),
);

export const invoices = mysqlTable(
  "invoices",
  {
    id: int("id").autoincrement().primaryKey(),
    invoiceNumber: varchar("invoice_number", { length: 30 }).notNull().unique(),
    idempotencyKey: varchar("idempotency_key", { length: 64 }).notNull().unique(),
    userId: int("user_id").notNull().references(() => users.id),
    shiftId: int("shift_id").notNull().references(() => shifts.id),
    paymentMethod: mysqlEnum("payment_method", ["cash", "card"]).notNull(),
    totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
    discount: decimal("discount", { precision: 10, scale: 2 }).default("0.00").notNull(),
    netAmount: decimal("net_amount", { precision: 10, scale: 2 }).notNull(),
    cashReceived: decimal("cash_received", { precision: 10, scale: 2 }),
    changeGiven: decimal("change_given", { precision: 10, scale: 2 }).default("0.00").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({
    shiftPaymentIdx: index("invoices_shift_payment_idx").on(table.shiftId, table.paymentMethod),
    createdIdx: index("invoices_created_idx").on(table.createdAt),
    userCreatedIdx: index("invoices_user_created_idx").on(table.userId, table.createdAt),
  }),
);

export const invoiceItems = mysqlTable(
  "invoice_items",
  {
    id: int("id").autoincrement().primaryKey(),
    invoiceId: int("invoice_id").notNull().references(() => invoices.id),
    medicineId: int("medicine_id").references(() => medicines.id),
    serviceName: varchar("service_name", { length: 100 }),
    productName: varchar("product_name", { length: 150 }).notNull(),
    barcodeSnapshot: varchar("barcode_snapshot", { length: 64 }),
    quantity: int("quantity").notNull(),
    unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
    unitCost: decimal("unit_cost", { precision: 10, scale: 2 }).default("0.00").notNull(),
    totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
  },
  table => ({
    invoiceIdx: index("invoice_items_invoice_idx").on(table.invoiceId),
    medicineIdx: index("invoice_items_medicine_idx").on(table.medicineId),
  }),
);

export const sessions = mysqlTable(
  "sessions",
  {
    tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
    userId: int("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    csrfToken: varchar("csrf_token", { length: 64 }).notNull(),
    expiresAt: datetime("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({ userIdx: index("sessions_user_idx").on(table.userId), expiresIdx: index("sessions_expires_idx").on(table.expiresAt) }),
);

export const appState = mysqlTable("app_state", {
  id: int("id").primaryKey(),
  bootstrapDone: boolean("bootstrap_done").default(false).notNull(),
});

export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    actorId: int("actor_id").references(() => users.id),
    action: varchar("action", { length: 64 }).notNull(),
    targetType: varchar("target_type", { length: 64 }).notNull(),
    targetId: varchar("target_id", { length: 64 }),
    details: text("details"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({ actorCreatedIdx: index("audit_actor_created_idx").on(table.actorId, table.createdAt) }),
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Medicine = typeof medicines.$inferSelect;
export type Shift = typeof shifts.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
