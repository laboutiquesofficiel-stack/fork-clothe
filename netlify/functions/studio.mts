import { randomBytes } from "node:crypto";
import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { studioDesigns } from "../../db/schema.js";
import { cleanDesign, loadStudioSettings, priceOf, studioOpen, tierOf } from "../../lib/studio.js";

/**
 * POST /api/studio/designs { design } → enregistre une création du Studio et
 * renvoie son identifiant, son niveau et son prix (calculés ici, jamais par le navigateur).
 */
export default async (request: Request) => {
  try {
    const settings = await loadStudioSettings();
    if (!studioOpen(settings)) {
      return Response.json({ error: "Le Studio ne prend pas de commandes en ce moment." }, { status: 409 });
    }
    const body = (await request.json().catch(() => null)) as { design?: unknown } | null;
    const result = await cleanDesign(body?.design, settings);
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    const tier = tierOf(result.design);
    const priceCents = priceOf(result.design, settings);
    const publicId = randomBytes(8).toString("hex");
    await db.insert(studioDesigns).values({
      publicId,
      design: result.design as unknown as Record<string, unknown>,
      tier,
      priceCents,
    });
    return Response.json({ id: publicId, tier, priceCents, design: result.design }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Studio design failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Impossible d'enregistrer ta création pour le moment." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/studio/designs", method: "POST" };
