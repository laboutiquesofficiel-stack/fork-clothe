import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { orders, promoCodes } from "../../db/schema.js";
import { cleanCode } from "../../lib/promos.js";
import { loadSettings, saveSettings } from "../../lib/settings.js";

/**
 * /api/admin/promos (même code d'accès que les commandes)
 *   GET  → réglages, codes promo (avec ventes rapportées), cartes cadeaux, ventes par provenance
 *   POST { action: "settings", settings }
 *        { action: "create", code, percent, firstOrderOnly, oncePerEmail, startsAt, endsAt, note }
 *        { action: "toggle", id, active }
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

const date = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

async function overview() {
  const settings = await loadSettings();
  const codes = await db.select().from(promoCodes).orderBy(desc(promoCodes.createdAt)).limit(300);
  const usage = await db
    .select({
      code: orders.promoCode,
      orders: sql<number>`count(*)::int`,
      discountCents: sql<number>`coalesce(sum(${orders.discountCents}), 0)::int`,
      revenueCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
    })
    .from(orders)
    .where(sql`${orders.paymentStatus} = 'paid' and ${orders.promoCode} is not null`)
    .groupBy(orders.promoCode);
  const giftUsage = await db
    .select({ code: orders.giftCardCode, orders: sql<number>`count(*)::int` })
    .from(orders)
    .where(sql`${orders.paymentStatus} = 'paid' and ${orders.giftCardCode} is not null`)
    .groupBy(orders.giftCardCode);
  const packs = await db
    .select({ orders: sql<number>`count(*)::int`, discountCents: sql<number>`coalesce(sum(${orders.discountCents}), 0)::int` })
    .from(orders)
    .where(sql`${orders.paymentStatus} = 'paid' and ${orders.discountLabel} like 'Pack%'`);
  const sources = await db
    .select({
      source: sql<string>`coalesce(${orders.source}, '')`,
      orders: sql<number>`count(*)::int`,
      revenueCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
    })
    .from(orders)
    .where(sql`${orders.paymentStatus} = 'paid' and ${orders.createdAt} > now() - interval '90 days'`)
    .groupBy(sql`coalesce(${orders.source}, '')`);

  const use = new Map(usage.map((u) => [u.code, u]));
  const giftUse = new Map(giftUsage.map((u) => [u.code, u.orders]));
  return {
    settings,
    codes: codes
      .filter((c) => c.kind !== "gift")
      .map((c) => ({
        id: c.id,
        code: c.code,
        percent: c.percent,
        firstOrderOnly: c.firstOrderOnly,
        oncePerEmail: c.oncePerEmail,
        active: c.active,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        note: c.note,
        orders: use.get(c.code)?.orders ?? 0,
        discountCents: use.get(c.code)?.discountCents ?? 0,
        revenueCents: use.get(c.code)?.revenueCents ?? 0,
      })),
    giftCards: codes
      .filter((c) => c.kind === "gift")
      .map((c) => ({
        id: c.id,
        code: c.code,
        amountCents: c.amountCents,
        balanceCents: c.balanceCents,
        active: c.active,
        endsAt: c.endsAt,
        note: c.note,
        recipientEmail: c.recipientEmail,
        orders: giftUse.get(c.code) ?? 0,
        createdAt: c.createdAt,
      })),
    packs: packs[0] ?? { orders: 0, discountCents: 0 },
    sources: sources.sort((a, b) => b.orders - a.orders),
  };
}

export default async (request: Request) => {
  if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.trim().length < 24) {
    return Response.json({ error: "Gestion non configurée (ADMIN_TOKEN)." }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return Response.json({ error: "Code d’accès incorrect." }, { status: 401 });
  }
  try {
    if (request.method === "GET") {
      return Response.json(await overview(), { headers: { "Cache-Control": "no-store" } });
    }
    const body = (await request.json().catch(() => null)) as Record<string, any> | null;
    const action = body?.action;

    if (action === "settings") {
      await saveSettings(body?.settings);
      return Response.json(await overview());
    }

    if (action === "create") {
      const code = cleanCode(body?.code);
      const percent = Math.round(Number(body?.percent));
      if (code.length < 3) return Response.json({ error: "Le code doit faire au moins 3 caractères (lettres et chiffres)." }, { status: 400 });
      if (!Number.isFinite(percent) || percent < 1 || percent > 50) return Response.json({ error: "La remise doit être entre 1 et 50 %." }, { status: 400 });
      const [exists] = await db.select({ id: promoCodes.id }).from(promoCodes).where(eq(promoCodes.code, code)).limit(1);
      if (exists) return Response.json({ error: `Le code ${code} existe déjà.` }, { status: 409 });
      await db.insert(promoCodes).values({
        code,
        kind: "percent",
        percent,
        firstOrderOnly: body?.firstOrderOnly === true,
        oncePerEmail: body?.oncePerEmail !== false,
        startsAt: date(body?.startsAt),
        endsAt: date(body?.endsAt),
        note: typeof body?.note === "string" ? body.note.trim().slice(0, 200) || null : null,
      });
      return Response.json(await overview(), { status: 201 });
    }

    if (action === "toggle") {
      const id = Number(body?.id);
      if (!Number.isInteger(id)) return Response.json({ error: "Code introuvable." }, { status: 400 });
      await db.update(promoCodes).set({ active: body?.active === true }).where(eq(promoCodes.id, id));
      return Response.json(await overview());
    }

    return Response.json({ error: "Action inconnue." }, { status: 400 });
  } catch (error) {
    console.error("Admin promos failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Impossible de charger les promos." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/admin/promos", method: ["GET", "POST"] };
