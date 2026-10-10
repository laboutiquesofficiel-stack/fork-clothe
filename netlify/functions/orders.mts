import { createHash, randomBytes } from "node:crypto";
import type { Config } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { orders, sessions, type OrderItem } from "../../db/schema.js";
import { available, loadStock } from "../../lib/stock.js";
import { quoteDelivery, type DeliveryQuote } from "../../lib/delivery.js";

type Product = {
  name: string;
  color: string;
  sizes: readonly string[];
  priceCents: number;
};

type Customer = {
  name: string;
  email: string;
  phone: string;
  address: string;
};

const catalogue: Record<string, Product> = {
  "fork-les-minots": {
    name: "Les Minots",
    color: "Noir",
    sizes: ["S", "M", "L", "XL", "XXL", "3XL"],
    priceCents: 3000,
  },
  "fork-authentique": {
    name: "L'Authentique",
    color: "Rouge & noir",
    sizes: ["S", "M", "L", "XL", "XXL", "3XL"],
    priceCents: 3000,
  },
  "fork-lou-faron": {
    name: "Lou Faron",
    color: "Léopard",
    sizes: ["S", "M", "L"],
    priceCents: 3000,
  },
  "fork-les-boutades": {
    name: "Les Boutades",
    color: "Noir",
    sizes: ["S", "M", "L", "XL", "XXL", "3XL"],
    priceCents: 3000,
  },
};

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function createOrderNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `FORK-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

const orderSummary = {
  orderNumber: orders.orderNumber,
  subtotalCents: orders.subtotalCents,
  shippingCents: orders.shippingCents,
  totalCents: orders.totalCents,
  currency: orders.currency,
};

function deliverySummary(delivery: DeliveryQuote) {
  return {
    zone: delivery.zone,
    feeCents: delivery.feeCents,
    distanceKm: delivery.distanceKm,
    message: delivery.message,
  };
}

function describeDeliveryZone(delivery: DeliveryQuote): string {
  const distance =
    delivery.distanceKm === null
      ? "distance inconnue"
      : `${delivery.distanceKm.toFixed(1)} km de Toulon centre`;

  if (delivery.zone === "free_zone") return `Zone offerte (${distance})`;
  if (delivery.zone === "outside_zone") return `Hors zone (${distance})`;

  return `À vérifier manuellement (${delivery.zone})`;
}

function getFormspreeEndpoint(): string | null {
  const configured =
    process.env.FORMSPREE_ENDPOINT?.trim() ||
    process.env.FORMSPREE_FORM_ID?.trim();

  // L'identifiant du formulaire vient de FORMSPREE_FORM_ID (ou FORMSPREE_ENDPOINT) sur Netlify.
  if (!configured) return null;

  return configured.startsWith("https://formspree.io/")
    ? configured
    : `https://formspree.io/f/${encodeURIComponent(configured)}`;
}

async function sendFormspreeNotification(
  orderNumber: string,
  customer: Customer,
  items: OrderItem[],
  delivery: DeliveryQuote,
  subtotalCents: number,
  totalCents: number,
): Promise<boolean> {
  const endpoint = getFormspreeEndpoint();

  if (!endpoint) {
    console.warn("Formspree notification skipped: endpoint is not configured");
    return false;
  }

  try {
    const articles = items
      .map(
        (item) =>
          `${item.quantity} × ${item.name} — taille ${item.size} — couleur ${item.color}`,
      )
      .join("\n");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(4000),
      body: JSON.stringify({
        _subject: `Nouvelle commande FORK ${orderNumber}`,
        order_number: orderNumber,
        nom: customer.name,
        email: customer.email,
        telephone: customer.phone,
        adresse: customer.address,
        articles,
        sous_total: `${(subtotalCents / 100).toFixed(2)} EUR`,
        zone_livraison: describeDeliveryZone(delivery),
        frais_livraison: `${(delivery.feeCents / 100).toFixed(2)} EUR`,
        total: `${(totalCents / 100).toFixed(2)} EUR`,
      }),
    });

    if (!response.ok) {
      console.warn("Formspree notification failed", response.status);
    }

    return response.ok;
  } catch (error) {
    console.warn(
      "Formspree notification failed",
      error instanceof Error ? error.message : "Unknown error",
    );

    return false;
  }
}

/**
 * Récupère l'utilisateur connecté à partir de la session sécurisée.
 *
 * Important :
 * - On ne récupère jamais le userId depuis le navigateur.
 * - Un client non connecté reste un client invité.
 * - Une session expirée n'est pas utilisée.
 */
