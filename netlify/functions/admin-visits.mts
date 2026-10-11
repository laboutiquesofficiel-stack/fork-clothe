import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import { gte } from "drizzle-orm";
import { db } from "../../db/index.js";
import { visitPages, visitVisitors } from "../../db/schema.js";
import { CATALOGUE } from "../../lib/catalogue.generated.js";

/**
 * GET /api/admin/visits?days=30 → fréquentation du site (même code d'accès que les commandes).
 * Visiteurs uniques par jour, pages vues, pages les plus vues, provenance.
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

const parisDay = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const PAGE_LABELS: Record<string, string> = {
  "/": "Accueil",
  "/index.html": "Accueil",
  "/cgv.html": "CGV",
  "/mentions-legales.html": "Mentions légales",
  "/confidentialite.html": "Confidentialité",
  "/404": "Page introuvable",
};
for (const p of CATALOGUE) PAGE_LABELS[`/t-shirt/${p.id}/`] = `${p.type} ${p.name}`;
const labelOf = (path: string) => PAGE_LABELS[path] ?? PAGE_LABELS[path.replace(/\/?$/, "/")] ?? path;

export default async (request: Request) => {
  if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.trim().length < 24) {
    return Response.json({ error: "Gestion non configurée (ADMIN_TOKEN)." }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return Response.json({ error: "Code d’accès incorrect." }, { status: 401 });
  }
  try {
    const requested = Number(new URL(request.url).searchParams.get("days"));
    const days = [7, 30, 90, 365].includes(requested) ? requested : 30;

    // Liste des jours de la période (du plus ancien à aujourd'hui), heure de Paris.
    const list: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = parisDay(new Date(Date.now() - i * 24 * 3600 * 1000));
      if (!list.includes(d)) list.push(d);
    }
    const from = list[0];
    const today = list[list.length - 1];

    const [pages, visitors] = await Promise.all([
      db.select({ day: visitPages.day, path: visitPages.path, views: visitPages.views }).from(visitPages).where(gte(visitPages.day, from)),
      db.select({ day: visitVisitors.day, source: visitVisitors.source }).from(visitVisitors).where(gte(visitVisitors.day, from)),
    ]);

    const perDay = new Map(list.map((d) => [d, { day: d, visitors: 0, views: 0 }]));
    const perPage = new Map<string, number>();
    const perSource = new Map<string, number>();
    for (const r of pages as { day: string; path: string; views: number }[]) {
      const e = perDay.get(r.day);
      if (e) e.views += r.views;
      const label = labelOf(r.path);
      perPage.set(label, (perPage.get(label) ?? 0) + r.views);
    }
    for (const r of visitors as { day: string; source: string }[]) {
      const e = perDay.get(r.day);
      if (e) e.visitors += 1;
      perSource.set(r.source, (perSource.get(r.source) ?? 0) + 1);
    }

    const series = [...perDay.values()];
    const sum = (rows: typeof series) => rows.reduce((t, r) => ({ visitors: t.visitors + r.visitors, views: t.views + r.views }), { visitors: 0, views: 0 });
    const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));

    return Response.json(
      {
        days,
        today: perDay.get(today) ?? { day: today, visitors: 0, views: 0 },
        total: sum(series),
        series,
        pages: sorted(perPage).slice(0, 15),
        sources: sorted(perSource).slice(0, 15),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Admin visits failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Erreur serveur." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/admin/visits", method: "GET" };
