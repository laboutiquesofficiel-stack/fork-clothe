import { randomBytes } from "node:crypto";
import type { Config } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { orders } from "../../db/schema.js";

type SumUpCheckoutResponse = {
  id?: unknown;
  hosted_checkout_url?: unknown;
};

function cleanOrderNumber(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

export default async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Méthode non autorisée." }, { status: 405 });
  }

  try {
    const apiKey = process.env.SUMUP_API_KEY?.trim();
    const merchantCode = process.env.SUMUP_MERCHANT_CODE?.trim();
    if (!apiKey || !merchantCode) {
      return Response.json({ error: "Le paiement par carte n’est pas encore configuré." }, { status: 503 });
    }

    const body = await request.json();
    const orderNumber = cleanOrderNumber(body?.orderNumber);
    if (!orderNumber) {
      return Response.json({ error: "Numéro de commande invalide." }, { status: 400 });
    }

    const [order] = await db
      .select({ orderNumber: orders.orderNumber, totalCents: orders.totalCents, currency: orders.currency })
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .limit(1);

    if (!order || order.totalCents <= 0) {
      return Response.json({ error: "Commande introuvable." }, { status: 404 });
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
        return_url: `${origin}/?payment=sumup&order=${encodeURIComponent(order.orderNumber)}`,
        hosted_checkout: { enabled: true },
      }),
    });

    const result = (await sumupResponse.json().catch(() => ({}))) as SumUpCheckoutResponse;
    if (
      !sumupResponse.ok ||
      typeof result.id !== "string" ||
      !result.id.trim() ||
      typeof result.hosted_checkout_url !== "string"
    ) {
      console.error("SumUp checkout creation failed", sumupResponse.status);
      return Response.json({ error: "Impossible de créer le paiement par carte." }, { status: 502 });
    }

    await db
      .update(orders)
      .set({
        paymentProvider: "sumup",
        paymentReference: result.id,
      })
      .where(eq(orders.orderNumber, order.orderNumber));

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