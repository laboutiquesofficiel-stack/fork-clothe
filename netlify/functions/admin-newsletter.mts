import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { newsletterSubscribers } from "../../db/schema.js";

/**
 * GET /api/admin/newsletter → inscrits actifs (même code d'accès que les commandes).
 */

function isAuthorized(request: Request): boolean {
  const expected = process.env.ADMIN_TOKEN?.trim();
  if (!expected || expected.length < 24) return false;
  const header = request.headers.get("authorization") ?? "";
  const received = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!received) return false;
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export default async (request: Request) => {
  if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.trim().length < 24) {
    return Response.json({ error: "Gestion non configurée (ADMIN_TOKEN)." }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return Response.json({ error: "Code d’accès incorrect." }, { status: 401 });
  }
  try {
    const rows = await db
      .select({
        email: newsletterSubscribers.email,
        source: newsletterSubscribers.source,
        consentAt: newsletterSubscribers.consentAt,
      })
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.status, "subscribed"))
      .orderBy(desc(newsletterSubscribers.consentAt));
    return Response.json({ subscribers: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Admin newsletter failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Erreur serveur." }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/admin/newsletter",
  method: "GET",
};
