import { randomBytes } from "node:crypto";
import { eq, isNotNull } from "drizzle-orm";
import { appState, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { hashPassword } from "./security";

export async function ensureInitialAdmin(): Promise<void> {
  const password = process.env.PHARMACY_INITIAL_ADMIN_PASSWORD;
  const db = await getDb();
  if (!db) throw new Error("Database is required to start M Pharmacy");

  await db.transaction(async tx => {
    await tx.insert(appState).values({ id: 1, bootstrapDone: false }).onDuplicateKeyUpdate({ set: { id: 1 } });
    const [state] = await tx.select().from(appState).where(eq(appState.id, 1)).for("update");
    if (!state || state.bootstrapDone) return;

    const [existingUser] = await tx.select({ id: users.id }).from(users).where(isNotNull(users.username)).limit(1);
    if (existingUser) {
      await tx.update(appState).set({ bootstrapDone: true }).where(eq(appState.id, 1));
      return;
    }

    if (!password || password.length < 12) {
      console.warn("[M Pharmacy] Initial admin is not configured; set PHARMACY_INITIAL_ADMIN_PASSWORD before access is opened.");
      return;
    }

    await tx.insert(users).values({
      openId: `mp_${randomBytes(18).toString("hex")}`,
      name: "مدير النظام",
      username: "admin",
      passwordHash: await hashPassword(password),
      role: "admin",
      loginMethod: "password",
      isActive: true,
    });
    await tx.update(appState).set({ bootstrapDone: true }).where(eq(appState.id, 1));
    console.info("[M Pharmacy] First administrator created once; the initial password is stored only as a password hash.");
  });
}

export async function bootstrapRequired(): Promise<boolean> {
  const db = await getDb();
  if (!db) return true;
  const [row] = await db.select({ id: users.id }).from(users).where(isNotNull(users.username)).limit(1);
  return !row;
}
