import type { Config } from "@netlify/functions";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { moments } from "../../db/schema.js";

/** GET /api/moment-photo?id=… — sert une photo « Vos moments », uniquement si elle est publiée. */
export default async (request: Request) => {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return new Response("Photo introuvable.", { status: 404 });
  try {
    const [m] = await db
      .select({ contentType: moments.contentType, data: moments.dataBase64 })
      .from(moments)
      .where(and(eq(moments.id, id), eq(moments.status, "published")))
      .limit(1);
    if (!m) return new Response("Photo introuvable.", { status: 404 });
    return new Response(Buffer.from(m.data, "base64"), {
      headers: {
        "Content-Type": m.contentType,
        "Cache-Control": "public, max-age=600",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    console.error("Moment photo failed", error instanceof Error ? error.message : "Unknown error");
    return new Response("Photo indisponible.", { status: 500 });
  }
};

export const config: Config = { path: "/api/moment-photo", method: "GET" };
