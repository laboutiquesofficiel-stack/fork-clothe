import type { Config, Context } from "@netlify/functions";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "../../db/index.js";
import { orders, payments } from "../../db/schema.js";
import { confirmSumUpCheckout, lastConfirmReason } from "../../lib/sumup.js";

/**
 * Statut d'une commande pour la page de retour après paiement.
 *
 * Le navigateur doit fournir le numéro de commande ET le jeton de commande
 * qu'il a lui-même généré : connaître seulement un numéro de commande ne
 * suffit pas pour lire une commande. Aucune donnée personnelle n'est renvoyée.
 *
 * Si la commande n'est pas encore payée, le serveur interroge lui-même SumUp
 * pour les paiements en attente de cette commande (même vérification que le
 * webhook). Le navigateur ne fait que demander : il n'apporte aucune preuve.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function readOrder(orderNumber: string, token: string) {
  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      totalCents: orders.totalCents,
      currency: orders.currency,
    })
    .from(orders)
    .where(and(eq(orders.orderNumber, orderNumber), eq(orders.checkoutToken, token)))
    .limit(1);
  return order ?? null;
}

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);
  const orderNumber = (url.searchParams.get("order") ?? "").trim().slice(0, 80);
  const token = (url.searchParams.get("token") ?? "").trim();

  if (!orderNumber || !UUID_PATTERN.test(token)) {
    return Response.json({ error: "Commande introuvable." }, { status: 404 });
  }

  try {
    const diagnostics: string[] = [];
    let order = await readOrder(orderNumber, token);
    if (!order) {
      return Response.json({ error: "Commande introuvable." }, { status: 404 });
    }

    if (order.paymentStatus !== "paid" && order.status === "pending_payment") {
      const pending = await db
        .select({ checkoutId: payments.providerPaymentId })
        .from(payments)
        .where(and(eq(payments.orderId, order.id), eq(payments.provider, "sumup"), ne(payments.status, "paid")))
        .orderBy(desc(payments.createdAt))
        .limit(3);

      if (pending.length === 0) diagnostics.push("aucun paiement SumUp en attente enregistré pour cette commande");
      for (const { checkoutId } of pending) {
        if (!checkoutId) continue;
        const result = await confirmSumUpCheckout(checkoutId);
        diagnostics.push(lastConfirmReason || result);
        if (result === "paid") break;
      }
      order = (await readOrder(orderNumber, token)) ?? order;
    }

    const { id: _id, ...publicOrder } = order;
    // Raisons détaillées uniquement hors production, pour diagnostiquer depuis le téléphone.
    const debug = context?.deploy?.context !== "production" && diagnostics.length ? diagnostics.join(" · ") : undefined;
    return Response.json({ ...publicOrder, debug }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Order status failed", message);
    const debug = context?.deploy?.context !== "production" ? message.slice(0, 300) : undefined;
    return Response.json({ error: "Statut indisponible pour le moment.", debug }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/order-status",
  method: "GET",
};
