import type { Config } from "@netlify/functions";
import { and, eq, gt, ilike, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "../../db/index.js";
import { orders } from "../../db/schema.js";
import { notifyOrderDelivered, notifyOrderShipped } from "../../lib/notifications.js";

/**
 * Suivi Colissimo automatique (tâche planifiée, toutes les 30 minutes, site publié).
 *
 * Utilise l'API « Suivi v2 » de La Poste (clé LAPOSTE_API_KEY, gratuite sur
 * developer.laposte.fr) :
 * - commande « en attente de dépôt » (numéro saisi dans l'admin) : dès que
 *   La Poste a pris le colis en charge → statut « expédiée » + e-mail au client ;
 * - commande « expédiée » : dès que La Poste indique le colis livré →
 *   statut « livrée » + e-mail de livraison (avec « Donner mon avis »).
 * Chaque changement est conditionnel au statut attendu : un e-mail ne part qu'une fois.
 */

const ENDPOINT = "https://api.laposte.fr/suivi/v2/idships/";
const MAX_PER_RUN = 40;
const MAX_AGE_DAYS = 45;

type Timeline = { id?: number; status?: boolean };
type LaPosteEvent = { code?: string };
type Tracking = {
  returnCode?: number;
  shipment?: { isFinal?: boolean; timeline?: Timeline[]; event?: LaPosteEvent[] };
};

async function fetchTracking(key: string, trackingNumber: string): Promise<Tracking | null> {
  try {
    const response = await fetch(`${ENDPOINT}${encodeURIComponent(trackingNumber)}?lang=fr_FR`, {
      headers: { "X-Okapi-Key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const data = (await response.json().catch(() => null)) as Tracking | null;
    if (!data || ![200, 207].includes(Number(data.returnCode ?? response.status))) {
      if (response.status === 401) console.error("La Poste tracking: clé API refusée (LAPOSTE_API_KEY)");
      return null;
    }
    return data;
  } catch (error) {
    console.error("La Poste tracking failed", trackingNumber, error instanceof Error ? error.message : "Unknown error");
    return null;
  }
}

const step = (t: Tracking, id: number) => Boolean(t.shipment?.timeline?.find((s) => s.id === id)?.status);
// Pris en charge : 1re étape de la frise validée, ou un événement autre que « en préparation chez l'expéditeur » (DR…).
const pickedUp = (t: Tracking) => step(t, 1) || Boolean(t.shipment?.event?.some((e) => e.code && !e.code.startsWith("DR")));
// Livré : envoi terminé et dernière étape (« livré ») validée.
const delivered = (t: Tracking) => Boolean(t.shipment?.isFinal) && step(t, 5);

export default async () => {
  const key = process.env.LAPOSTE_API_KEY?.trim();
  if (!key) return;

  try {
    const since = new Date(Date.now() - MAX_AGE_DAYS * 24 * 3600 * 1000);
    const rows = await db
      .select({ id: orders.id, status: orders.status, shipmentStatus: orders.shipmentStatus, trackingNumber: orders.trackingNumber })
      .from(orders)
      .where(
        and(
          isNotNull(orders.trackingNumber),
          ilike(orders.carrier, "colissimo"),
          gt(orders.createdAt, since),
          or(
            and(eq(orders.shipmentStatus, "awaiting_pickup"), inArray(orders.status, ["paid", "preparing"])),
            eq(orders.status, "shipped"),
          ),
        ),
      )
      .limit(MAX_PER_RUN);

    for (const order of rows) {
      const tracking = await fetchTracking(key, order.trackingNumber!);
      if (!tracking) continue;

      if (order.status !== "shipped" && pickedUp(tracking)) {
        const done = await db
          .update(orders)
          .set({ status: "shipped", shipmentStatus: "shipped", shippedAt: new Date() })
          .where(and(eq(orders.id, order.id), eq(orders.shipmentStatus, "awaiting_pickup"), inArray(orders.status, ["paid", "preparing"])))
          .returning({ id: orders.id });
        if (done[0]) {
          console.log("Order picked up by La Poste", order.id);
          await notifyOrderShipped(order.id);
        }
        continue; // la livraison sera vue au passage suivant
      }

      if (order.status === "shipped" && delivered(tracking)) {
        const done = await db
          .update(orders)
          .set({ status: "delivered", shipmentStatus: "delivered", deliveredAt: new Date() })
          .where(and(eq(orders.id, order.id), eq(orders.status, "shipped")))
          .returning({ id: orders.id });
        if (done[0]) {
          console.log("Order delivered according to La Poste", order.id);
          await notifyOrderDelivered(order.id);
        }
      }
    }
  } catch (error) {
    console.error("Track shipments failed", error instanceof Error ? error.message : "Unknown error");
  }
};

export const config: Config = {
  schedule: "*/30 * * * *",
};
