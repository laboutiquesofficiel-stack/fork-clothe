import type { Config } from "@netlify/functions";
import { confirmSumUpCheckout, isCheckoutId } from "../../lib/sumup.js";

/**
 * Webhook SumUp. SumUp envoie { event_type, id } où id est l'identifiant du
 * checkout. Le contenu du message n'est jamais cru : confirmSumUpCheckout
 * relit le checkout chez SumUp et vérifie tout avant d'écrire.
 *
 * Réponses : 200 quand l'événement est traité ou volontairement ignoré,
 * 5xx quand SumUp doit réessayer (clé absente, SumUp ou base indisponible).
 */
export default async (request: Request) => {
  if (request.method !== "POST") return new Response(null, { status: 405 });

  try {
    const body = (await request.json().catch(() => ({}))) as { id?: unknown };
    const checkoutId = typeof body?.id === "string" ? body.id.trim() : "";
    if (!isCheckoutId(checkoutId)) return new Response(null, { status: 400 });

    const result = await confirmSumUpCheckout(checkoutId);
    return new Response(null, { status: result === "retry" ? 502 : 200 });
  } catch (error) {
    console.error("SumUp webhook failed", error instanceof Error ? error.message : "Unknown error");
    return new Response(null, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/sumup-webhook",
  method: "POST",
};
