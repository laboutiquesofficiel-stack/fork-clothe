import type { Config } from "@netlify/functions";
import { CATALOGUE } from "../../lib/catalogue.generated.js";
import { available, loadStock } from "../../lib/stock.js";

/**
 * GET /api/stock → disponibilité publique par taille, sans révéler les
 * quantités au-delà de 3 :
 *   { "fork-les-minots": { "M": "in", "L": 2, "XL": "out" } }
 * Les tailles non suivies n'apparaissent pas (en vente sans limite).
 */
const LOW = 3;

export default async () => {
  try {
    const stock = await loadStock();
    const result: Record<string, Record<string, "in" | "out" | number>> = {};
    for (const p of CATALOGUE) {
      for (const size of p.sizes) {
        const q = available(stock, p.sku, size);
        if (q === null) continue;
        (result[p.sku] ??= {})[size] = q <= 0 ? "out" : q <= LOW ? q : "in";
      }
    }
    return Response.json({ stock: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Public stock failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ stock: {} }, { status: 200 });
  }
};

export const config: Config = { path: "/api/stock", method: "GET" };
