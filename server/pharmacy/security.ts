import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { parse as parseCookies } from "cookie";
import { and, eq } from "drizzle-orm";
import { sessions, users } from "../../drizzle/schema";
import { ApiError } from "./domain";
import { getDb } from "../db";

export type PharmacyRole = "admin" | "pharmacist";
export type SafeUser = { id: number; name: string; username: string; role: PharmacyRole };
export type AuthenticatedRequest = Request & {
  pharmacyUser?: SafeUser;
  pharmacyCsrf?: string;
  pharmacySessionHash?: string;
};

const SESSION_COOKIE = "m_pharmacy_session";
const PREAUTH_COOKIE = "m_pharmacy_pre_auth";
const cookieBase = { path: "/", sameSite: "none" as const, secure: true };

function cookies(req: Request): Record<string, string> {
  try {
    return parseCookies(req.headers.cookie ?? "");
  } catch {
    return {};
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 64, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string | null | undefined): Promise<boolean> {
  if (!encoded) return false;
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt" || !/^[0-9a-f]{32}$/i.test(parts[1]) || !/^[0-9a-f]{128}$/i.test(parts[2])) {
    return false;
  }
  try {
    const candidate = await deriveKey(password, Buffer.from(parts[1], "hex"));
    const expected = Buffer.from(parts[2], "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function publicUser(user: { id: number; name: string | null; username: string | null; role: string }): SafeUser {
  if (user.role !== "admin" && user.role !== "pharmacist") {
    throw new ApiError(403, "لا يملك هذا الحساب دورًا صالحًا للدخول إلى نظام الصيدلية.", "ROLE_INVALID");
  }
  return { id: Number(user.id), name: user.name?.trim() || user.username || "مستخدم", username: user.username ?? "", role: user.role };
}

export function issuePreAuthCookie(res: Response): string {
  const token = randomBytes(32).toString("hex");
  res.cookie(PREAUTH_COOKIE, token, { ...cookieBase, httpOnly: true, maxAge: 60 * 60 * 1000 });
  return token;
}

export function validatePreAuth(req: Request): void {
  const cookieToken = cookies(req)[PREAUTH_COOKIE];
  const headerToken = req.get("x-csrf-token") ?? "";
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    throw new ApiError(403, "انتهت صلاحية نموذج الدخول. حدّث الصفحة ثم حاول مرة أخرى.", "CSRF_INVALID");
  }
}

export async function issueSession(res: Response, userId: number, remember: boolean): Promise<string> {
  const db = await getDb();
  if (!db) throw new ApiError(503, "قاعدة البيانات غير متاحة مؤقتًا.", "DATABASE_UNAVAILABLE");
  const rawToken = randomBytes(32).toString("hex");
  const csrfToken = randomBytes(32).toString("hex");
  const lifetime = remember ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + lifetime);
  await db.insert(sessions).values({ tokenHash: sha256(rawToken), userId, csrfToken, expiresAt });
  res.cookie(SESSION_COOKIE, rawToken, { ...cookieBase, httpOnly: true, ...(remember ? { maxAge: lifetime } : {}) });
  res.clearCookie(PREAUTH_COOKIE, { ...cookieBase, httpOnly: true });
  return csrfToken;
}

export async function resolveSession(req: Request): Promise<{ user: SafeUser; csrfToken: string; tokenHash: string } | null> {
  const rawToken = cookies(req)[SESSION_COOKIE];
  if (!rawToken || !/^[0-9a-f]{64}$/i.test(rawToken)) return null;
  const db = await getDb();
  if (!db) throw new ApiError(503, "قاعدة البيانات غير متاحة مؤقتًا.", "DATABASE_UNAVAILABLE");
  const tokenHash = sha256(rawToken);
  const [session] = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
    if (session) await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    return null;
  }
  const [user] = await db.select().from(users).where(and(eq(users.id, session.userId), eq(users.isActive, true))).limit(1);
  if (!user) {
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    return null;
  }
  return { user: publicUser(user), csrfToken: session.csrfToken, tokenHash };
}

export function optionalAuthenticate(): RequestHandler {
  return (req, _res, next) => {
    void resolveSession(req).then(session => {
      if (session) {
        const request = req as AuthenticatedRequest;
        request.pharmacyUser = session.user;
        request.pharmacyCsrf = session.csrfToken;
        request.pharmacySessionHash = session.tokenHash;
      }
      next();
    }).catch(next);
  };
}

export function authenticate(): RequestHandler {
  const optional = optionalAuthenticate();
  return (req, res, next) => optional(req, res, error => {
    if (error) return next(error);
    if (!(req as AuthenticatedRequest).pharmacyUser) return next(new ApiError(401, "انتهت الجلسة. سجّل الدخول مجددًا.", "UNAUTHENTICATED"));
    next();
  });
}

export const requireCsrf: RequestHandler = (req, _res, next) => {
  const request = req as AuthenticatedRequest;
  const header = req.get("x-csrf-token") ?? "";
  if (!request.pharmacyCsrf || !header || !safeEqual(request.pharmacyCsrf, header)) {
    next(new ApiError(403, "انتهت صلاحية الطلب. حدّث الصفحة وحاول مرة أخرى.", "CSRF_INVALID"));
    return;
  }
  next();
};

export function requireUser(req: Request): SafeUser {
  const user = (req as AuthenticatedRequest).pharmacyUser;
  if (!user) throw new ApiError(401, "سجّل الدخول للمتابعة.", "UNAUTHENTICATED");
  return user;
}

export function requireAdmin(req: Request): SafeUser {
  const user = requireUser(req);
  if (user.role !== "admin") throw new ApiError(403, "هذه العملية متاحة لمدير النظام فقط.", "FORBIDDEN");
  return user;
}

export async function revokeCurrentSession(req: Request, res: Response): Promise<void> {
  const request = req as AuthenticatedRequest;
  const db = await getDb();
  if (db && request.pharmacySessionHash) await db.delete(sessions).where(eq(sessions.tokenHash, request.pharmacySessionHash));
  res.clearCookie(SESSION_COOKIE, { ...cookieBase, httpOnly: true });
  res.clearCookie(PREAUTH_COOKIE, { ...cookieBase, httpOnly: true });
}
