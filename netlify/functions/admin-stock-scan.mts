import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import { CATALOGUE } from "../../lib/catalogue.generated.js";
import { moveStock, receiveStock } from "../../lib/stock.js";
import { scanTshirt } from "../../lib/stock-scan.js";

/**
 * Scanner de stock dans l'admin (même code d'accès que les commandes).
 *
 * POST /api/admin/stock-scan
 *   { mode: "in" | "out", photo, lockSku? }  → l'IA lit taille + modèle ; si les deux sont sûrs,
 *                                              le stock est mis à jour tout de suite (+1 réception, −1 vente sur place)
 *   { mode, sku, size }                       → application manuelle (taille ou modèle choisi au doigt)
 *   { undo: { sku, size, delta } }            → annule un scan
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

const MAX_BYTES = 4_000_000;
const bySku = new Map(CATALOGUE.map((p) => [p.sku, p]));
const valid = (sku: unknown, size: unknown) => typeof sku === "string" && typeof size === "string" && Boolean(bySku.get(sku)?.sizes.includes(size));
const label = (sku: string) => {
  const p = bySku.get(sku)!;
  return `${p.type} ${p.name}`;
};

function parseImage(value: unknown): { contentType: string; base64: string } | null {
  if (typeof value !== "string") return null;
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!m) return null;
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.length || bytes.length > MAX_BYTES) return null;
  return { contentType: `image/${m[1]}`, base64: m[2] };
}

async function apply(mode: "in" | "out", sku: string, size: string) {
  const delta = mode === "in" ? 1 : -1;
  const quantity =
    mode === "in"
      ? await receiveStock(sku, size, 1, "Réception (scan)")
      : await moveStock(sku, size, -1, "market", `marché ${new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}`, "Vente (scan)");
  return { sku, name: label(sku), size, delta, quantity };
}

export default async (request: Request) => {
  if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.trim().length < 24) {
    return Response.json({ error: "Gestion non configurée (ADMIN_TOKEN)." }, { status: 503 });
  }
  if (!isAuthorized(request)) return Response.json({ error: "Code d’accès incorrect." }, { status: 401 });
  const noStore = { "Cache-Control": "no-store" };

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: "Requête invalide." }, { status: 400 });

    // Annulation d'un scan.
    if (body.undo && typeof body.undo === "object") {
      const u = body.undo as Record<string, unknown>;
      const delta = Number(u.delta);
      if (!valid(u.sku, u.size) || (delta !== 1 && delta !== -1)) return Response.json({ error: "Annulation invalide." }, { status: 400 });
      const quantity = await moveStock(String(u.sku), String(u.size), -delta, "adjust", null, "Annulation d'un scan");
      return Response.json({ undone: true, quantity }, { headers: noStore });
    }

    const mode = body.mode === "out" ? "out" : body.mode === "in" ? "in" : null;
    if (!mode) return Response.json({ error: "Choisis Réception ou Vente." }, { status: 400 });

    // Application manuelle (après un scan incomplet).
    if (body.sku !== undefined || body.size !== undefined) {
      if (!valid(body.sku, body.size)) return Response.json({ error: "Ce modèle n'existe pas dans cette taille." }, { status: 400 });
      return Response.json({ applied: await apply(mode, String(body.sku), String(body.size)) }, { headers: noStore });
    }

    const photo = parseImage(body.photo);
    if (!photo) return Response.json({ error: "Photo illisible, réessaie." }, { status: 400 });
    const lockSku = typeof body.lockSku === "string" && bySku.has(body.lockSku) ? body.lockSku : null;

    const scan = await scanTshirt(photo, lockSku);
    if (!scan) return Response.json({ error: "La lecture automatique est indisponible pour le moment : choisis le modèle et la taille à la main.", detection: { sku: lockSku, size: null } }, { status: 200, headers: noStore });
    if (!scan.tshirt) return Response.json({ detection: { sku: null, size: null, note: "Aucun t-shirt visible sur la photo." } }, { headers: noStore });

    const sku = scan.sku;
    const size = scan.size;
    if (sku && size && !bySku.get(sku)!.sizes.includes(size)) {
      return Response.json({ detection: { sku, size: null, note: `Taille ${size} lue, mais ${label(sku)} n'existe pas dans cette taille. Vérifie l'étiquette.` } }, { headers: noStore });
    }
    if (sku && size) {
      const applied = await apply(mode, sku, size);
      return Response.json({ applied, note: scan.note }, { headers: noStore });
    }
    return Response.json({ detection: { sku, size, note: scan.note } }, { headers: noStore });
  } catch (error) {
    console.error("Stock scan failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Erreur serveur." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/admin/stock-scan", method: "POST" };
