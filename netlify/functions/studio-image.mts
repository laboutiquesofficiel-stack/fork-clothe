import type { Config } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { studioImages } from "../../db/schema.js";

/** GET /api/studio-image?id=…&k=… — sert une image importée (clé secrète obligatoire). */
export default async (request: Request) => {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const k = url.searchParams.get("k") ?? "";
  if (!/^[a-f0-9]{16}$/.test(id) || !/^[a-f0-9]{32}$/.test(k)) return new Response("Introuvable", { status: 404 });
  try {
    const [img] = await db
      .select({ key: studioImages.key, contentType: studioImages.contentType, data: studioImages.dataBase64 })
      .from(studioImages)
      .where(eq(studioImages.publicId, id))
      .limit(1);
    if (!img || img.key !== k) return new Response("Introuvable", { status: 404 });
    return new Response(Buffer.from(img.data, "base64"), {
      headers: { "Content-Type": img.contentType, "Cache-Control": "private, max-age=31536000, immutable", "X-Robots-Tag": "noindex" },
    });
  } catch (error) {
    console.error("Studio image failed", error instanceof Error ? error.message : "Unknown error");
    return new Response("Erreur", { status: 500 });
  }
};

export const config: Config = { path: "/api/studio-image", method: "GET" };
