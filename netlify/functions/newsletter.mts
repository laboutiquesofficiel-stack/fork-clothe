import { randomBytes } from "node:crypto";
import type { Config } from "@netlify/functions";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { newsletterSubscribers } from "../../db/schema.js";
import { notifyNewsletterWelcome } from "../../lib/notifications.js";

/**
 * « Préviens-moi de la prochaine collection ».
 *
 * POST /api/newsletter { email, consent: true, source?, website? }
 *   → inscrit (ou réinscrit) l'adresse et envoie un e-mail de bienvenue
 *     contenant le lien de désinscription. La réponse est la même que
 *     l'adresse soit nouvelle ou déjà inscrite (aucune fuite d'information).
 * GET /api/newsletter?unsubscribe=<jeton>
 *   → désinscription en un clic, puis retour sur le site.
 * POST /api/newsletter?unsubscribe=<jeton>
 *   → désinscription « un clic » déclenchée par la messagerie (List-Unsubscribe-Post).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async (request: Request) => {
  const url = new URL(request.url);

  try {
    if (request.method === "GET") {
      const token = (url.searchParams.get("unsubscribe") ?? "").trim();
      let result = "invalid";
      if (/^[a-f0-9]{48}$/.test(token)) {
        const updated = await db
          .update(newsletterSubscribers)
          .set({ status: "unsubscribed", unsubscribedAt: new Date() })
          .where(and(eq(newsletterSubscribers.unsubscribeToken, token), eq(newsletterSubscribers.status, "subscribed")))
          .returning({ id: newsletterSubscribers.id });
        if (updated.length) result = "unsubscribed";
        else {
          const [known] = await db
            .select({ id: newsletterSubscribers.id })
            .from(newsletterSubscribers)
            .where(eq(newsletterSubscribers.unsubscribeToken, token))
            .limit(1);
          if (known) result = "unsubscribed";
        }
      }
      return new Response(null, {
        status: 302,
        headers: { Location: `${url.origin}/?newsletter=${result}`, "Cache-Control": "no-store" },
      });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Méthode non autorisée." }, { status: 405 });
    }

    // Désinscription « en un clic » depuis la messagerie (en-tête List-Unsubscribe-Post).
    const oneClickToken = (url.searchParams.get("unsubscribe") ?? "").trim();
    if (oneClickToken) {
      if (/^[a-f0-9]{48}$/.test(oneClickToken)) {
        await db
          .update(newsletterSubscribers)
          .set({ status: "unsubscribed", unsubscribedAt: new Date() })
          .where(and(eq(newsletterSubscribers.unsubscribeToken, oneClickToken), eq(newsletterSubscribers.status, "subscribed")));
      }
      return new Response("OK", { status: 200 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    // Champ invisible : rempli seulement par les robots. On répond « ok » sans rien enregistrer.
    if (typeof body?.website === "string" && body.website.trim()) {
      return Response.json({ ok: true });
    }
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
    if (!EMAIL_RE.test(email)) {
      return Response.json({ error: "Indique une adresse e-mail valide." }, { status: 400 });
    }
    if (body?.consent !== true) {
      return Response.json({ error: "Coche la case pour accepter de recevoir nos e-mails." }, { status: 400 });
    }
    const source = typeof body?.source === "string" ? body.source.trim().slice(0, 60) : null;

    const [existing] = await db
      .select({ id: newsletterSubscribers.id, status: newsletterSubscribers.status })
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, email))
      .limit(1);

    if (!existing) {
      const [created] = await db
        .insert(newsletterSubscribers)
        .values({ email, source, unsubscribeToken: randomBytes(24).toString("hex") })
        .onConflictDoNothing()
        .returning({ id: newsletterSubscribers.id });
      if (created) await notifyNewsletterWelcome(created.id);
    } else if (existing.status !== "subscribed") {
      await db
        .update(newsletterSubscribers)
        .set({ status: "subscribed", source, consentAt: new Date(), unsubscribedAt: null })
        .where(eq(newsletterSubscribers.id, existing.id));
      await notifyNewsletterWelcome(existing.id);
    }

    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Newsletter failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Inscription impossible pour le moment." }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/newsletter",
  method: ["GET", "POST"],
};
