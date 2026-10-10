import type { Config } from "@netlify/functions";
import { and, asc, avg, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { productReviews, reviewPhotos, users } from "../../db/schema.js";
import { getSessionUserId } from "../../lib/auth.js";
import { notifyNewReview } from "../../lib/notifications.js";
import {
  cleanText,
  displayName,
  findBuyerOrders,
  listReviewableItems,
  normalizeEmail,
  parsePhoto,
} from "../../lib/reviews.js";

/**
 * Avis clients.
 *
 * GET  /api/reviews              → moyenne et nombre d'avis publiés par t-shirt
 * GET  /api/reviews?sku=…        → idem + avis publiés de ce t-shirt (récents d'abord)
 * POST /api/reviews { action: "eligibility", orderNumber?, email? }
 *      → t-shirts que l'acheteur peut noter (session, ou n° de commande + e-mail)
 * POST /api/reviews { action: "submit", orderNumber, email?, sku, rating, title, body, photos[] }
 *      → publie l'avis si l'achat est vérifié et pas encore noté
 */

const MAX_PHOTOS = 3;

async function summary() {
  const rows = await db
    .select({ sku: productReviews.productSku, average: avg(productReviews.rating), count: count() })
    .from(productReviews)
    .where(eq(productReviews.status, "published"))
    .groupBy(productReviews.productSku);
  const result: Record<string, { average: number; count: number }> = {};
  for (const row of rows) {
    result[row.sku] = { average: Math.round(Number(row.average ?? 0) * 10) / 10, count: Number(row.count) };
  }
  return result;
}

async function publishedReviews(sku: string) {
  const rows = await db
    .select({
      id: productReviews.id,
      authorName: productReviews.authorName,
      size: productReviews.size,
      rating: productReviews.rating,
      title: productReviews.title,
      body: productReviews.body,
      shopReply: productReviews.shopReply,
      shopRepliedAt: productReviews.shopRepliedAt,
      createdAt: productReviews.createdAt,
    })
    .from(productReviews)
    .where(and(eq(productReviews.productSku, sku), eq(productReviews.status, "published")))
    .orderBy(desc(productReviews.createdAt))
    .limit(200);
  if (!rows.length) return [];

  const photos = await db
    .select({ id: reviewPhotos.id, reviewId: reviewPhotos.reviewId })
    .from(reviewPhotos)
    .where(inArray(reviewPhotos.reviewId, rows.map((r) => r.id)))
    .orderBy(asc(reviewPhotos.position));
  return rows.map((r) => ({
    ...r,
    verified: true,
    photos: photos.filter((p) => p.reviewId === r.id).map((p) => `/api/review-photo?id=${p.id}`),
  }));
}

export default async (request: Request) => {
  const noStore = { "Cache-Control": "no-store" };

  try {
    if (request.method === "GET") {
      const sku = cleanText(new URL(request.url).searchParams.get("sku"), 80);
      return Response.json(
        { summary: await summary(), reviews: sku ? await publishedReviews(sku) : [] },
        { headers: noStore },
      );
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Méthode non autorisée." }, { status: 405 });
    }

    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 5_500_000) {
      return Response.json({ error: "Photos trop lourdes." }, { status: 413 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = cleanText(body?.action, 20);
    const userId = await getSessionUserId(request);
    const orderNumber = cleanText(body?.orderNumber, 80).toUpperCase();
    const email = normalizeEmail(body?.email);

    if (action === "eligibility") {
      if (!userId && (!orderNumber || !email)) {
        return Response.json({ error: "Indique ton numéro de commande et l'e-mail utilisé pour commander." }, { status: 400 });
      }
      const buyerOrders = await findBuyerOrders({ userId, orderNumber: userId ? orderNumber || undefined : orderNumber, email });
      return Response.json({ items: await listReviewableItems(buyerOrders) }, { headers: noStore });
    }

    if (action !== "submit") {
      return Response.json({ error: "Action inconnue." }, { status: 400 });
    }

    const sku = cleanText(body?.sku, 80);
    const rating = Number(body?.rating);
    const title = cleanText(body?.title, 80);
    const text = cleanText(body?.body, 2000);
    const rawPhotos = Array.isArray(body?.photos) ? body.photos : [];

    if (!orderNumber || !sku) {
      return Response.json({ error: "Commande ou t-shirt manquant." }, { status: 400 });
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return Response.json({ error: "Choisis une note de 1 à 5 étoiles." }, { status: 400 });
    }
    if (text.length < 10) {
      return Response.json({ error: "Ton avis doit faire au moins 10 caractères." }, { status: 400 });
    }
    if (rawPhotos.length > MAX_PHOTOS) {
      return Response.json({ error: `${MAX_PHOTOS} photos maximum.` }, { status: 400 });
    }
    const photos = rawPhotos.map(parsePhoto);
    if (photos.some((p) => !p)) {
      return Response.json({ error: "Une photo n'a pas pu être lue (JPEG, PNG ou WebP, 1,5 Mo maximum)." }, { status: 400 });
    }

    const buyerOrders = await findBuyerOrders({ userId, orderNumber, email });
    const order = buyerOrders[0];
    if (!order) {
      return Response.json(
        { error: "Commande introuvable, pas encore expédiée, ou e-mail différent de celui de la commande." },
        { status: 403 },
      );
    }
    const item = (await listReviewableItems([order])).find((i) => i.sku === sku);
    if (!item) {
      return Response.json({ error: "Ce t-shirt ne fait pas partie de cette commande." }, { status: 403 });
    }
    if (item.reviewed) {
      return Response.json({ error: "Tu as déjà donné ton avis sur ce t-shirt pour cette commande." }, { status: 409 });
    }

    let authorName = displayName(order.customerName);
    if (userId) {
      const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
      if (user?.name) authorName = displayName(user.name);
    }

    const [created] = await db
      .insert(productReviews)
      .values({
        productSku: sku,
        orderId: order.id,
        userId: userId ?? order.userId,
        authorName,
        size: item.size,
        rating,
        title: title || null,
        body: text,
      })
      .onConflictDoNothing()
      .returning({ id: productReviews.id });

    if (!created) {
      return Response.json({ error: "Tu as déjà donné ton avis sur ce t-shirt pour cette commande." }, { status: 409 });
    }

    if (photos.length) {
      await db.insert(reviewPhotos).values(
        photos.map((p, position) => ({
          reviewId: created.id,
          position,
          contentType: p!.contentType,
          dataBase64: p!.base64,
        })),
      );
    }

    await notifyNewReview(created.id);
    return Response.json({ ok: true, id: created.id }, { status: 201, headers: noStore });
  } catch (error) {
    console.error("Reviews failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Impossible d'enregistrer l'avis pour le moment." }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/reviews",
  method: ["GET", "POST"],
};
