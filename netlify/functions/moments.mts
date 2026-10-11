import { createHash } from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import { and, desc, eq, gt, lt } from "drizzle-orm";
import { db } from "../../db/index.js";
import { moments } from "../../db/schema.js";
import { decide, productBySku, verifyMomentPhoto } from "../../lib/moments.js";
import { notifyMomentPublished, notifyMomentToReview } from "../../lib/notifications.js";
import { parsePhoto } from "../../lib/reviews.js";

/**
 * « Vos moments » : photos des clients avec leur t-shirt FORK.
 *
 * GET  /api/moments?before=<id>  → photos publiées (24 par page), sans e-mail.
 * POST /api/moments { photo, firstName, place?, sku?, email, consent, website }
 *   La photo est vérifiée par l'IA avant toute publication :
 *   - t-shirt FORK reconnu, photo correcte → publiée tout de suite ;
 *   - doute (t-shirt mal visible, mineur visible, IA indisponible) → en attente de validation dans l'admin ;
 *   - pas de t-shirt FORK, capture d'écran ou contenu inapproprié → refusée, rien n'est enregistré.
 * Limite : 5 envois par appareil et par 24 h.
 */

const PAGE = 24;
const MAX_PER_DAY = 5;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

function publicItem(m: { id: number; firstName: string; place: string | null; productSku: string | null; publishedAt: Date | null; createdAt: Date }) {
  const p = productBySku(m.productSku);
  return {
    id: m.id,
    firstName: m.firstName,
    place: m.place,
    product: p ? { sku: p.sku, name: `${p.type} ${p.name}`, url: `/t-shirt/${p.id}/` } : null,
    date: m.publishedAt ?? m.createdAt,
    photo: `/api/moment-photo?id=${m.id}`,
  };
}

export default async (request: Request, context: Context) => {
  try {
    if (request.method === "GET") {
      const before = Number(new URL(request.url).searchParams.get("before"));
      const rows = await db
        .select({
          id: moments.id,
          firstName: moments.firstName,
          place: moments.place,
          productSku: moments.productSku,
          publishedAt: moments.publishedAt,
          createdAt: moments.createdAt,
        })
        .from(moments)
        .where(Number.isInteger(before) && before > 0 ? and(eq(moments.status, "published"), lt(moments.id, before)) : eq(moments.status, "published"))
        .orderBy(desc(moments.id))
        .limit(PAGE + 1);
      const items = rows.slice(0, PAGE).map(publicItem);
      return Response.json(
        { items, next: rows.length > PAGE ? items[items.length - 1].id : null },
        { headers: { "Cache-Control": "public, max-age=60" } },
      );
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: "Requête invalide." }, { status: 400 });
    if (clean(body.website, 100)) return Response.json({ status: "pending" }); // robot (champ caché rempli)

    const firstName = clean(body.firstName, 30);
    const place = clean(body.place, 60) || null;
    const email = clean(body.email, 200).toLowerCase();
    const chosenSku = productBySku(clean(body.sku, 60))?.sku ?? null;
    if (firstName.length < 2) return Response.json({ error: "Indique ton prénom." }, { status: 400 });
    if (!EMAIL.test(email)) return Response.json({ error: "Indique une adresse e-mail valide." }, { status: 400 });
    if (body.consent !== true) return Response.json({ error: "Coche la case d'accord pour publier ta photo." }, { status: 400 });
    const photo = parsePhoto(body.photo);
    if (!photo) return Response.json({ error: "Photo invalide ou trop lourde (JPEG, PNG ou WebP)." }, { status: 400 });

    const ua = request.headers.get("user-agent") ?? "";
    const ip = context.ip || request.headers.get("x-nf-client-connection-ip") || "";
    const visitorHash = createHash("sha256").update(`${process.env.ADMIN_TOKEN ?? ""}|moments|${ip}|${ua}`).digest("hex").slice(0, 32);
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const recent = await db
      .select({ id: moments.id })
      .from(moments)
      .where(and(eq(moments.visitorHash, visitorHash), gt(moments.createdAt, since)))
      .limit(MAX_PER_DAY);
    if (recent.length >= MAX_PER_DAY) {
      return Response.json({ error: "Tu as déjà partagé plusieurs photos aujourd'hui. Réessaie demain !" }, { status: 429 });
    }

    const verdict = await verifyMomentPhoto(photo);
    const decision = decide(verdict);
    if (decision.kind === "reject") {
      console.log("Moment refusé", decision.verdict.note);
      return Response.json({ error: decision.message }, { status: 422 });
    }

    const publish = decision.kind === "publish";
    const [row] = await db
      .insert(moments)
      .values({
        status: publish ? "published" : "pending",
        firstName,
        place,
        productSku: verdict?.modelSku ?? chosenSku,
        email,
        contentType: photo.contentType,
        dataBase64: photo.base64,
        aiVerdict: verdict ?? null,
        aiNote: decision.kind === "review" ? decision.reason : verdict?.note ?? null,
        visitorHash,
        publishedAt: publish ? new Date() : null,
      })
      .returning({ id: moments.id });

    if (publish) await notifyMomentPublished(row.id);
    else await notifyMomentToReview(row.id, decision.kind === "review" ? decision.reason : "");

    return Response.json({ status: publish ? "published" : "pending", id: row.id });
  } catch (error) {
    console.error("Moments failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Erreur serveur. Réessaie dans un instant." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/moments", method: ["GET", "POST"] };
