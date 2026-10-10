import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { orders, productReviews, users, type OrderItem } from "../db/schema.js";

/**
 * Règles communes aux avis clients.
 *
 * Un avis n'est possible que pour un t-shirt réellement commandé, dans une
 * commande expédiée ou livrée. L'acheteur est reconnu :
 * - soit par sa session (commandes rattachées à son compte ou passées avec
 *   la même adresse e-mail) ;
 * - soit, sans compte, par le numéro de commande + l'e-mail de la commande.
 */

export const REVIEWABLE_STATUSES = ["shipped", "delivered"] as const;

export type ReviewableItem = {
  orderId: number;
  orderNumber: string;
  sku: string;
  name: string;
  color: string;
  size: string;
  reviewed: boolean;
};

type BuyerOrder = { id: number; orderNumber: string; items: OrderItem[]; userId: number | null; customerName: string };

export function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.replace(/\s+\n/g, "\n").trim().slice(0, maxLength) : "";
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 254) : "";
}

/** « Matisse Pialat » → « Matisse P. » : on n'affiche jamais le nom complet. */
export function displayName(fullName: string | null | undefined): string {
  const parts = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Client FORK";
  const first = parts[0].slice(0, 30);
  const initial = parts.length > 1 ? ` ${parts[parts.length - 1][0].toUpperCase()}.` : "";
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}${initial}`;
}

/** Commandes expédiées/livrées de l'acheteur identifié, ou [] s'il ne l'est pas. */
export async function findBuyerOrders(options: {
  userId: number | null;
  orderNumber?: string;
  email?: string;
}): Promise<BuyerOrder[]> {
  const columns = {
    id: orders.id,
    orderNumber: orders.orderNumber,
    items: orders.items,
    userId: orders.userId,
    customerName: orders.customerName,
  };
  const reviewable = inArray(orders.status, [...REVIEWABLE_STATUSES]);

  if (options.userId) {
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, options.userId)).limit(1);
    if (!user) return [];
    const mine = or(eq(orders.userId, options.userId), eq(orders.customerEmail, user.email.toLowerCase()));
    const rows = await db
      .select(columns)
      .from(orders)
      .where(and(reviewable, mine, options.orderNumber ? eq(orders.orderNumber, options.orderNumber) : undefined));
    return rows;
  }

  if (!options.orderNumber || !options.email) return [];
  return db
    .select(columns)
    .from(orders)
    .where(and(reviewable, eq(orders.orderNumber, options.orderNumber), eq(orders.customerEmail, options.email)))
    .limit(1);
}

/** Articles distincts (par commande et par t-shirt) que l'acheteur peut noter. */
export async function listReviewableItems(buyerOrders: BuyerOrder[]): Promise<ReviewableItem[]> {
  if (!buyerOrders.length) return [];
  const existing = await db
    .select({ orderId: productReviews.orderId, sku: productReviews.productSku })
    .from(productReviews)
    .where(inArray(productReviews.orderId, buyerOrders.map((o) => o.id)));
  const done = new Set(existing.map((r) => `${r.orderId}:${r.sku}`));

  const items: ReviewableItem[] = [];
  for (const order of buyerOrders) {
    const seen = new Set<string>();
    for (const item of order.items ?? []) {
      if (!item?.sku || seen.has(item.sku)) continue;
      seen.add(item.sku);
      items.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        sku: item.sku,
        name: item.name,
        color: item.color,
        size: item.size,
        reviewed: done.has(`${order.id}:${item.sku}`),
      });
    }
  }
  return items;
}

const MAX_PHOTO_BYTES = 1_500_000;

/** Vérifie une photo envoyée en « data URL » : vrai JPEG, PNG ou WebP, 1,5 Mo maximum. */
export function parsePhoto(value: unknown): { contentType: string; base64: string } | null {
  if (typeof value !== "string") return null;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) return null;

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const isWebp = bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  const contentType = isJpeg ? "image/jpeg" : isPng ? "image/png" : isWebp ? "image/webp" : null;
  if (!contentType) return null;
  return { contentType, base64: bytes.toString("base64") };
}
