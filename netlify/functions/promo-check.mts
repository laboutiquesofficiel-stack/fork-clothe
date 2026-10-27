import type { Config } from "@netlify/functions";
import { checkCode } from "../../lib/promos.js";

/**
 * POST /api/promo-check { code, email } → aperçu d'un code promo ou d'une
 * carte cadeau. Rien n'est consommé : la commande recalcule tout.
 */
export default async (request: Request) => {
  try {
    const body = (await request.json().catch(() => null)) as { code?: unknown; email?: unknown } | null;
    const result = await checkCode(body?.code, body?.email);
    if (!result.ok) return Response.json({ ok: false, code: result.code, error: result.error }, { status: 200 });
    return Response.json(
      result.kind === "gift"
        ? { ok: true, kind: "gift", code: result.code, balanceCents: result.balanceCents }
        : { ok: true, kind: "percent", code: result.code, percent: result.percent },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Promo check failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ ok: false, error: "Vérification impossible pour le moment, réessaie." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/promo-check", method: "POST" };
