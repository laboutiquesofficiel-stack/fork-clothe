import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { orders, stockLevels, stockMovements, type OrderItem } from "../db/schema.js";

/**
 * Stock par t-shirt et par taille.
 *
 * - Une taille sans ligne dans stock_levels n'est pas suivie : elle reste en
 *   vente sans limite (avant le premier inventaire).
 * - Vente en ligne : le stock baisse quand le paiement est confirmé, une
 *   seule fois par commande (repéré dans l'historique).
 * - Annulation d'une commande payée : les pièces sont remises en stock.
 * - Vente sur place, inventaire, correction : depuis l'admin.
 */

export type StockMap = Map<string, number>; // clé "sku|taille"
const key = (sku: string, size: string) => `${sku}|${size}`;

/** Niveaux de stock suivis pour les t-shirts demandés (ou tous). */
export async function loadStock(skus?: string[]): Promise<StockMap> {
  const rows = await db
    .select({ sku: stockLevels.sku, size: stockLevels.size, quantity: stockLevels.quantity })
    .from(stockLevels)
    .where(skus && skus.length ? inArray(stockLevels.sku, skus) : undefined);
  return new Map(rows.map((r) => [key(r.sku, r.size), r.quantity]));
}

/** Quantité disponible, ou null si la taille n'est pas suivie. */
export function available(stock: StockMap, sku: string, size: string): number | null {
  const q = stock.get(key(sku, size));
  return q === undefined ? null : Math.max(0, q);
}

/** Applique un mouvement (positif ou négatif) et l'enregistre dans l'historique. */
export async function moveStock(
  sku: string,
  size: string,
  delta: number,
  reason: "order" | "order_cancel" | "market" | "adjust",
  reference: string | null,
  note: string | null = null,
): Promise<number | null> {
  const [row] = await db
    .update(stockLevels)
    .set({ quantity: sql`${stockLevels.quantity} + ${delta}`, updatedAt: new Date() })
    .where(and(eq(stockLevels.sku, sku), eq(stockLevels.size, size)))
    .returning({ quantity: stockLevels.quantity });
  // Taille non suivie : on garde quand même une trace de la vente.
  await db.insert(stockMovements).values({ sku, size, delta, quantityAfter: row?.quantity ?? null, reason, reference, note });
  return row?.quantity ?? null;
}

/** Fixe la quantité exacte (inventaire). */
export async function setStock(sku: string, size: string, quantity: number, note: string | null = null): Promise<void> {
  const [before] = await db
    .select({ quantity: stockLevels.quantity })
    .from(stockLevels)
    .where(and(eq(stockLevels.sku, sku), eq(stockLevels.size, size)))
    .limit(1);
  if (before && before.quantity === quantity) return; // inchangé : rien à enregistrer
  await db
    .insert(stockLevels)
    .values({ sku, size, quantity })
    .onConflictDoUpdate({ target: [stockLevels.sku, stockLevels.size], set: { quantity, updatedAt: new Date() } });
  await db.insert(stockMovements).values({
    sku,
    size,
    delta: quantity - (before?.quantity ?? 0),
    quantityAfter: quantity,
    reason: "count",
    reference: null,
    note,
  });
}

async function hasMovement(reference: string, reason: string): Promise<boolean> {
  const [row] = await db
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(and(eq(stockMovements.reference, reference), eq(stockMovements.reason, reason)))
    .limit(1);
  return Boolean(row);
}

/** Retire du stock les articles d'une commande payée (une seule fois). */
export async function decrementForOrder(orderId: number): Promise<void> {
  try {
    const [order] = await db.select({ orderNumber: orders.orderNumber, items: orders.items }).from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order || (await hasMovement(order.orderNumber, "order"))) return;
    for (const item of order.items as OrderItem[]) {
      await moveStock(item.sku, item.size, -item.quantity, "order", order.orderNumber);
    }
  } catch (error) {
    console.error("Stock decrement failed", orderId, error instanceof Error ? error.message : "Unknown error");
  }
}

/** Remet en stock les articles d'une commande annulée, si elle avait été déduite. */
export async function restockForOrder(orderId: number): Promise<void> {
  try {
    const [order] = await db.select({ orderNumber: orders.orderNumber, items: orders.items }).from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order || !(await hasMovement(order.orderNumber, "order")) || (await hasMovement(order.orderNumber, "order_cancel"))) return;
    for (const item of order.items as OrderItem[]) {
      await moveStock(item.sku, item.size, item.quantity, "order_cancel", order.orderNumber);
    }
  } catch (error) {
    console.error("Restock failed", orderId, error instanceof Error ? error.message : "Unknown error");
  }
}
