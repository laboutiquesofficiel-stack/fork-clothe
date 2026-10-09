import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { sessions } from "../db/schema.js";

/**
 * Sessions client FORK.
 *
 * Le navigateur ne reçoit qu'un jeton aléatoire, dans un cookie HttpOnly.
 * La base ne stocke que son empreinte SHA-256 : une fuite de la table
 * sessions ne permet pas de se connecter à la place d'un client.
 */

export const SESSION_COOKIE = "fork_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(valueParts.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Identifiant du client connecté, ou null (invité, session absente ou expirée). */
export async function getSessionUserId(request: Request): Promise<number | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const [session] = await db
    .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);

  if (!session || session.expiresAt.getTime() <= Date.now()) return null;
  return session.userId;
}

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
  });
  return token;
}

/** Supprime en base la session portée par la requête, si elle existe. */
export async function deleteSession(request: Request): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export function sessionCookie(token: string): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ].join("; ");
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
