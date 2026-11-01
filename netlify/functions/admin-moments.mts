import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "../../db/index.js";
import { moments } from "../../db/schema.js";
import { productBySku } from "../../lib/moments.js";
import { notifyMomentPublished } from "../../lib/notifications.js";

/**
 * « Vos moments » dans l'admin (même code d'accès que les commandes).
 *
 * GET  /api/admin/moments → photos en attente et publiées (avec l'image), 60 dernières
 * POST /api/admin/moments { id, action: "publish" | "hide" | "delete" }
 *   publish : met en ligne (e-mail à la personne la première fois) ;
 *   hide : retire du site ; delete : supprime définitivement (demande de retrait).
 * POST /api/admin/moments { action: "create", photo: "data:image/jpeg;base64,…", place?, sku? }
 *   photo publiée par FORK elle-même : affichée « Par FORK » sur le site, jamais comme un client.
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

async function list() {
  const rows = await db
    .select({
      id: moments.id,
      status: moments.status,
      firstName: moments.firstName,
      place: moments.place,
      productSku: moments.productSku,
      email: moments.email,
      contentType: moments.contentType,
      data: moments.dataBase64,
      aiNote: moments.aiNote,
      createdAt: moments.createdAt,
      publishedAt: moments.publishedAt,
      byShop: moments.byShop,
    })
    .from(moments)
    .orderBy(desc(moments.id))
    .limit(60);
  return {
    moments: rows.map((m: { id: number; status: string; firstName: string; place: string | null; productSku: string | null; email: string; contentType: string; data: string; aiNote: string | null; createdAt: Date; publishedAt: Date | null; byShop: boolean }) => {
      const p = productBySku(m.productSku);
      return {
        id: m.id,
        status: m.status,
        firstName: m.firstName,
        place: m.place,
        product: p ? `${p.type} ${p.name}` : null,
        email: m.email,
        aiNote: m.aiNote,
        createdAt: m.createdAt,
        publishedAt: m.publishedAt,
        image: `data:${m.contentType};base64,${m.data}`,
        byShop: m.byShop,
      };
    }),
  };
}

export default async (request: Request) => {
  if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.trim().length < 24) {
    return Response.json({ error: "Gestion non configurée (ADMIN_TOKEN)." }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return Response.json({ error: "Code d’accès incorrect." }, { status: 401 });
  }
  const noStore = { "Cache-Control": "no-store" };
  try {
    if (request.method === "GET") return Response.json(await list(), { headers: noStore });

    const body = (await request.json().catch(() => null)) as { id?: unknown; action?: unknown; photo?: unknown; place?: unknown; sku?: unknown } | null;
    const action = body?.action;

    if (action === "create") {
      const match = typeof body?.photo === "string" ? /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.photo) : null;
      if (!match) return Response.json({ error: "Photo illisible : choisis une image JPEG ou PNG." }, { status: 400 });
      if (match[2].length > 3_000_000) return Response.json({ error: "Photo trop lourde." }, { status: 413 });
      const place = typeof body?.place === "string" ? body.place.replace(/\s+/g, " ").trim().slice(0, 60) || null : null;
      const sku = typeof body?.sku === "string" && productBySku(body.sku) ? body.sku : null;
      await db.insert(moments).values({
        status: "published",
        firstName: "FORK",
        place,
        productSku: sku,
        email: process.env.SHOP_EMAIL?.trim() || "forkofficiel@gmail.com",
        contentType: match[1],
        dataBase64: match[2],
        aiNote: "Photo publiée par FORK",
        publishedAt: new Date(),
        byShop: true,
      });
      return Response.json(await list(), { headers: noStore, status: 201 });
    }

    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Photo introuvable." }, { status: 400 });

    if (action === "publish") {
      const done = await db
        .update(moments)
        .set({ status: "published", publishedAt: new Date() })
        .where(and(eq(moments.id, id), ne(moments.status, "published")))
        .returning({ id: moments.id });
      if (done[0]) await notifyMomentPublished(id);
    } else if (action === "hide") {
      await db.update(moments).set({ status: "hidden" }).where(eq(moments.id, id));
    } else if (action === "delete") {
      await db.delete(moments).where(eq(moments.id, id));
    } else {
      return Response.json({ error: "Action inconnue." }, { status: 400 });
    }
    return Response.json(await list(), { headers: noStore });
  } catch (error) {
    console.error("Admin moments failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Erreur serveur." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/admin/moments", method: ["GET", "POST"] };
