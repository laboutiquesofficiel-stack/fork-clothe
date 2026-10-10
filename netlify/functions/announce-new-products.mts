import type { Config } from "@netlify/functions";
import { and, asc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { db } from "../../db/index.js";
import { announcedProducts, announcementCampaigns, newsletterSubscribers } from "../../db/schema.js";
import { CATALOGUE } from "../../lib/catalogue.generated.js";
import { escapeHtml, formatEuros, sendEmailBatch } from "../../lib/email.js";
import { layout } from "../../lib/notifications.js";

/**
 * Annonce automatique des nouveautés aux inscrits « Préviens-moi ».
 *
 * Tâche planifiée (toutes les 15 minutes, uniquement sur le site publié) :
 * 1. tout article en vente du catalogue qui n'a encore jamais été annoncé
 *    déclenche une campagne (plusieurs nouveautés publiées ensemble = un seul
 *    e-mail). De nouvelles photos sur un article existant ne déclenchent rien ;
 * 2. les campagnes en cours sont envoyées par lots de 100, en reprenant là où
 *    elles s'étaient arrêtées. Chaque inscrit reçoit un seul e-mail, avec son
 *    propre lien de désinscription. Seuls les inscrits actifs au moment de
 *    l'envoi, inscrits avant la campagne, le reçoivent.
 */

const BATCH = 100;
const MAX_BATCHES_PER_RUN = 5;

type Item = (typeof CATALOGUE)[number];

function emailFor(items: Item[], unsubscribeUrl: string) {
  const one = items.length === 1;
  const first = items[0];
  const label = (i: Item) => `${i.type} ${i.name}`;
  const subject = one ? `Nouveau chez FORK : ${label(first)} 🔥` : `Nouveautés chez FORK : ${items.map(label).join(", ")} 🔥`;
  const cards = items
    .map(
      (i) => `<tr><td style="padding:0 0 22px">
  <a href="${i.url}" style="text-decoration:none;color:#111"><img src="${i.image}" width="512" alt="${escapeHtml(label(i))}" style="display:block;width:100%;max-width:512px;height:auto;border:0"></a>
  <p style="margin:12px 0 2px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#6b6b6b">Nouveau · ${escapeHtml(i.type)}</p>
  <p style="margin:0;font-size:18px;font-weight:800;text-transform:uppercase">${escapeHtml(label(i))}</p>
  <p style="margin:4px 0 14px;font-size:14px;color:#444">${escapeHtml(i.color)} · ${formatEuros(i.priceCents)}</p>
  <a href="${i.url}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 22px;font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase">Découvrir ${one ? "la nouveauté" : escapeHtml(i.name)}</a>
</td></tr>`,
    )
    .join("");
  const html = layout(
    one ? "La nouveauté est en ligne" : "Les nouveautés sont en ligne",
    `<p style="font-size:14px;line-height:1.6">Tu nous avais demandé de te prévenir : ${one ? `le ${escapeHtml(label(first))} vient de sortir` : "de nouvelles pièces viennent de sortir"} sur fork-clothe.com. Les séries sont limitées, fonce !</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px">${cards}</table>
<p style="font-size:12px;line-height:1.6;color:#6b6b6b">Tu reçois cet e-mail car tu t'es inscrit pour être prévenu des nouvelles collections FORK. <a href="${unsubscribeUrl}" style="color:#6b6b6b">Se désinscrire en un clic</a>.</p>`,
  );
  const text = `${one ? `Nouveau chez FORK : ${label(first)}` : "Nouveautés chez FORK"}\n\n${items
    .map((i) => `${label(i)} · ${i.color} · ${formatEuros(i.priceCents)}\n${i.url}`)
    .join("\n\n")}\n\nSe désinscrire : ${unsubscribeUrl}\n\nFORK · Toulon`;
  return { subject, html, text };
}

async function createCampaignForNewProducts(): Promise<void> {
  const forSale = CATALOGUE.filter((i) => i.available);
  if (!forSale.length) return;
  const known = await db
    .select({ sku: announcedProducts.sku })
    .from(announcedProducts)
    .where(inArray(announcedProducts.sku, forSale.map((i) => i.sku)));
  const knownSkus = new Set(known.map((k) => k.sku));
  const fresh = forSale.filter((i) => !knownSkus.has(i.sku));
  if (!fresh.length) return;

  // Réservation : si deux exécutions se chevauchent, une seule obtient chaque article.
  const claimed = await db
    .insert(announcedProducts)
    .values(fresh.map((i) => ({ sku: i.sku })))
    .onConflictDoNothing()
    .returning({ sku: announcedProducts.sku });
  const items = fresh.filter((i) => claimed.some((c) => c.sku === i.sku));
  if (!items.length) return;

  const [campaign] = await db
    .insert(announcementCampaigns)
    .values({
      items: items.map(({ sku, type, name, color, priceCents, image, url }) => ({ sku, type, name, color, priceCents, image, url })),
    })
    .returning({ id: announcementCampaigns.id });
  await db
    .update(announcedProducts)
    .set({ campaignId: campaign.id })
    .where(inArray(announcedProducts.sku, items.map((i) => i.sku)));
  console.log(`Announcement campaign ${campaign.id} created for ${items.map((i) => i.sku).join(", ")}`);
}

async function sendPendingCampaigns(): Promise<void> {
  const campaigns = await db
    .select()
    .from(announcementCampaigns)
    .where(isNull(announcementCampaigns.completedAt))
    .orderBy(asc(announcementCampaigns.id));

  let batches = 0;
  for (const campaign of campaigns) {
    let cursor = campaign.lastSubscriberId;
    let sent = campaign.sentCount;
    while (batches < MAX_BATCHES_PER_RUN) {
      const subs = await db
        .select({ id: newsletterSubscribers.id, email: newsletterSubscribers.email, token: newsletterSubscribers.unsubscribeToken })
        .from(newsletterSubscribers)
        .where(
          and(
            eq(newsletterSubscribers.status, "subscribed"),
            gt(newsletterSubscribers.id, cursor),
            lte(newsletterSubscribers.consentAt, campaign.createdAt),
          ),
        )
        .orderBy(asc(newsletterSubscribers.id))
        .limit(BATCH);

      if (!subs.length) {
        await db
          .update(announcementCampaigns)
          .set({ completedAt: new Date() })
          .where(eq(announcementCampaigns.id, campaign.id));
        console.log(`Announcement campaign ${campaign.id} completed: ${sent} e-mails`);
        break;
      }

      const messages = subs.map((s) => {
        const unsubscribeUrl = `https://fork-clothe.com/api/newsletter?unsubscribe=${s.token}`;
        return {
          to: s.email,
          ...emailFor(campaign.items as Item[], unsubscribeUrl),
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        };
      });
      const lastId = subs[subs.length - 1].id;
      const ok = await sendEmailBatch(messages, `announce-${campaign.id}-${cursor}-${lastId}`);
      batches += 1;
      if (!ok) {
        // On réessaiera au prochain passage, à partir du même inscrit.
        console.error(`Announcement campaign ${campaign.id}: batch after subscriber ${cursor} failed`);
        return;
      }
      cursor = lastId;
      sent += subs.length;
      await db
        .update(announcementCampaigns)
        .set({ lastSubscriberId: cursor, sentCount: sent })
        .where(eq(announcementCampaigns.id, campaign.id));
    }
    if (batches >= MAX_BATCHES_PER_RUN) return;
  }
}

export default async () => {
  try {
    await createCampaignForNewProducts();
    await sendPendingCampaigns();
  } catch (error) {
    console.error("Announce new products failed", error instanceof Error ? error.message : "Unknown error");
  }
};

export const config: Config = {
  schedule: "*/15 * * * *",
};