async function getAuthenticatedUserId(
  request: Request,
): Promise<number | null> {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";");

  let sessionToken: string | null = null;

  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split("=");

    if (key === "fork_session") {
      sessionToken = decodeURIComponent(valueParts.join("="));
      break;
    }
  }

  if (!sessionToken) return null;

  const tokenHash = createHash("sha256")
    .update(sessionToken)
    .digest("hex");

  const [session] = await db
    .select({
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return session.userId;
}

export default async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Méthode non autorisée." },
      { status: 405 },
    );
  }

  try {
    /*
     * Le compte connecté est déterminé côté serveur grâce au cookie.
     * Si aucun compte n'est connecté, userId reste null :
     * le checkout invité continue donc de fonctionner.
     */
    const userId = await getAuthenticatedUserId(request);

    const body = await request.json();

    const checkoutToken = cleanText(body?.checkoutToken, 80);

    const customer: Customer = {
      name: cleanText(body?.customer?.name, 120),
      email: cleanText(body?.customer?.email, 200).toLowerCase(),
      phone: cleanText(body?.customer?.phone, 40),
      address: cleanText(body?.customer?.address, 500),
    };

    if (
      !customer.name ||
      !customer.email.includes("@") ||
      !customer.phone ||
      !customer.address
    ) {
      return Response.json(
        { error: "Les coordonnées de livraison sont incomplètes." },
        { status: 400 },
      );
    }

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        checkoutToken,
      )
    ) {
      return Response.json(
        {
          error:
            "La session de commande est invalide. Rechargez la page puis réessayez.",
        },
        { status: 400 },
      );
    }

    if (
      !Array.isArray(body?.items) ||
      body.items.length === 0 ||
      body.items.length > 20
    ) {
      return Response.json(
        { error: "Le panier est vide ou invalide." },
        { status: 400 },
      );
    }

    const items: OrderItem[] = body.items.map((input: unknown) => {
      const item = input as Record<string, unknown>;

      const sku = cleanText(item.sku, 80);
      const size = cleanText(item.size, 10);
      const color = cleanText(item.color, 80);
      const quantity = Number(item.quantity);

      const product = catalogue[sku];

      if (
        !product ||
        !product.sizes.includes(size) ||
        color !== product.color ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 20
      ) {
        throw new Error("INVALID_ITEM");
      }

      return {
        sku,
        name: product.name,
        color: product.color,
        size,
        quantity,
        unitPriceCents: product.priceCents,
        lineTotalCents: product.priceCents * quantity,
      };
    });

    // Stock : on refuse une taille épuisée ou une quantité supérieure au stock suivi.
    const stock = await loadStock(items.map((i) => i.sku));
    const wanted = new Map<string, number>();
    for (const item of items) wanted.set(`${item.sku}|${item.size}`, (wanted.get(`${item.sku}|${item.size}`) ?? 0) + item.quantity);
    for (const item of items) {
      const left = available(stock, item.sku, item.size);
      if (left !== null && (wanted.get(`${item.sku}|${item.size}`) ?? 0) > left) {
        return Response.json(
          {
            error: left <= 0
              ? `Le t-shirt ${item.name} en taille ${item.size} vient d'être épuisé. Retire-le du panier pour continuer.`
              : `Il ne reste que ${left} t-shirt${left > 1 ? "s" : ""} ${item.name} en taille ${item.size}. Ajuste la quantité dans ton panier.`,
          },
          { status: 409 },
        );
      }
    }

    const itemCount = items.reduce(
      (total, item) => total + item.quantity,
      0,
    );

    const subtotalCents = items.reduce(
      (total, item) => total + item.lineTotalCents,
      0,
    );

    if (itemCount > 50 || subtotalCents <= 0) {
      return Response.json(
        { error: "La quantité commandée est invalide." },
        { status: 400 },
      );
    }

    // Les frais sont recalculés côté serveur.
    const delivery = await quoteDelivery(customer.address);

    if (
      delivery.zone === "needs_postcode" ||
      delivery.zone === "unresolved" ||
      delivery.zone === "outside_area"
    ) {
      return Response.json(
        {
          error: delivery.message,
          delivery: { zone: delivery.zone },
        },
        { status: 400 },
      );
    }

    const totalCents = subtotalCents + delivery.feeCents;
    const orderNumber = createOrderNumber();

    const [createdOrder] = await db
      .insert(orders)
      .values({
        orderNumber,
        checkoutToken,

        // Compte Google connecté ou null pour un invité.
        userId,

        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        shippingAddress: customer.address,

        items,
        itemCount,
        subtotalCents,
        shippingCents: delivery.feeCents,
        deliveryZone: delivery.zone,
        deliveryDistanceMeters: delivery.distanceMeters,
        totalCents,
      })
      .onConflictDoNothing({ target: orders.checkoutToken })
      .returning(orderSummary);

    if (!createdOrder) {
      const [existingOrder] = await db
        .select(orderSummary)
        .from(orders)
        .where(eq(orders.checkoutToken, checkoutToken))
        .limit(1);

      if (!existingOrder) {
        throw new Error("ORDER_RETRY_LOOKUP_FAILED");
      }

      return Response.json({
        ...existingOrder,
        delivery: deliverySummary(delivery),
        notificationSent: null,
        reused: true,
      });
    }

    const notificationSent = await sendFormspreeNotification(
      createdOrder.orderNumber,
      customer,
      items,
      delivery,
      subtotalCents,
      createdOrder.totalCents,
    );

    return Response.json(
      {
        ...createdOrder,
        delivery: deliverySummary(delivery),
        notificationSent,
        reused: false,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_ITEM") {
      return Response.json(
        { error: "Un article du panier est invalide ou indisponible." },
        { status: 400 },
      );
    }

    console.error(
      "Order creation failed",
      error instanceof Error ? error.message : "Unknown error",
    );

    return Response.json(
      { error: "Impossible d’enregistrer la commande pour le moment." },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/orders",
  method: "POST",
};