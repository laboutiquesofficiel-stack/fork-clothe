import type { Config } from "@netlify/functions";
import { DELIVERY_FEE_CENTS, FREE_DELIVERY_RADIUS_KM, quoteDelivery } from "../../lib/delivery.js";

export default async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Méthode non autorisée." }, { status: 405 });
  }

  try {
    const body = await request.json();
    const address = typeof body?.address === "string" ? body.address.trim().slice(0, 500) : "";
    if (address.length < 5) {
      return Response.json({ error: "Adresse trop courte pour être localisée." }, { status: 400 });
    }

    const quote = await quoteDelivery(address);
    return Response.json({
      zone: quote.zone,
      feeCents: quote.feeCents,
      distanceKm: quote.distanceKm,
      precision: quote.precision,
      matchedLabel: quote.matchedLabel,
      message: quote.message,
      freeRadiusKm: FREE_DELIVERY_RADIUS_KM,
      standardFeeCents: DELIVERY_FEE_CENTS,
    });
  } catch (error) {
    console.error("Shipping quote failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Impossible de calculer les frais de livraison." }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/shipping-quote",
  method: "POST",
};
