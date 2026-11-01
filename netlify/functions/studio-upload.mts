import { createHash, randomBytes } from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../../db/index.js";
import { studioImages } from "../../db/schema.js";
import { checkStudioImage } from "../../lib/studio-check.js";
import { loadStudioSettings, studioOpen } from "../../lib/studio.js";

/**
 * POST /api/studio/upload { image: "data:image/…;base64,…", width, height }
 * Image importée pour FORK Unlimited. Vérifiée par l'IA (premier tri), puis
 * par FORK avant fabrication. Limite : 15 images par jour et par appareil.
 */
const MAX_BASE64 = 5_500_000;
const PER_DAY = 15;

export default async (request: Request, context: Context) => {
  try {
    const settings = await loadStudioSettings();
    if (!studioOpen(settings)) return Response.json({ error: "Le Studio ne prend pas de commandes en ce moment." }, { status: 409 });
    const body = (await request.json().catch(() => null)) as { image?: unknown; width?: unknown; height?: unknown } | null;
    const match = typeof body?.image === "string" ? /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.image) : null;
    if (!match) return Response.json({ error: "Image illisible : choisis une photo JPEG ou PNG." }, { status: 400 });
    if (match[2].length > MAX_BASE64) return Response.json({ error: "Image trop lourde." }, { status: 413 });
    const width = Math.round(Number(body?.width));
    const height = Math.round(Number(body?.height));
    if (!(width > 0 && height > 0 && width <= 6000 && height <= 6000)) return Response.json({ error: "Dimensions de l'image invalides." }, { status: 400 });

    const secret = process.env.ADMIN_TOKEN?.trim() || "fork";
    const ip = context.ip || request.headers.get("x-nf-client-connection-ip") || "";
    const visitorHash = createHash("sha256").update(`${secret}|studio|${ip}|${request.headers.get("user-agent") ?? ""}`).digest("hex").slice(0, 32);
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const recent = await db
      .select({ id: studioImages.id })
      .from(studioImages)
      .where(and(eq(studioImages.visitorHash, visitorHash), gt(studioImages.createdAt, since)))
      .limit(PER_DAY);
    if (recent.length >= PER_DAY) return Response.json({ error: "Tu as importé beaucoup d'images aujourd'hui : réessaie demain." }, { status: 429 });

    // L'IA ne reçoit qu'une copie réduite si l'image est très lourde (la vérification porte sur le contenu).
    const verdict = match[2].length <= 4_500_000 ? await checkStudioImage({ contentType: match[1], base64: match[2] }) : null;
    if (verdict && !verdict.allowed) {
      return Response.json({ error: "Cette image ne peut pas être imprimée sur un t-shirt FORK. Choisis-en une autre." }, { status: 422 });
    }
    const publicId = randomBytes(8).toString("hex");
    const key = randomBytes(16).toString("hex");
    await db.insert(studioImages).values({
      publicId,
      key,
      contentType: match[1],
      dataBase64: match[2],
      width,
      height,
      aiVerdict: verdict as unknown as Record<string, unknown> | null,
      aiNote: verdict ? verdict.note : "Vérification automatique indisponible : à regarder de près.",
      visitorHash,
    });
    return Response.json(
      {
        id: publicId,
        k: key,
        width,
        height,
        warning: verdict?.thirdPartyRights
          ? "Attention : cette image semble contenir une marque, un personnage ou un visuel protégé. FORK vérifiera tes droits avant fabrication et pourra refuser la création."
          : null,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Studio upload failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Import impossible pour le moment." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/studio/upload", method: "POST" };
