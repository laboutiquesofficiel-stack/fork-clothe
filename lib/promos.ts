import { randomBytes } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { orders, promoCodes, type OrderItem } from "../db/schema.js";
import { escapeHtml, formatEuros, sendEmail } from "./email.js";
import { layout } from "./notifications.js";
import { packPercent, type ShopSettings } from "./settings.js";

/**
 * Codes promo, pack et cartes cadeaux.
 *
 * Tout est recalculé côté serveur à la commande : le navigateur n'envoie
 * qu'un code, jamais un montant de remise.
 */

export const GIFT_CARD_SKU = "fork-carte-cadeau";
export const GIFT_CARD_AMOUNTS = [30, 50, 60] as const;
export const GIFT_CARD_VALID_DAYS = 365;

export const cleanCode = (value: unknown) =>
  typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9-]/g, "").slice(0, 30) : "";

export type CodeCheck =
  | { ok: true; kind: "percent"; code: string; percent: number }
  | { ok: true; kind: "gift"; code: string; balanceCents: number }
  | { ok: false; code: string; error: string };

/** Vérifie un code pour un e-mail donné (sans le consommer). */
export async function checkCode(rawCode: unknown, rawEmail: unknown): Promise<CodeCheck> {
  const code = cleanCode(rawCode);
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!code) return { ok: false, code, error: "Indique un code." };
  const [promo] = await db.select().from(promoCodes).where(eq(promoCodes.code, code)).limit(1);
  const now = Date.now();
  if (!promo || !promo.active) return { ok: false, code, error: "Ce code n'existe pas ou n'est plus actif." };
  if (promo.startsAt && promo.startsAt.getTime() > now) return { ok: false, code, error: "Ce code n'est pas encore utilisable." };
  if (promo.endsAt && promo.endsAt.getTime() < now) return { ok: false, code, error: "Ce code a expiré." };

  if (promo.kind === "gift") {
    const balance = promo.balanceCents ?? 0;
    if (balance <= 0) return { ok: false, code, error: "Cette carte cadeau a déjà été entièrement utilisée." };
    return { ok: true, kind: "gift", code, balanceCents: balance };
  }

  const percent = Math.min(50, Math.max(0, promo.percent ?? 0));
  if (!percent) return { ok: false, code, error: "Ce code n'est plus actif." };
  if ((promo.oncePerEmail || promo.firstOrderOnly) && !email.includes("@"))
    return { ok: false, code, error: "Indique d'abord ton e-mail : ce code est utilisable une fois par client." };
  if (promo.firstOrderOnly) {
    const [previous] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(sql`lower(${orders.customerEmail}) = ${email}`, eq(orders.paymentStatus, "paid")))
      .limit(1);
    if (previous) return { ok: false, code, error: "Ce code est réservé à une première commande." };
  }
  if (promo.oncePerEmail) {
    const [used] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(sql`lower(${orders.customerEmail}) = ${email}`, eq(orders.promoCode, code), eq(orders.paymentStatus, "paid")))
      .limit(1);
    if (used) return { ok: false, code, error: "Tu as déjà utilisé ce code." };
  }
  return { ok: true, kind: "percent", code, percent };
}

export type Pricing = {
  tshirtCount: number;
  subtotalCents: number;
  discountCents: number;
  discountLabel: string | null;
  promoCode: string | null;
  shippingCents: number;
  freeShipping: boolean;
  giftCardCode: string | null;
  giftCardCents: number;
  totalCents: number;
  /** Message à afficher sur le code saisi (refusé, ou moins avantageux que le pack). */
  codeMessage: string | null;
  codeOk: boolean;
};

/**
 * Calcule le prix final : la meilleure remise entre le pack et le code promo
 * (jamais les deux), livraison offerte dès N t-shirts, puis carte cadeau.
 */
