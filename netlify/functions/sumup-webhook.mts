import type { Config } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { orders } from "../../db/schema.js";

type SumUpWebhookPayload = {
  event_type?: unknown;
  id?: unknown;
};

type SumUpCheckoutResponse = {
  id?: unknown;
  checkout_reference?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  transactions?: Array<{
    id?: unknown;
  }>;
};

function cleanString(value: unknown, maxLength = 200): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export default async (request: Request) => {
  if (request.method !== "POST") {
    return new Response(null, { status: 405 });
  }

  try {
    const apiKey = process.env.SUMUP_API_KEY?.trim();
    if (!apiKey) {
      console.error("SUMUP_API_KEY is not configured");
      return new Response(null, { status: 503 });
    }

    const body = (await request.json().catch(() => ({}))) as SumUpWebhookPayload;
    const checkoutId = cleanString(body?.id, 100);

    if (!checkoutId) {
      return new Response(null, { status: 400 });
    }

    const sumupResponse = await fetch(
      `https://api.sumup.com/v0.1/checkouts/${encodeURIComponent(checkoutId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      },
    );

    const checkout = (await sumupResponse.json().catch(() => ({}))) as SumUpCheckoutResponse;

    if (!sumupResponse.ok) {
      console.error("SumUp checkout verification failed", sumupResponse.status);
      return new Response(null, { status: 502 });
    }

    const checkoutReference = cleanString(checkout.checkout_reference, 100);
    const status = cleanString(checkout.status, 30);
    const transactionId = cleanString(checkout.transactions?.[0]?.id, 150);

    if (!checkoutReference || !checkoutReference.includes("-")) {
      return new Response(null, { status: 200 });
    }

    const orderNumber = checkoutReference.split("-").slice(0, -1).join("-").trim();

    if (!orderNumber) {
      return new Response(null, { status: 200 });
    }

    const [order] = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        totalCents: orders.totalCents,
        currency: orders.currency,
      })
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .limit(1);

    if (!order) {
      console.error("SumUp webhook order not found", orderNumber);
      return new Response(null, { status: 200 });
    }

    if (status !== "PAID") {
      return new Response(null, { status: 200 });
    }

    const amount = typeof checkout.amount === "number" ? checkout.amount : Number(checkout.amount);
    const expectedAmountCents = order.totalCents;

    const receivedAmountCents = Math.round(amount * 100);

    if (!Number.isFinite(amount) || receivedAmountCents !== expectedAmountCents || checkout.currency !== order.currency) {
      console.error("SumUp payment amount/currency mismatch", orderNumber);
      return new Response(null, { status: 200 });
    }

    await db
      .update(orders)
      .set({
        status: "paid",
        paymentStatus: "paid",
        paymentProvider: "sumup",
        paymentReference: transactionId || checkoutId,
      })
      .where(eq(orders.id, order.id));

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error(
      "SumUp webhook failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return new Response(null, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/sumup-webhook",
  method: "POST",
};
