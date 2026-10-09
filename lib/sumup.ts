import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { orders, payments } from "../db/schema.js";
import { notifyOrderPaid } from "./notifications.js";

/**
 * Confirmation d'un paiement SumUp, côté serveur uniquement.
 *
 * On relit le checkout directement chez SumUp avec la clé secrète, puis on
 * vérifie identifiant, marchand, statut, montant et devise avant d'écrire
 * quoi que ce soit. Utilisé par le webhook SumUp et, en secours, par la page
 * de retour (/api/order-status) si le webhook tarde ou n'arrive pas. Dans les
 * deux cas, la source de vérité est l'API SumUp, jamais le navigateur.
 *
 * Idempotent : la commande ne passe à « payée » qu'une fois ; un appel rejoué
 * ne renvoie pas d'e-mail et ne fait jamais reculer une commande expédiée.
 */

export type ConfirmResult =
  | "paid" // paiement vérifié (première fois ou déjà enregistré)
  | "not_paid" // checkout existant mais pas payé (en attente, échoué, expiré)
  | "ignored" // checkout inconnu, autre marchand, montant incohérent…
  | "retry"; // SumUp ou configuration indisponible : réessayer plus tard

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

export function isCheckoutId(value: string): boolean {
  return /^[A-Za-z0-9-]{1,100}$/.test(value);
}

/** Dernière raison détaillée, pour le diagnostic hors production (jamais de secret). */
export let lastConfirmReason = "";

export async function confirmSumUpCheckout(checkoutId: string): Promise<ConfirmResult> {
  const result = await confirmInner(checkoutId);
  return result;
}

function note(reason: string): void {
  lastConfirmReason = reason;
}

async function confirmInner(checkoutId: string): Promise<ConfirmResult> {
  const apiKey = process.env.SUMUP_API_KEY?.trim();
  const merchantCode = process.env.SUMUP_MERCHANT_CODE?.trim();
  if (!apiKey) {
    console.error("SUMUP_API_KEY is not configured");
    note("clé SumUp absente");
    return "retry";
  }
  if (!isCheckoutId(checkoutId)) {
    note("identifiant de checkout invalide");
    return "ignored";
  }

  const sumupResponse = await fetch(`https://api.sumup.com/v0.1/checkouts/${encodeURIComponent(checkoutId)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (sumupResponse.status === 404) {
    console.warn("SumUp checkout not found", checkoutId);
    note(`checkout ${checkoutId} introuvable chez SumUp (404)`);
    return "ignored";
  }
  if (!sumupResponse.ok) {
    console.error("SumUp checkout verification failed", sumupResponse.status);
    note(`lecture du checkout ${checkoutId} refusée par SumUp (HTTP ${sumupResponse.status})`);
    return "retry";
  }

  const checkout = (await sumupResponse.json().catch(() => ({}))) as SumUpCheckout;
  const status = cleanString(checkout.status, 30).toUpperCase();
  const checkoutMerchant = cleanString(checkout.merchant_code, 50);

  if (cleanString(checkout.id, 100) !== checkoutId) {
    console.error("SumUp checkout id mismatch", checkoutId);
    note("identifiant renvoyé par SumUp différent");
    return "ignored";
  }
  if (merchantCode && checkoutMerchant && checkoutMerchant !== merchantCode) {
    console.error("SumUp checkout belongs to another merchant", checkoutId);
    note("le paiement appartient à un autre compte SumUp que celui configuré pour ce site (vérifier SUMUP_MERCHANT_CODE)");
    return "ignored";
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
      const [byNumber] = await db.select({ id: orders.id }).from(orders).where(eq(orders.orderNumber, orderNumber)).limit(1);
      orderId = byNumber?.id ?? null;
    }
  }
  if (!orderId) {
    console.error("SumUp checkout order not found", checkoutId);
    note("commande liée au checkout introuvable");
    return "ignored";
  }

  const [order] = await db
    .select({ id: orders.id, totalCents: orders.totalCents, currency: orders.currency })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) {
    note("commande introuvable");
    return "ignored";
  }

  if (status !== "PAID") {
    // PENDING, FAILED, EXPIRED… : on garde la trace, la commande reste à payer.
    if (status) {
      await db
        .update(payments)
        .set({ status: status.toLowerCase(), updatedAt: new Date() })
        .where(and(eq(payments.provider, "sumup"), eq(payments.providerPaymentId, checkoutId), ne(payments.status, "paid")));
    }
    note(`checkout ${checkoutId} au statut SumUp « ${status || "vide"} »`);
    return "not_paid";
  }

  const amount = typeof checkout.amount === "number" ? checkout.amount : Number(checkout.amount);
  const receivedCents = Math.round(amount * 100);
  const currency = cleanString(checkout.currency, 10).toUpperCase();
  if (!Number.isFinite(amount) || receivedCents !== order.totalCents || currency !== order.currency) {
    console.error("SumUp payment amount/currency mismatch", checkoutId);
    note(`montant ou devise différents (${receivedCents} ${currency} ≠ ${order.totalCents} ${order.currency})`);
    return "ignored";
  }

  const successfulTransaction = checkout.transactions?.find(
    (transaction) => cleanString(transaction?.status, 30).toUpperCase() === "SUCCESSFUL",
  );
  const transactionId = cleanString(successfulTransaction?.id ?? checkout.transactions?.[0]?.id, 150);

  // Historique : une seule ligne par checkout, même si la vérification est rejouée.
  await db
    .insert(payments)
    .values({ orderId: order.id, provider: "sumup", providerPaymentId: checkoutId, amountCents: receivedCents, currency, status: "paid" })
    .onConflictDoUpdate({
      target: [payments.provider, payments.providerPaymentId],
      set: { status: "paid", amountCents: receivedCents, currency, updatedAt: new Date() },
    });

  // Passage à « payée » une seule fois ; seule une commande en attente change de statut.
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
    // Déjà payée : vérification rejouée (normal) ou second paiement sur un autre checkout (à rembourser).
    const [current] = await db.select({ paymentReference: orders.paymentReference }).from(orders).where(eq(orders.id, order.id)).limit(1);
    const reference = current?.paymentReference ?? "";
    if (reference !== checkoutId && reference !== transactionId) {
      console.error("Second SumUp payment on an already paid order: refund needed", order.id, checkoutId);
    }
  }
  note("payé");
  return "paid";
}
