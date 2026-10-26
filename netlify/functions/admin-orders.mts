import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { orders } from "../../db/schema.js";
import { delivered, fetchTracking, pickedUp, summarize } from "../../lib/laposte.js";
import { notifyOrderDelivered, notifyOrderShipped } from "../../lib/notifications.js";
import { restockForOrder } from "../../lib/stock.js";
import { CATALOGUE } from "../../lib/catalogue.generated.js";

/**
 * Gestion des commandes par la boutique.
 *
 * Protégé par ADMIN_TOKEN (variable d'environnement secrète, 24 caractères
 * minimum), envoyé dans l'en-tête « Authorization: Bearer … ».
 *
 * GET  /api/admin/orders?status=paid    → liste des commandes (100 dernières)
 * POST /api/admin/orders                → { orderNumber, action, … }
 *
 * Transitions autorisées (vérifiées en base, jamais côté navigateur) :
 *   paid → preparing                       action "prepare"
 *   paid | preparing → shipped             action "ship" (transporteur + numéro)
 *   shipped → delivered                    action "deliver"
 *   pending_payment | paid | preparing → cancelled   action "cancel"
 *
 * Chaque mise à jour n'aboutit que si la commande est encore dans l'état
 * attendu : un double clic ne déclenche ni double transition ni double e-mail.
 */

