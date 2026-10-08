import { randomBytes } from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { orders, payments } from "../../db/schema.js";

/**
 * Crée un paiement SumUp pour une commande existante.
 *
 * Le montant vient toujours de la base, jamais du navigateur. Le navigateur
 * ne reçoit que l'URL de la page de paiement SumUp. La confirmation du
 * paiement est faite uniquement par le webhook (/api/sumup-webhook).
 */

type SumUpCheckoutResponse = {
  id?: unknown;
  hosted_checkout_url?: unknown;
  error_code?: unknown;
  message?: unknown;
};

function cleanOrderNumber(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

export default async (request: Request, context: Context) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Méthode non autorisée." }, { status: 405 });
  }

  try {
    const apiKey = process.env.SUMUP_API_KEY?.trim();
    const merchantCode = process.env.SUMUP_MERCHANT_CODE?.trim();
    if (!apiKey || !merchantCode) {
      return Response.json({ error: "Le paiement par carte n’est pas encore configuré." }, { status: 503 });
    }

    const body = await request.json().catch(() => null);
    const orderNumber = cleanOrderNumber(body?.orderNumber);
    if (!orderNumber) {
      return Response.json({ error: "Numéro de commande invalide." }, { status: 400 });
    }

    const [order] = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        totalCents: orders.totalCents,
        currency: orders.currency,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
      })
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .limit(1);

    if (!order || order.totalCents <= 0) {
      return Response.json({ error: "Commande introuvable." }, { status: 404 });
    }

    // Une commande déjà réglée, annulée ou expédiée ne peut pas être payée une seconde fois.
    if (order.paymentStatus === "paid" || order.status !== "pending_payment") {
      return Response.json(
        { error: "Cette commande est déjà réglée ou n’est plus payable.", status: order.status },
        { status: 409 },
      );
    }

    const origin = new URL(request.url).origin;
    const checkoutReference = `${order.orderNumber}-${randomBytes(3).toString("hex")}`;
    const sumupResponse = await fetch("https://api.sumup.com/v0.1/checkouts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: order.totalCents / 100,
        checkout_reference: checkoutReference,
        currency: order.currency,
        description: `Commande FORK ${order.orderNumber}`,
        merchant_code: merchantCode,
        // Adresse que SumUp appelle quand le statut du paiement change.
        return_url: `${origin}/api/sumup-webhook`,
        // Page où le client revient : elle ne vaut jamais preuve de paiement.
        redirect_url: `${origin}/?payment=sumup&order=${encodeURIComponent(order.orderNumber)}`,
        hosted_checkout: { enabled: true },
      }),
      signal: AbortSignal.timeout(10000),
    });

    const result = (await sumupResponse.json().catch(() => ({}))) as SumUpCheckoutResponse;
    if (
      !sumupResponse.ok ||
      typeof result.id !== "string" ||
      !result.id.trim() ||
      typeof result.hosted_checkout_url !== "string"
    ) {
      // Code et message d'erreur de SumUp (jamais la clé) : visibles dans les logs, et
      // affichés au client uniquement hors production pour faciliter les tests.
      const reason = `HTTP ${sumupResponse.status} ${String(result.error_code ?? "")} ${String(result.message ?? "")}`.trim();
      console.error("SumUp checkout creation failed", reason);
      const isProduction = context?.deploy?.context === "production";
      return Response.json(
        { error: isProduction ? "Impossible de créer le paiement par carte." : `Impossible de créer le paiement par carte (SumUp : ${reason}).` },
        { status: 502 },
      );
    }

    await db
      .update(orders)
      .set({ paymentProvider: "sumup", paymentReference: result.id })
      .where(eq(orders.id, order.id));

    // Trace du paiement en attente : le webhook la passera à « paid » après vérification.
    await db
      .insert(payments)
      .values({
        orderId: order.id,
        provider: "sumup",
        providerPaymentId: result.id,
        amountCents: order.totalCents,
        currency: order.currency,
        status: "pending",
      })
      .onConflictDoNothing();

    return Response.json({ checkoutUrl: result.hosted_checkout_url });
  } catch (error) {
    console.error("SumUp checkout failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Le paiement par carte est momentanément indisponible." }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/sumup-checkout",
  method: "POST",
};
