import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import { desc } from "drizzle-orm";
import { db } from "../../db/index.js";
import { stockMovements } from "../../db/schema.js";
import { CATALOGUE } from "../../lib/catalogue.generated.js";
import { loadStock, moveStock, setStock } from "../../lib/stock.js";

/**
 * Stock dans l'admin (même code d'accès que les commandes).
 *
 * GET  /api/admin/stock → t-shirts, tailles, quantités et 50 derniers mouvements
 * POST /api/admin/stock
 *   { action: "count",  counts: [{ sku, size, quantity }] }    inventaire (quantités exactes)
 *   { action: "market", sales: [{ sku, size, quantity }], note? }  vente sur place (retire)
 *   { action: "adjust", sku, size, delta, note? }                correction (+/-)
 */

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

const bySku = new Map(CATALOGUE.map((p) => [p.sku, p]));
const validLine = (sku: unknown, size: unknown) =>
  typeof sku === "string" && typeof size === "string" && Boolean(bySku.get(sku)?.sizes.includes(size));
const clean = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

async function snapshot() {
  const stock = await loadStock();
  const products = CATALOGUE.map((p) => ({
    sku: p.sku,
    name: p.name,
    type: p.type,
    color: p.color,
    image: p.image,
    sizes: p.sizes.map((size) => {
      const q = stock.get(`${p.sku}|${size}`);
      return { size, quantity: q === undefined ? null : q };
    }),
  }));
  const movements = await db
    .select({
      sku: stockMovements.sku,
      size: stockMovements.size,
      delta: stockMovements.delta,
      quantityAfter: stockMovements.quantityAfter,
      reason: stockMovements.reason,
      reference: stockMovements.reference,
      note: stockMovements.note,
      createdAt: stockMovements.createdAt,
    })
    .from(stockMovements)
    .orderBy(desc(stockMovements.id))
    .limit(50);
  return { products, movements };
}

export default async (request: Request) => {
  if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.trim().length < 24) {
    return Response.json({ error: "Gestion non configurée (ADMIN_TOKEN)." }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return Response.json({ error: "Code d’accès incorrect." }, { status: 401 });
  }
  const noStore = { "Cache-Control": "no-store" };

  try {
    if (request.method === "GET") return Response.json(await snapshot(), { headers: noStore });
    if (request.method !== "POST") return Response.json({ error: "Méthode non autorisée." }, { status: 405 });

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = clean(body?.action, 20);
    const note = clean(body?.note, 200) || null;

    if (action === "count") {
      const counts = Array.isArray(body?.counts) ? (body.counts as Record<string, unknown>[]) : [];
      if (!counts.length || counts.length > 200) return Response.json({ error: "Aucune quantité à enregistrer." }, { status: 400 });
      for (const c of counts) {
        const q = Number(c.quantity);
        if (!validLine(c.sku, c.size) || !Number.isInteger(q) || q < 0 || q > 100000) {
          return Response.json({ error: "Quantité invalide (nombre entier, 0 ou plus)." }, { status: 400 });
        }
      }
      for (const c of counts) await setStock(String(c.sku), String(c.size), Number(c.quantity), note);
    } else if (action === "market") {
      const sales = Array.isArray(body?.sales) ? (body.sales as Record<string, unknown>[]) : [];
      if (!sales.length || sales.length > 100) return Response.json({ error: "Aucune vente à enregistrer." }, { status: 400 });
      for (const s of sales) {
        const q = Number(s.quantity);
        if (!validLine(s.sku, s.size) || !Number.isInteger(q) || q < 1 || q > 1000) {
          return Response.json({ error: "Vente invalide." }, { status: 400 });
        }
      }
      const ref = `marché ${new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}`;
      for (const s of sales) await moveStock(String(s.sku), String(s.size), -Number(s.quantity), "market", ref, note);
    } else if (action === "adjust") {
      const delta = Number(body?.delta);
      if (!validLine(body?.sku, body?.size) || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1000) {
        return Response.json({ error: "Correction invalide." }, { status: 400 });
      }
      await moveStock(String(body?.sku), String(body?.size), delta, "adjust", null, note);
    } else {
      return Response.json({ error: "Action inconnue." }, { status: 400 });
    }

    return Response.json(await snapshot(), { headers: noStore });
  } catch (error) {
    console.error("Admin stock failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Erreur serveur." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/admin/stock", method: ["GET", "POST"] };