export function priceCart(
  items: OrderItem[],
  settings: ShopSettings,
  deliveryFeeCents: number,
  code: CodeCheck | null,
): Pricing {
  const tshirts = items.filter((i) => !i.giftCard);
  const tshirtCount = tshirts.reduce((n, i) => n + i.quantity, 0);
  const tshirtCents = tshirts.reduce((n, i) => n + i.lineTotalCents, 0);
  const subtotalCents = items.reduce((n, i) => n + i.lineTotalCents, 0);

  const pack = packPercent(settings, tshirtCount);
  const codePercent = code?.ok && code.kind === "percent" && tshirtCount > 0 ? code.percent : 0;
  let discountLabel: string | null = null;
  let promoCode: string | null = null;
  let percent = 0;
  let codeMessage: string | null = code && !code.ok ? code.error : null;
  let codeOk = Boolean(code?.ok);

  if (code?.ok && code.kind === "percent" && tshirtCount === 0) {
    codeMessage = "Ce code s'applique aux t-shirts uniquement.";
    codeOk = false;
  }
  if (codePercent > pack) {
    percent = codePercent;
    promoCode = code!.code;
    discountLabel = `Code ${code!.code} (-${codePercent} %)`;
  } else if (pack > 0) {
    percent = pack;
    discountLabel = `Pack ${tshirtCount >= 3 && settings.pack.threePercent > 0 ? 3 : 2} t-shirts (-${pack} %)`;
    if (codePercent) {
      codeMessage = `Le pack (-${pack} %) est plus avantageux : ton code n'est pas utilisé, garde-le pour une prochaine commande.`;
      codeOk = false;
    }
  }
  const discountCents = Math.round((tshirtCents * percent) / 100);

  const freeShipping = tshirtCount > 0 && settings.freeShippingMin > 0 && tshirtCount >= settings.freeShippingMin;
  const shippingCents = tshirtCount === 0 || freeShipping ? 0 : Math.max(0, deliveryFeeCents);

  const due = subtotalCents - discountCents + shippingCents;
  let giftCardCode: string | null = null;
  let giftCardCents = 0;
  if (code?.ok && code.kind === "gift") {
    giftCardCode = code.code;
    giftCardCents = Math.min(code.balanceCents, due);
  }
  return {
    tshirtCount,
    subtotalCents,
    discountCents,
    discountLabel,
    promoCode,
    shippingCents,
    freeShipping,
    giftCardCode,
    giftCardCents,
    totalCents: due - giftCardCents,
    codeMessage,
    codeOk,
  };
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newGiftCode(): string {
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `FORK-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/**
 * Après le paiement d'une commande (une seule fois, appelé lors du passage
 * à « payée ») : débite la carte cadeau utilisée et crée/envoie les cartes
 * cadeaux achetées.
 */
export async function onOrderPaid(orderId: number): Promise<void> {
  try {
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) return;

    if (order.giftCardCode && order.giftCardCents > 0) {
      const debited = await db
        .update(promoCodes)
        .set({ balanceCents: sql`${promoCodes.balanceCents} - ${order.giftCardCents}` })
        .where(and(eq(promoCodes.code, order.giftCardCode), gte(promoCodes.balanceCents, order.giftCardCents)))
        .returning({ id: promoCodes.id });
      if (!debited.length) {
        console.error("Gift card balance too low at payment", order.orderNumber, order.giftCardCode);
        const shopEmail = process.env.SHOP_EMAIL?.trim();
        if (shopEmail)
          await sendEmail({
            to: shopEmail,
            subject: `FORK · Carte cadeau ${order.giftCardCode} : solde insuffisant (${order.orderNumber})`,
            html: layout("Carte cadeau à vérifier", `<p style="font-size:14px;line-height:1.6">La commande <b>${escapeHtml(order.orderNumber)}</b> a utilisé ${formatEuros(order.giftCardCents)} de la carte <b>${escapeHtml(order.giftCardCode)}</b>, mais son solde était déjà trop bas (utilisée deux fois en même temps). Vérifie dans l'admin, onglet « Promos ».</p>`),
            text: `Carte ${order.giftCardCode} : solde insuffisant pour la commande ${order.orderNumber} (${formatEuros(order.giftCardCents)}).`,
            idempotencyKey: `giftcard-low-${order.orderNumber}`,
          });
      }
    }

    const giftItems = (order.items as OrderItem[]).filter((i) => i.giftCard);
    if (!giftItems.length) return;
    const existing = await db.select({ id: promoCodes.id }).from(promoCodes).where(eq(promoCodes.giftOrderId, order.id));
    let index = 0;
    for (const item of giftItems) {
      for (let n = 0; n < item.quantity; n++, index++) {
        if (index < existing.length) continue; // déjà créée (paiement rejoué)
        const code = newGiftCode();
        const to = item.giftCard!.toEmail || order.customerEmail;
        const ends = new Date(Date.now() + GIFT_CARD_VALID_DAYS * 86400000);
        await db.insert(promoCodes).values({
          code,
          kind: "gift",
          amountCents: item.unitPriceCents,
          balanceCents: item.unitPriceCents,
          oncePerEmail: false,
          endsAt: ends,
          note: `Carte cadeau achetée par ${order.customerName} (${order.orderNumber})${item.giftCard!.toName ? ` pour ${item.giftCard!.toName}` : ""}`,
          giftOrderId: order.id,
          recipientEmail: to,
        });
        await sendGiftCard(code, item, order.customerName, to, ends, `${order.orderNumber}-${index}`);
      }
    }

    // Commande composée uniquement de cartes cadeaux : rien à expédier.
    if (giftItems.length === (order.items as OrderItem[]).length) {
      await db
        .update(orders)
        .set({ status: "delivered", shipmentStatus: "delivered", carrier: "E-mail", deliveredAt: new Date() })
        .where(eq(orders.id, order.id));
    }
  } catch (error) {
    console.error("onOrderPaid failed", orderId, error instanceof Error ? error.message : "Unknown error");
  }
}