const STATUSES = ["pending_payment", "paid", "preparing", "shipped", "delivered", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

const COLISSIMO_TRACKING_URL = "https://www.laposte.fr/outils/suivre-vos-envois?code=";

function isAuthorized(request: Request): boolean {
  const expected = process.env.ADMIN_TOKEN?.trim();
  if (!expected || expected.length < 24) return false;
  const header = request.headers.get("authorization") ?? "";
  const received = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!received) return false;
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Le suivi La Poste automatique est actif si la clé API est configurée sur Netlify. */
function autoTrackingEnabled(): boolean {
  return Boolean(process.env.LAPOSTE_API_KEY?.trim());
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const listColumns = {
  id: orders.id,
  orderNumber: orders.orderNumber,
  createdAt: orders.createdAt,
  customerName: orders.customerName,
  customerEmail: orders.customerEmail,
  customerPhone: orders.customerPhone,
  shippingAddress: orders.shippingAddress,
  items: orders.items,
  itemCount: orders.itemCount,
  subtotalCents: orders.subtotalCents,
  shippingCents: orders.shippingCents,
  deliveryZone: orders.deliveryZone,
  totalCents: orders.totalCents,
  currency: orders.currency,
  status: orders.status,
  paymentStatus: orders.paymentStatus,
  paymentReference: orders.paymentReference,
  carrier: orders.carrier,
  trackingNumber: orders.trackingNumber,
  trackingUrl: orders.trackingUrl,
  shipmentStatus: orders.shipmentStatus,
  shippedAt: orders.shippedAt,
  deliveredAt: orders.deliveredAt,
};

export default async (request: Request) => {
  if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.trim().length < 24) {
    return Response.json({ error: "Gestion des commandes non configurée (ADMIN_TOKEN)." }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return Response.json({ error: "Code d’accès incorrect." }, { status: 401 });
  }

  const noStore = { "Cache-Control": "no-store" };

  try {
    if (request.method === "GET") {
      const filter = new URL(request.url).searchParams.get("status");
      const statusFilter = STATUSES.includes(filter as Status) ? (filter as Status) : null;
      const rows = await db
        .select(listColumns)
        .from(orders)
        .where(statusFilter ? eq(orders.status, statusFilter) : undefined)
        .orderBy(desc(orders.createdAt))
        .limit(100);
      return Response.json({ orders: rows, autoTracking: autoTrackingEnabled() }, { headers: noStore });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Méthode non autorisée." }, { status: 405 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = cleanText(body?.action, 20);

    // Commande spéciale (hors site, déjà réglée) : saisie à la main pour profiter
    // du suivi Colissimo automatique et des e-mails au client. Le stock n'est pas touché.
    if (action === "create") {
      const product = CATALOGUE.find((p) => p.sku === cleanText(body?.sku, 60));
      const name = cleanText(body?.customerName, 120);
      const email = cleanText(body?.customerEmail, 200).toLowerCase();
      const phone = cleanText(body?.customerPhone, 40);
      const address = cleanText(body?.shippingAddress, 400);
      const size = cleanText(body?.size, 10).toUpperCase();
      const quantity = Number(body?.quantity ?? 1);
      const unit = Math.round(Number(String(body?.unitPrice ?? "").replace(",", ".")) * 100);
      const ship = Math.round(Number(String(body?.shipping ?? "0").replace(",", ".") || 0) * 100);
      if (!product) return Response.json({ error: "Choisis le modèle." }, { status: 400 });
      if (name.length < 2) return Response.json({ error: "Indique le nom du client." }, { status: 400 });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "E-mail du client invalide." }, { status: 400 });
      if (address.length < 10) return Response.json({ error: "Indique l'adresse de livraison complète." }, { status: 400 });
      if (!/^[A-Z0-9]{1,6}$/.test(size)) return Response.json({ error: "Indique la taille (ex. : XS)." }, { status: 400 });
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return Response.json({ error: "Quantité invalide." }, { status: 400 });
      if (!Number.isInteger(unit) || unit < 0 || unit > 100000) return Response.json({ error: "Prix invalide." }, { status: 400 });
      if (!Number.isInteger(ship) || ship < 0 || ship > 10000) return Response.json({ error: "Frais de livraison invalides." }, { status: 400 });

      const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      const subtotal = unit * quantity;
      const [created] = await db
        .insert(orders)
        .values({
          orderNumber: `FORK-${date}-${randomBytes(3).toString("hex").toUpperCase()}`,
          customerName: name,
          customerEmail: email,
          customerPhone: phone,
          shippingAddress: address,
          items: [{ sku: product.sku, name: product.name, color: product.color, size, quantity, unitPriceCents: unit, lineTotalCents: subtotal }],
          itemCount: quantity,
          subtotalCents: subtotal,
          shippingCents: ship,
          deliveryZone: "manual",
          totalCents: subtotal + ship,
          status: "paid",
          paymentStatus: "paid",
          paymentProvider: "hors_site",
          paymentReference: "Commande spéciale",
        })
        .returning({ id: orders.id });
      const [order] = await db.select(listColumns).from(orders).where(eq(orders.id, created.id)).limit(1);
      return Response.json({ order }, { headers: noStore });
    }

    const orderNumber = cleanText(body?.orderNumber, 80);
    if (!orderNumber) {
      return Response.json({ error: "Numéro de commande manquant." }, { status: 400 });
    }

    const where = (allowed: Status[]) =>
      and(eq(orders.orderNumber, orderNumber), inArray(orders.status, allowed));

    let updated: { id: number }[] = [];

    // Vérification immédiate du suivi La Poste (même logique que la tâche planifiée).
    if (action === "track-now") {
      const key = process.env.LAPOSTE_API_KEY?.trim();
      if (!key) return Response.json({ error: "Clé La Poste absente (LAPOSTE_API_KEY)." }, { status: 503 });
      const [current] = await db
        .select({ id: orders.id, status: orders.status, shipmentStatus: orders.shipmentStatus, trackingNumber: orders.trackingNumber })
        .from(orders)
        .where(eq(orders.orderNumber, orderNumber))
        .limit(1);
      if (!current?.trackingNumber) return Response.json({ error: "Aucun numéro de suivi sur cette commande." }, { status: 400 });
      const result = await fetchTracking(key, current.trackingNumber);
      if (!result.ok) {
        return Response.json({ error: `La Poste ne répond pas pour ce numéro : ${result.error}`, laposte: { error: result.error } }, { status: 502 });
      }
      const t = result.data;
      let changed: string | null = null;
      if (current.shipmentStatus === "awaiting_pickup" && ["paid", "preparing"].includes(current.status) && pickedUp(t)) {
        const done = await db
          .update(orders)
          .set({ status: "shipped", shipmentStatus: "shipped", shippedAt: new Date() })
          .where(and(eq(orders.id, current.id), eq(orders.shipmentStatus, "awaiting_pickup"), inArray(orders.status, ["paid", "preparing"])))
          .returning({ id: orders.id });
        if (done[0]) {
          await notifyOrderShipped(current.id);
          changed = "shipped";
        }
      } else if (current.status === "shipped" && delivered(t)) {
        const done = await db
          .update(orders)
          .set({ status: "delivered", shipmentStatus: "delivered", deliveredAt: new Date() })
          .where(and(eq(orders.id, current.id), eq(orders.status, "shipped")))
          .returning({ id: orders.id });
        if (done[0]) {
          await notifyOrderDelivered(current.id);
          changed = "delivered";
        }
      }
      const [order] = await db.select(listColumns).from(orders).where(eq(orders.id, current.id)).limit(1);
      return Response.json({ order, changed, laposte: summarize(t) }, { headers: noStore });
    }

    if (action === "prepare") {
      updated = await db
        .update(orders)
        .set({ status: "preparing", shipmentStatus: "preparing" })
        .where(where(["paid"]))
        .returning({ id: orders.id });
    } else if (action === "ship") {
      const carrier = cleanText(body?.carrier, 40) || "Colissimo";
      const trackingNumber = cleanText(body?.trackingNumber, 60).replace(/\s+/g, "").toUpperCase();
      let trackingUrl = cleanText(body?.trackingUrl, 500);

      if (!/^[A-Za-z0-9-]{6,40}$/.test(trackingNumber)) {
        return Response.json({ error: "Numéro de suivi invalide (6 à 40 lettres ou chiffres)." }, { status: 400 });
      }
      if (!trackingUrl && carrier.toLowerCase() === "colissimo") {
        trackingUrl = `${COLISSIMO_TRACKING_URL}${encodeURIComponent(trackingNumber)}`;
      }
      if (trackingUrl && !isHttpsUrl(trackingUrl)) {
        return Response.json({ error: "Le lien de suivi doit commencer par https://." }, { status: 400 });
      }

      if (autoTrackingEnabled() && carrier.toLowerCase() === "colissimo" && body?.sendNow !== true) {
        // Suivi automatique : on enregistre le numéro, l'e-mail « expédiée » partira
        // tout seul au premier scan du colis par La Poste (tâche track-shipments).
        updated = await db
          .update(orders)
          .set({
            status: "preparing",
            shipmentStatus: "awaiting_pickup",
            carrier,
            trackingNumber,
            trackingUrl: trackingUrl || null,
          })
          .where(where(["paid", "preparing"]))
          .returning({ id: orders.id });
      } else {
        updated = await db
          .update(orders)
          .set({
            status: "shipped",
            shipmentStatus: "shipped",
            carrier,
            trackingNumber,
            trackingUrl: trackingUrl || null,
            shippedAt: new Date(),
          })
          .where(where(["paid", "preparing"]))
          .returning({ id: orders.id });
        if (updated[0]) await notifyOrderShipped(updated[0].id);
      }
    } else if (action === "handover") {
      // Remise en main propre (livraison locale) : pas de numéro de suivi, la commande passe directement « livrée ».
      updated = await db
        .update(orders)
        .set({
          status: "delivered",
          shipmentStatus: "delivered",
          carrier: "Remise en main propre",
          trackingNumber: null,
          trackingUrl: null,
          shippedAt: new Date(),
          deliveredAt: new Date(),
        })
        .where(where(["paid", "preparing"]))
        .returning({ id: orders.id });
      if (updated[0] && body?.notifyCustomer !== false) await notifyOrderDelivered(updated[0].id);
    } else if (action === "deliver") {
      updated = await db
        .update(orders)
        .set({ status: "delivered", shipmentStatus: "delivered", deliveredAt: new Date() })
        .where(where(["shipped"]))
        .returning({ id: orders.id });
      if (updated[0] && body?.notifyCustomer !== false) await notifyOrderDelivered(updated[0].id);
    } else if (action === "cancel") {
      updated = await db
        .update(orders)
        .set({ status: "cancelled" })
        .where(where(["pending_payment", "paid", "preparing"]))
        .returning({ id: orders.id });
      // Pièces remises en stock si elles avaient été déduites au paiement.
      if (updated[0]) await restockForOrder(updated[0].id);
    } else {
      return Response.json({ error: "Action inconnue." }, { status: 400 });
    }

    if (updated.length === 0) {
      const [current] = await db
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.orderNumber, orderNumber))
        .limit(1);
      if (!current) return Response.json({ error: "Commande introuvable." }, { status: 404 });
      return Response.json(
        { error: `Action impossible : la commande est au statut « ${current.status} ».`, status: current.status },
        { status: 409 },
      );
    }

    const [order] = await db.select(listColumns).from(orders).where(eq(orders.id, updated[0].id)).limit(1);
    return Response.json({ order }, { headers: noStore });
  } catch (error) {
    console.error("Admin orders failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Opération impossible pour le moment." }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/admin/orders",
  method: ["GET", "POST"],
};
