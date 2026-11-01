import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import { desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../../db/index.js";
import { orders, studioDesigns, studioImages, type OrderItem } from "../../db/schema.js";
import { loadStudioSettings, saveStudioSettings } from "../../lib/studio.js";

/**
 * /api/admin/studio (même code d'accès que les commandes)
 *   GET  → réglages du Studio + créations commandées (payées) avec leur commande
 *   POST { action: "settings", settings }
 *        { action: "status", id, status: "to_review" | "approved" | "rejected" | "in_production", note? }
 */
function isAuthorized(request: Request): boolean {
  const expected = process.env.ADMIN_TOKEN?.trim();
  if (!expected || expected.length < 24) return false;
  const header = request.headers.get("authorization") ?? "";
  const received = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!received) return false;
  return timingSafeEqual(createHash("sha256").update(received).digest(), createHash("sha256").update(expected).digest());
}

const STATUSES = ["to_review", "approved", "rejected", "in_production"];

async function overview() {
  const settings = await loadStudioSettings();
  const rows = await db.select().from(studioDesigns).where(ne(studioDesigns.status, "draft")).orderBy(desc(studioDesigns.id)).limit(300);
  const orderIds = [...new Set(rows.map((r: { orderId: number | null }) => r.orderId).filter((x: number | null): x is number => typeof x === "number"))];
  const orderRows = orderIds.length
    ? await db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          customerName: orders.customerName,
          customerEmail: orders.customerEmail,
          items: orders.items,
          status: orders.status,
          paymentStatus: orders.paymentStatus,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .where(inArray(orders.id, orderIds))
    : [];
  const byId = new Map(orderRows.map((o: { id: number }) => [o.id, o]));
  const imgIds = new Set<string>();
  for (const r of rows) {
    const d = r.design as { front?: { t: string; img?: string }[]; back?: { t: string; img?: string }[] };
    for (const e of [...(d.front ?? []), ...(d.back ?? [])]) if (e.t === "image" && e.img) imgIds.add(e.img);
  }
  const imgRows = imgIds.size
    ? await db.select({ publicId: studioImages.publicId, aiNote: studioImages.aiNote, aiVerdict: studioImages.aiVerdict, width: studioImages.width, height: studioImages.height }).from(studioImages).where(inArray(studioImages.publicId, [...imgIds]))
    : [];
  return {
    settings,
    designs: rows.map((r: any) => {
      const o: any = r.orderId ? byId.get(r.orderId) : null;
      const item = o ? (o.items as OrderItem[]).find((i) => i.studio?.designId === r.publicId) : null;
      return {
        id: r.publicId,
        status: r.status,
        tier: r.tier,
        priceCents: r.priceCents,
        design: r.design,
        adminNote: r.adminNote,
        contest: r.contest,
        createdAt: r.createdAt,
        order: o ? { number: o.orderNumber, name: o.customerName, email: o.customerEmail, status: o.status, paid: o.paymentStatus === "paid", date: o.createdAt } : null,
        size: item?.size ?? null,
        quantity: item?.quantity ?? null,
      };
    }),
    images: Object.fromEntries(imgRows.map((i: any) => [i.publicId, { note: i.aiNote, verdict: i.aiVerdict, width: i.width, height: i.height }])),
  };
}

export default async (request: Request) => {
  if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.trim().length < 24) {
    return Response.json({ error: "Gestion non configurée (ADMIN_TOKEN)." }, { status: 503 });
  }
  if (!isAuthorized(request)) return Response.json({ error: "Code d’accès incorrect." }, { status: 401 });
  try {
    if (request.method === "GET") return Response.json(await overview(), { headers: { "Cache-Control": "no-store" } });
    const body = (await request.json().catch(() => null)) as Record<string, any> | null;
    if (body?.action === "settings") {
      await saveStudioSettings(body.settings);
      return Response.json(await overview());
    }
    if (body?.action === "status") {
      const id = typeof body.id === "string" && /^[a-f0-9]{16}$/.test(body.id) ? body.id : "";
      if (!id || !STATUSES.includes(body.status)) return Response.json({ error: "Action invalide." }, { status: 400 });
      await db
        .update(studioDesigns)
        .set({ status: body.status, adminNote: typeof body.note === "string" ? body.note.trim().slice(0, 300) || null : null, updatedAt: new Date() })
        .where(eq(studioDesigns.publicId, id));
      return Response.json(await overview());
    }
    return Response.json({ error: "Action inconnue." }, { status: 400 });
  } catch (error) {
    console.error("Admin studio failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Impossible de charger le Studio." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/admin/studio", method: ["GET", "POST"] };
