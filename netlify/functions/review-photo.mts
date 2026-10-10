import type { Config } from "@netlify/functions";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { productReviews, reviewPhotos } from "../../db/schema.js";

/**
 * GET /api/review-photo?id=…
 *
 * Sert une photo d'avis, uniquement si l'avis est publié.
 * Le type est celui vérifié à l'envoi (JPEG, PNG ou WebP).
 */
export default async (request: Request) => {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return new Response("Photo introuvable.", { status: 404 });

  try {
    const [photo] = await db
      .select({ contentType: reviewPhotos.contentType, data: reviewPhotos.dataBase64 })
      .from(reviewPhotos)
      .innerJoin(productReviews, eq(productReviews.id, reviewPhotos.reviewId))
      .where(and(eq(reviewPhotos.id, id), eq(productReviews.status, "published")))
      .limit(1);
    if (!photo) return new Response("Photo introuvable.", { status: 404 });

    return new Response(Buffer.from(photo.data, "base64"), {
      headers: {
        "Content-Type": photo.contentType,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    console.error("Review photo failed", error instanceof Error ? error.message : "Unknown error");
    return new Response("Photo indisponible.", { status: 500 });
  }
};

export const config: Config = {
  path: "/api/review-photo",
  method: "GET",
};
