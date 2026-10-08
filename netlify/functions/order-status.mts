import type { Config } from "@netlify/functions";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { orders } from "../../db/schema.js";

/**
 * Statut d'une commande pour la page de retour après paiement.
 *
 * Le navigateur doit fournir le numéro de commande ET le jeton de commande
 * qu'il a lui-même généré : connaître seulement un numéro de commande ne
 * suffit pas pour lire une commande. Aucune donnée personnelle n'est renvoyée.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async (request: Request) => {
  const url = new URL(request.url);
  const orderNumber = (url.searchParams.get("order") ?? "").trim().slice(0, 80);
  const token = (url.searchParams.get("token") ?? "").trim();

  if (!orderNumber || !UUID_PATTERN.test(token)) {
    return Response.json({ error: "Commande introuvable." }, { status: 404 });
  }

  try {
    const [order] = await db
      .select({
        orderNumber: orders.orderNumber,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        totalCents: orders.totalCents,
        currency: orders.currency,
      })
      .from(orders)
      .where(and(eq(orders.orderNumber, orderNumber), eq(orders.checkoutToken, token)))
      .limit(1);

    if (!order) {
      return Response.json({ error: "Commande introuvable." }, { status: 404 });
    }

    return Response.json(order, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Order status failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Statut indisponible pour le moment." }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/order-status",
  method: "GET",
};
