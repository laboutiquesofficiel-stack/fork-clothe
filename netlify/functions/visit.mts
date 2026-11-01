import { createHash } from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import { lt, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { visitPages, visitVisitors } from "../../db/schema.js";

/**
 * POST /api/visit { path, ref, src? } — mesure d'audience maison, sans cookie.
 *
 * Envoyé par le site à chaque page affichée. On enregistre :
 * - la page vue (compteur par jour et par page) ;
 * - le visiteur du jour, sous forme d'empreinte anonyme (adresse IP + navigateur
 *   + jour, passés dans un hachage avec un secret) : rien ne permet de retrouver
 *   la personne ni de la suivre d'un jour à l'autre. L'adresse IP n'est pas stockée.
 * Les robots sont ignorés. Les données de plus de 13 mois sont supprimées.
 */

const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|facebookexternalhit|embedly|whatsapp|telegram|curl|wget|python|node-fetch|axios|monitor/i;
const PATH = /^\/[A-Za-z0-9._\-/]{0,120}$/;
const KEEP_DAYS = 400;

const parisDay = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

function sourceOf(ref: string, ownHost: string): string | null {
  if (!ref) return "Accès direct";
  let host: string;
  try {
    host = new URL(ref).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "Accès direct";
  }
  if (host === ownHost || host === "fork-clothe.com" || host.endsWith(".netlify.app")) return null; // navigation interne
  if (/(^|\.)google\./.test(host)) return "Google";
  if (/instagram\.com$/.test(host)) return "Instagram";
  if (/facebook\.com$|fb\.me$/.test(host)) return "Facebook";
  if (/tiktok\.com$/.test(host)) return "TikTok";
  if (/snapchat\.com$/.test(host)) return "Snapchat";
  if (/bing\.com$/.test(host)) return "Bing";
  if (/qwant\.com$/.test(host)) return "Qwant";
  if (/duckduckgo\.com$/.test(host)) return "DuckDuckGo";
  if (/ecosia\.org$/.test(host)) return "Ecosia";
  if (/fork-padel-cup/.test(host)) return "Site FORK PADEL CUP";
  if (/mail\.|outlook|gmail|yahoo/.test(host)) return "E-mail";
  return host.slice(0, 60);
}

/** Lien marqué ?src=… (bio Instagram, QR des cartes, pub…) : prioritaire sur le référent. */
const SRC_LABELS: Record<string, string> = {
  bio: "Instagram (lien bio)",
  insta: "Instagram",
  story: "Instagram (story)",
  dm: "Instagram (message privé)",
  pub: "Pub Instagram",
  carte: "Carte FORK (QR)",
  qr: "QR code",
  stand: "Stand / marché (QR)",
  tiktok: "TikTok",
  "email-bienvenue": "E-mail de bienvenue",
  "carte-cadeau": "Carte cadeau",
};
function labelOfSrc(src: unknown): string | null {
  if (typeof src !== "string") return null;
  const key = src.trim().toLowerCase();
  if (!/^[a-z0-9-]{1,30}$/.test(key)) return null;
  return SRC_LABELS[key] ?? `Lien « ${key} »`;
}

export default async (request: Request, context: Context) => {
  const done = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  try {
    const secret = process.env.ADMIN_TOKEN?.trim();
    const ua = request.headers.get("user-agent") ?? "";
    if (!secret || !ua || BOT.test(ua)) return done;

    const body = (await request.json().catch(() => null)) as { path?: unknown; ref?: unknown; src?: unknown } | null;
    const path = typeof body?.path === "string" ? body.path.slice(0, 121) : "";
    if (!PATH.test(path)) return done;
    const ref = typeof body?.ref === "string" ? body.ref.slice(0, 500) : "";

    const day = parisDay();
    const ownHost = new URL(request.url).hostname.toLowerCase().replace(/^www\./, "");
    const ip = context.ip || request.headers.get("x-nf-client-connection-ip") || "";
    const visitor = createHash("sha256").update(`${secret}|${day}|${ip}|${ua}`).digest("hex").slice(0, 32);

    await db
      .insert(visitPages)
      .values({ day, path, views: 1 })
      .onConflictDoUpdate({ target: [visitPages.day, visitPages.path], set: { views: sql`${visitPages.views} + 1` } });

    const source = labelOfSrc(body?.src) ?? sourceOf(ref, ownHost) ?? "Accès direct";
    await db.insert(visitVisitors).values({ day, visitor, source }).onConflictDoNothing({ target: [visitVisitors.day, visitVisitors.visitor] });

    if (Math.random() < 0.02) {
      const cutoff = parisDay(new Date(Date.now() - KEEP_DAYS * 24 * 3600 * 1000));
      await db.delete(visitPages).where(lt(visitPages.day, cutoff));
      await db.delete(visitVisitors).where(lt(visitVisitors.day, cutoff));
    }
  } catch (error) {
    console.error("Visit failed", error instanceof Error ? error.message : "Unknown error");
  }
  return done;
};

export const config: Config = { path: "/api/visit", method: "POST" };
