import type { Config } from "@netlify/functions";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { orders, payments } from "../../db/schema.js";
import { notifyOrderPaid } from "../../lib/notifications.js";

/**
 * Webhook SumUp : seule source de vérité pour passer une commande en « payée ».
 *
 * SumUp envoie { event_type, id } où id est l'identifiant du checkout. On ne
 * fait confiance à rien dans ce message : on relit le checkout directement
 * chez SumUp avec notre clé, puis on vérifie statut, marchand, montant et
 * devise avant toute écriture.
 *
 * Idempotence : la commande n'est mise à jour que si elle n'est pas déjà
 * payée. Un webhook rejoué ne renvoie pas d'e-mail, ne crée pas de doublon
 * de paiement et ne fait jamais reculer une commande déjà expédiée.
 *
 * Réponses : 200 quand l'événement est traité ou volontairement ignoré,
 * 5xx quand SumUp doit réessayer (clé absente, SumUp ou base indisponible).
 */

type SumUpCheckout = {
  id?: unknown;
  checkout_reference?: unknown;
  merchant_code?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  transactions?: Array<{ id?: unknown; status?: unknown }>;
};

function cleanString(value: unknown, maxLength = 200): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

const ok = () => new Response(null, { status: 200 });

export default async (request: Request) => {
  if (request.method !== "POST") return new Response(null, { status: 405 });

  try {
    const apiKey = process.env.SUMUP_API_KEY?.trim();
    const merchantCode = process.env.SUMUP_MERCHANT_CODE?.trim();
    if (!apiKey) {
      console.error("SUMUP_API_KEY is not configured");
      return new Response(null, { status: 503 });
    }

    const body = (await request.json().catch(() => ({}))) as { id?: unknown };
    const checkoutId = cleanString(body?.id, 100);
    if (!checkoutId || !/^[A-Za-z0-9-]+$/.test(checkoutId)) {
      return new Response(null, { status: 400 });
    }

    // Relecture du checkout chez SumUp : le contenu du webhook n'est jamais cru tel quel.
    const sumupResponse = await fetch(`https://api.sumup.com/v0.1/checkouts/${encodeURIComponent(checkoutId)}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });

    if (sumupResponse.status === 404) {
      console.warn("SumUp webhook for unknown checkout", checkoutId);
      return ok();
    }
    if (!sumupResponse.ok) {
      console.error("SumUp checkout verification failed", sumupResponse.status);
      return new Response(null, { status: 502 });
    }

    const checkout = (await sumupResponse.json().catch(() => ({}))) as SumUpCheckout;
    const verifiedId = cleanString(checkout.id, 100);
    const status = cleanString(checkout.status, 30).toUpperCase();
    const checkoutMerchant = cleanString(checkout.merchant_code, 50);

    if (verifiedId !== checkoutId) {
      console.error("SumUp checkout id mismatch", checkoutId);
      return ok();
    }
    if (merchantCode && checkoutMerchant && checkoutMerchant !== merchantCode) {
      console.error("SumUp checkout belongs to another merchant", checkoutId);
      return ok();
    }

    // Retrouve la commande : d'abord par le paiement enregistré, sinon par la référence.
    const [payment] = await db
      .select({ orderId: payments.orderId })
      .from(payments)
      .where(and(eq(payments.provider, "sumup"), eq(payments.providerPaymentId, checkoutId)))
      .limit(1);

    let orderId = payment?.orderId ?? null;
    if (!orderId) {
      const reference = cleanString(checkout.checkout_reference, 100);
      const orderNumber = reference.includes("-") ? reference.split("-").slice(0, -1).join("-") : "";
      if (orderNumber) {
        const [byNumber] = await db
          .select({ id: orders.id })
          .from(orders)
          .where(eq(orders.orderNumber, orderNumber))
          .limit(1);
        orderId = byNumber?.id ?? null;
      }
    }

    if (!orderId) {
      console.error("SumUp webhook order not found", checkoutId);
      return ok();
    }

    const [order] = await db
      .select({ id: orders.id, totalCents: orders.totalCents, currency: orders.currency })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) return ok();

    if (status !== "PAID") {
      // FAILED, EXPIRED… : on garde la trace, la commande reste à payer.
      if (status) {
        await db
          .update(payments)
          .set({ status: status.toLowerCase(), updatedAt: new Date() })
          .where(and(eq(payments.provider, "sumup"), eq(payments.providerPaymentId, checkoutId), ne(payments.status, "paid")));
      }
      return ok();
    }

    const amount = typeof checkout.amount === "number" ? checkout.amount : Number(checkout.amount);
    const receivedCents = Math.round(amount * 100);
    const currency = cleanString(checkout.currency, 10).toUpperCase();
    if (!Number.isFinite(amount) || receivedCents !== order.totalCents || currency !== order.currency) {
      console.error("SumUp payment amount/currency mismatch", checkoutId);
      return ok();
    }

    const successfulTransaction = checkout.transactions?.find(
      (transaction) => cleanString(transaction?.status, 30).toUpperCase() === "SUCCESSFUL",
    );
    const transactionId = cleanString(successfulTransaction?.id ?? checkout.transactions?.[0]?.id, 150);

    // Historique : une seule ligne par checkout, même si le webhook est rejoué.
    await db
      .insert(payments)
      .values({
        orderId: order.id,
        provider: "sumup",
        providerPaymentId: checkoutId,
        amountCents: receivedCents,
        currency,
        status: "paid",
      })
      .onConflictDoUpdate({
        target: [payments.provider, payments.providerPaymentId],
        set: { status: "paid", amountCents: receivedCents, currency, updatedAt: new Date() },
      });

    // Passage à « payée » une seule fois. Une commande déjà préparée ou expédiée
    // garde son statut ; seule une commande en attente passe à « paid ».
    const transitioned = await db
      .update(orders)
      .set({
        paymentStatus: "paid",
        paymentProvider: "sumup",
        paymentReference: transactionId || checkoutId,
        status: sql`CASE WHEN ${orders.status} = 'pending_payment' THEN 'paid' ELSE ${orders.status} END`,
      })
      .where(and(eq(orders.id, order.id), ne(orders.paymentStatus, "paid")))
      .returning({ id: orders.id, status: orders.status });

    if (transitioned.length > 0) {
      if (transitioned[0].status !== "paid") {
        console.warn("Payment confirmed on an order that was not pending", order.id, transitioned[0].status);
      }
      await notifyOrderPaid(order.id);
    } else {
      // Déjà payée : webhook rejoué (normal) ou second paiement sur un autre checkout (à rembourser).
      const [current] = await db
        .select({ paymentReference: orders.paymentReference })
        .from(orders)
        .where(eq(orders.id, order.id))
        .limit(1);
      const reference = current?.paymentReference ?? "";
      if (reference !== checkoutId && reference !== transactionId) {
        console.error("Second SumUp payment on an already paid order: refund needed", order.id, checkoutId);
      }
    }

    return ok();
  } catch (error) {
    console.error("SumUp webhook failed", error instanceof Error ? error.message : "Unknown error");
    return new Response(null, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/sumup-webhook",
  method: "POST",
};
