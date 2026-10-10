import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { orders, productReviews, reviewPhotos } from "../../db/schema.js";
import { notifyReviewReply } from "../../lib/notifications.js";
import { cleanText } from "../../lib/reviews.js";

/**
 * Gestion des avis par la boutique (même code d'accès que les commandes).
 *
 * GET  /api/admin/reviews → 100 derniers avis, publiés et masqués
 * POST /api/admin/reviews { id, action: "hide" | "show" | "reply" | "remove-reply", reply? }
 *
 * Un avis ne doit être masqué que s'il est injurieux, hors sujet ou contient
 * des données personnelles, jamais parce qu'il est négatif.
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
  const noStore = { "Cache-Control": "no-store" };

  try {
    if (request.method === "GET") {
      const rows = await db
        .select({
          id: productReviews.id,
          sku: productReviews.productSku,
          authorName: productReviews.authorName,
          size: productReviews.size,
          rating: productReviews.rating,
          title: productReviews.title,
          body: productReviews.body,
          status: productReviews.status,
          shopReply: productReviews.shopReply,
          createdAt: productReviews.createdAt,
          orderNumber: orders.orderNumber,
          customerEmail: orders.customerEmail,
        })
        .from(productReviews)
        .innerJoin(orders, eq(orders.id, productReviews.orderId))
        .orderBy(desc(productReviews.createdAt))
        .limit(100);

      const photos = rows.length
        ? await db
            .select({ id: reviewPhotos.id, reviewId: reviewPhotos.reviewId })
            .from(reviewPhotos)
            .where(inArray(reviewPhotos.reviewId, rows.map((r) => r.id)))
            .orderBy(asc(reviewPhotos.position))
        : [];

      return Response.json(
        {
          reviews: rows.map((r) => ({
            ...r,
            photos: photos.filter((p) => p.reviewId === r.id).map((p) => `/api/review-photo?id=${p.id}`),
          })),
        },
        { headers: noStore },
      );
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Méthode non autorisée." }, { status: 405 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const id = Number(body?.id);
    const action = cleanText(body?.action, 20);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: "Avis introuvable." }, { status: 400 });
    }

    let updated: { id: number }[] = [];
    if (action === "hide" || action === "show") {
      updated = await db
        .update(productReviews)
        .set({ status: action === "hide" ? "hidden" : "published", updatedAt: new Date() })
        .where(eq(productReviews.id, id))
        .returning({ id: productReviews.id });
    } else if (action === "reply") {
      const reply = cleanText(body?.reply, 1500);
      if (reply.length < 2) return Response.json({ error: "Réponse vide." }, { status: 400 });
      updated = await db
        .update(productReviews)
        .set({ shopReply: reply, shopRepliedAt: new Date(), updatedAt: new Date() })
        .where(eq(productReviews.id, id))
        .returning({ id: productReviews.id });
      if (updated.length) await notifyReviewReply(id);
    } else if (action === "remove-reply") {
      updated = await db
        .update(productReviews)
        .set({ shopReply: null, shopRepliedAt: null, updatedAt: new Date() })
        .where(eq(productReviews.id, id))
        .returning({ id: productReviews.id });
    } else {
      return Response.json({ error: "Action inconnue." }, { status: 400 });
    }

    if (!updated.length) return Response.json({ error: "Avis introuvable." }, { status: 404 });
    return Response.json({ ok: true }, { headers: noStore });
  } catch (error) {
    console.error("Admin reviews failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Erreur serveur." }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/admin/reviews",
  method: ["GET", "POST"],
};
