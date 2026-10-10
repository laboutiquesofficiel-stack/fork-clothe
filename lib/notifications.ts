import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { orders, productReviews, type OrderItem } from "../db/schema.js";
import { escapeHtml, formatEuros, sendEmail } from "./email.js";

/**
 * E-mails automatiques liés au cycle de vie d'une commande.
 *
 * Chaque fonction relit la commande en base : le contenu de l'e-mail ne
 * dépend jamais de données envoyées par un navigateur. Elles ne lèvent
 * jamais d'erreur : un e-mail en échec est journalisé, rien de plus.
 *
 * SHOP_EMAIL (facultatif) : adresse qui reçoit « Nouvelle commande payée ».
 */

type OrderForEmail = {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  shippingAddress: string;
  items: OrderItem[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
};

async function loadOrder(orderId: number): Promise<OrderForEmail | null> {
  const [order] = await db
    .select({
      orderNumber: orders.orderNumber,
      customerName: orders.customerName,
      customerEmail: orders.customerEmail,
      shippingAddress: orders.shippingAddress,
      items: orders.items,
      subtotalCents: orders.subtotalCents,
      shippingCents: orders.shippingCents,
      totalCents: orders.totalCents,
      carrier: orders.carrier,
      trackingNumber: orders.trackingNumber,
      trackingUrl: orders.trackingUrl,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  return order ?? null;
}

/** Logo hébergé sur le site (les e-mails ne peuvent pas embarquer les fichiers du projet). */
const LOGO_URL = "https://fork-clothe.com/logo.png";

/** Mention imposée par CM2C (art. L641-1 du Code de la consommation), reprise mot pour mot. */
const MEDIATION_TEXT =
  "Conformément aux dispositions du Code de la consommation concernant « le processus de médiation des litiges de la consommation », après nous avoir sollicités et à défaut de réponse vous satisfaisant, vous avez la possibilité de recourir gratuitement à une procédure de médiation de la consommation auprès de :\n" +
  "CM2C – 49 rue de Ponthieu – 75008 Paris\n" +
  "Tél. : 01 89 47 00 14 · Site internet : https://www.cm2c.net/declarer-un-litige.php · Mail : litiges@cm2c.net";

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f3f1;font-family:Arial,Helvetica,sans-serif;color:#111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f1;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff">
<tr><td style="background:#ffffff;padding:20px 24px;border-bottom:3px solid #111"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:10px;vertical-align:middle"><img src="${LOGO_URL}" width="44" height="44" alt="FORK" style="display:block;border:0"></td><td style="vertical-align:middle;font-size:26px;font-weight:900;letter-spacing:2px;color:#111">FORK</td></tr></table></td></tr>
<tr><td style="padding:28px 24px 8px"><h1 style="margin:0 0 12px;font-size:20px;text-transform:uppercase;letter-spacing:1px">${escapeHtml(title)}</h1>${bodyHtml}</td></tr>
<tr><td style="padding:20px 24px 28px;font-size:12px;color:#6b6b6b;border-top:1px solid #e4e4e2">FORK · Toulon · fork-clothe.com<br>Une question ? Réponds sur WhatsApp au 07 66 75 18 40.</td></tr>
</table></td></tr></table></body></html>`;
}

function itemsTable(order: OrderForEmail): string {
  const rows = order.items
    .map(
      (item) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e2">${item.quantity} × ${escapeHtml(item.name)}<br><span style="color:#6b6b6b;font-size:13px">${escapeHtml(item.color)} · Taille ${escapeHtml(item.size)}</span></td><td align="right" style="padding:8px 0;border-bottom:1px solid #e4e4e2;white-space:nowrap">${formatEuros(item.lineTotalCents)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:16px 0">${rows}
<tr><td style="padding:8px 0 0">Sous-total</td><td align="right" style="padding:8px 0 0">${formatEuros(order.subtotalCents)}</td></tr>
<tr><td>Livraison</td><td align="right">${order.shippingCents ? formatEuros(order.shippingCents) : "Offerte"}</td></tr>
<tr><td style="padding-top:6px;font-weight:bold">Total payé</td><td align="right" style="padding-top:6px;font-weight:bold">${formatEuros(order.totalCents)}</td></tr></table>`;
}

function itemsText(order: OrderForEmail): string {
  return order.items
    .map((item) => `- ${item.quantity} × ${item.name} (${item.color}, taille ${item.size}) : ${formatEuros(item.lineTotalCents)}`)
    .join("\n");
}

function trackingBlock(order: OrderForEmail): { html: string; text: string } {
  const carrier = order.carrier ?? "Transporteur";
  const number = order.trackingNumber ?? "";
  const button = order.trackingUrl
    ? `<p style="margin:20px 0"><a href="${escapeHtml(order.trackingUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:14px 24px;font-weight:bold;text-transform:uppercase;font-size:13px;letter-spacing:1px">Suivre mon colis</a></p>`
    : "";
  return {
    html: `<p style="font-size:14px;line-height:1.6">Transporteur : <b>${escapeHtml(carrier)}</b><br>Numéro de suivi : <b>${escapeHtml(number)}</b></p>${button}`,
    text: `Transporteur : ${carrier}\nNuméro de suivi : ${number}${order.trackingUrl ? `\nSuivre mon colis : ${order.trackingUrl}` : ""}`,
  };
}

/** Confirmation de paiement au client, et notification à la boutique. */
export async function notifyOrderPaid(orderId: number): Promise<void> {
  try {
    const order = await loadOrder(orderId);
    if (!order) return;

    const html = layout(
      "Commande confirmée",
      `<p style="font-size:14px;line-height:1.6">Merci ${escapeHtml(firstName(order.customerName))} ! Ton paiement est bien reçu et ta commande <b>${escapeHtml(order.orderNumber)}</b> est confirmée.</p>
${itemsTable(order)}
<p style="font-size:14px;line-height:1.6"><b>Livraison à :</b><br>${escapeHtml(order.customerName)}<br>${escapeHtml(order.shippingAddress)}</p>
<p style="font-size:14px;line-height:1.6">On prépare ton colis. Tu recevras un e-mail avec le numéro de suivi dès l'expédition.</p>
<p style="font-size:11px;line-height:1.5;color:#6b6b6b;margin-top:24px">${escapeHtml(MEDIATION_TEXT).replace(/\n/g, "<br>")}</p>`,
    );
    const text = `Commande confirmée ${order.orderNumber}\n\nMerci ${firstName(order.customerName)} ! Ton paiement est bien reçu.\n\n${itemsText(order)}\nLivraison : ${order.shippingCents ? formatEuros(order.shippingCents) : "offerte"}\nTotal payé : ${formatEuros(order.totalCents)}\n\nLivraison à :\n${order.customerName}\n${order.shippingAddress}\n\nTu recevras le numéro de suivi dès l'expédition.\nFORK · Toulon\n\n${MEDIATION_TEXT}`;

    await sendEmail({
      to: order.customerEmail,
      subject: `FORK · Commande ${order.orderNumber} confirmée`,
      html,
      text,
      idempotencyKey: `order-paid-${order.orderNumber}`,
    });

    const shopEmail = process.env.SHOP_EMAIL?.trim();
    if (shopEmail) {
      await sendEmail({
        to: shopEmail,
        subject: `Nouvelle commande payée ${order.orderNumber} · ${formatEuros(order.totalCents)}`,
        html: layout(
          "Nouvelle commande payée",
          `<p style="font-size:14px;line-height:1.6"><b>${escapeHtml(order.orderNumber)}</b><br>${escapeHtml(order.customerName)} · ${escapeHtml(order.customerEmail)}<br>${escapeHtml(order.shippingAddress)}</p>${itemsTable(order)}`,
        ),
        text: `Nouvelle commande payée ${order.orderNumber}\n${order.customerName} · ${order.customerEmail}\n${order.shippingAddress}\n\n${itemsText(order)}\nTotal : ${formatEuros(order.totalCents)}`,
        idempotencyKey: `shop-paid-${order.orderNumber}`,
      });
    }
  } catch (error) {
    console.error("Paid notification failed", error instanceof Error ? error.message : "Unknown error");
  }
}

/** E-mail d'expédition avec transporteur, numéro et lien de suivi. */
export async function notifyOrderShipped(orderId: number): Promise<void> {
  try {
    const order = await loadOrder(orderId);
    if (!order) return;
    const tracking = trackingBlock(order);

    await sendEmail({
      to: order.customerEmail,
      subject: `FORK · Ta commande ${order.orderNumber} est expédiée`,
      html: layout(
        "Commande expédiée",
        `<p style="font-size:14px;line-height:1.6">Bonne nouvelle ${escapeHtml(firstName(order.customerName))}, ta commande <b>${escapeHtml(order.orderNumber)}</b> est partie.</p>${tracking.html}`,
      ),
      text: `Ta commande ${order.orderNumber} est expédiée.\n\n${tracking.text}\n\nFORK · Toulon`,
      idempotencyKey: `order-shipped-${order.orderNumber}`,
    });
  } catch (error) {
    console.error("Shipped notification failed", error instanceof Error ? error.message : "Unknown error");
  }
}

/** Confirmation de livraison, envoyée quand la boutique marque la commande livrée. */
export async function notifyOrderDelivered(orderId: number): Promise<void> {
  try {
    const order = await loadOrder(orderId);
    if (!order) return;

    await sendEmail({
      to: order.customerEmail,
      subject: `FORK · Commande ${order.orderNumber} livrée`,
      html: layout(
        "Commande livrée",
        `<p style="font-size:14px;line-height:1.6">Ta commande <b>${escapeHtml(order.orderNumber)}</b> est indiquée comme livrée. Merci de porter FORK ! Si quelque chose ne va pas, écris-nous sur WhatsApp.</p>
<p style="font-size:14px;line-height:1.6">Ton avis compte : dis-nous ce que tu penses de ton t-shirt, avec une photo si tu veux.</p>
<p style="margin:20px 0"><a href="${reviewLink(order.orderNumber)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 22px;font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase">Donner mon avis</a></p>`,
      ),
      text: `Ta commande ${order.orderNumber} est indiquée comme livrée. Merci de porter FORK !\n\nDonne ton avis : ${reviewLink(order.orderNumber)}\n\nFORK · Toulon`,
      idempotencyKey: `order-delivered-${order.orderNumber}`,
    });
  } catch (error) {
    console.error("Delivered notification failed", error instanceof Error ? error.message : "Unknown error");
  }
}

/** Lien qui ouvre directement le formulaire d'avis, numéro de commande prérempli. */
function reviewLink(orderNumber: string): string {
  return `https://fork-clothe.com/?avis=${encodeURIComponent(orderNumber)}`;
}

async function loadReview(reviewId: number) {
  const [review] = await db
    .select({
      sku: productReviews.productSku,
      authorName: productReviews.authorName,
      rating: productReviews.rating,
      title: productReviews.title,
      body: productReviews.body,
      shopReply: productReviews.shopReply,
      orderNumber: orders.orderNumber,
      customerName: orders.customerName,
      customerEmail: orders.customerEmail,
      items: orders.items,
    })
    .from(productReviews)
    .innerJoin(orders, eq(orders.id, productReviews.orderId))
    .where(eq(productReviews.id, reviewId))
    .limit(1);
  if (!review) return null;
  const productName = review.items.find((i) => i.sku === review.sku)?.name ?? review.sku;
  return { ...review, productName };
}

const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

/** Prévient la boutique (SHOP_EMAIL) d'un nouvel avis, pour pouvoir réagir vite à un défaut. */
export async function notifyNewReview(reviewId: number): Promise<void> {
  try {
    const shopEmail = process.env.SHOP_EMAIL?.trim();
    if (!shopEmail) return;
    const review = await loadReview(reviewId);
    if (!review) return;
    await sendEmail({
      to: shopEmail,
      subject: `FORK · Nouvel avis ${review.rating}/5 sur ${review.productName}`,
      html: layout(
        "Nouvel avis client",
        `<p style="font-size:14px;line-height:1.6"><b>${escapeHtml(review.authorName)}</b> · commande ${escapeHtml(review.orderNumber)}<br><span style="font-size:18px;color:#c8102e">${stars(review.rating)}</span></p>
${review.title ? `<p style="font-size:15px;font-weight:700;margin:0 0 6px">${escapeHtml(review.title)}</p>` : ""}
<p style="font-size:14px;line-height:1.6;white-space:pre-line">${escapeHtml(review.body)}</p>
<p style="font-size:13px;color:#6b6b6b">Tu peux y répondre ou le masquer depuis ton admin, onglet « Avis ».</p>`,
      ),
      text: `Nouvel avis ${review.rating}/5 sur ${review.productName}\n${review.authorName} · ${review.orderNumber}\n\n${review.title ?? ""}\n${review.body}`,
      idempotencyKey: `review-new-${reviewId}`,
    });
  } catch (error) {
    console.error("New review notification failed", error instanceof Error ? error.message : "Unknown error");
  }
}

/** Envoie au client la réponse publique de FORK à son avis. */
export async function notifyReviewReply(reviewId: number): Promise<void> {
  try {
    const review = await loadReview(reviewId);
    if (!review?.shopReply) return;
    await sendEmail({
      to: review.customerEmail,
      subject: `FORK a répondu à ton avis sur ${review.productName}`,
      html: layout(
        "Réponse à ton avis",
        `<p style="font-size:14px;line-height:1.6">Salut ${escapeHtml(firstName(review.customerName))}, merci pour ton avis sur <b>${escapeHtml(review.productName)}</b>. Voici notre réponse :</p>
<p style="font-size:14px;line-height:1.6;white-space:pre-line;border-left:3px solid #111;padding-left:12px">${escapeHtml(review.shopReply)}</p>
<p style="font-size:13px;color:#6b6b6b">Ta réponse et ton avis sont visibles sur la fiche du t-shirt.</p>`,
      ),
      text: `Merci pour ton avis sur ${review.productName}. Notre réponse :\n\n${review.shopReply}\n\nFORK · Toulon`,
      idempotencyKey: `review-reply-${reviewId}-${createHash("sha256").update(review.shopReply).digest("hex").slice(0, 16)}`,
    });
  } catch (error) {
    console.error("Review reply notification failed", error instanceof Error ? error.message : "Unknown error");
  }
}