async function sendGiftCard(code: string, item: OrderItem, buyerName: string, to: string, ends: Date, key: string) {
  const g = item.giftCard!;
  const from = buyerName.trim().split(/\s+/)[0] || buyerName;
  const until = ends.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
  const hello = g.toName ? `${escapeHtml(g.toName)}, ` : "";
  const message = g.message
    ? `<p style="font-size:15px;line-height:1.6;border-left:3px solid #111;padding:4px 0 4px 12px;font-style:italic">${escapeHtml(g.message).replace(/\n/g, "<br>")}<br><span style="font-style:normal;color:#6b6b6b">— ${escapeHtml(from)}</span></p>`
    : "";
  await sendEmail({
    to,
    subject: `${from} t'offre une carte cadeau FORK de ${formatEuros(item.unitPriceCents)}`,
    html: layout(
      "Une carte cadeau pour toi",
      `<p style="font-size:14px;line-height:1.6">${hello}<b>${escapeHtml(from)}</b> t'offre une carte cadeau FORK de <b>${formatEuros(item.unitPriceCents)}</b>, à utiliser sur fork-clothe.com.</p>
${message}
<p style="margin:20px 0;text-align:center"><span style="display:inline-block;border:2px dashed #111;padding:14px 20px;font-size:22px;font-weight:900;letter-spacing:2px">${code}</span></p>
<p style="font-size:14px;line-height:1.6">Choisis ton t-shirt, puis saisis ce code au moment de la commande, dans « Code promo ou carte cadeau ». Le montant est déduit, et ce qui reste sur la carte reste utilisable plus tard.</p>
<p style="margin:20px 0"><a href="https://fork-clothe.com/?src=carte-cadeau#produits" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:14px 24px;font-weight:bold;text-transform:uppercase;font-size:13px;letter-spacing:1px">Choisir mon t-shirt</a></p>
<p style="font-size:12px;line-height:1.6;color:#6b6b6b">Valable jusqu'au ${until}.</p>`,
    ),
    text: `${g.toName ? `${g.toName}, ` : ""}${from} t'offre une carte cadeau FORK de ${formatEuros(item.unitPriceCents)}.\n${g.message ? `\n« ${g.message} »\n` : ""}\nTon code : ${code}\nÀ saisir au moment de la commande sur https://fork-clothe.com (champ « Code promo ou carte cadeau »).\nValable jusqu'au ${until}.\n\nFORK · Toulon`,
    idempotencyKey: `giftcard-${key}`,
  });
}
