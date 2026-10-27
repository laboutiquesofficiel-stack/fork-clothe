import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export type OrderItem = {
  sku: string;
  name: string;
  color: string;
  size: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  /** Carte cadeau : envoyée par e-mail après le paiement (pas d'expédition). */
  giftCard?: { toName: string; toEmail: string; message: string };
};

/**
 * Comptes clients.
 *
 * Un client peut aussi commander en invité :
 * dans ce cas orders.userId reste null.
 */
export const users = pgTable("users", {
  id: serial().primaryKey(),
  email: text().notNull().unique(),
  name: text(),
  phone: text(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Identités de connexion.
 *
 * Pour Google, on conservera l'identifiant Google (sub),
 * jamais le mot de passe Google.
 */
export const userIdentities = pgTable("user_identities", {
  id: serial().primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text().notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  // Un compte Google ne peut être rattaché qu'à un seul client FORK.
  unique("user_identities_provider_account_key").on(table.provider, table.providerAccountId),
]);

/**
 * Sessions de connexion.
 *
 * Le token sera envoyé au navigateur uniquement via
 * un cookie HttpOnly/Secure/SameSite.
 */
export const sessions = pgTable("sessions", {
  id: serial().primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Adresses enregistrées par les clients.
 */
export const userAddresses = pgTable("user_addresses", {
  id: serial().primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  label: text().default("Maison"),
  recipientName: text("recipient_name").notNull(),
  address: text().notNull(),
  phone: text(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Commandes.
 *
 * userId est nullable pour conserver le checkout invité.
 */
export const orders = pgTable("orders", {
  id: serial().primaryKey(),

  orderNumber: text("order_number").notNull().unique(),
  checkoutToken: text("checkout_token").unique(),

  userId: integer("user_id").references(() => users.id, {
    onDelete: "set null",
  }),

  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  shippingAddress: text("shipping_address").notNull(),

  items: jsonb().$type<OrderItem[]>().notNull(),
  itemCount: integer("item_count").notNull(),

  subtotalCents: integer("subtotal_cents").notNull().default(0),
  shippingCents: integer("shipping_cents").notNull().default(0),

  deliveryZone: text("delivery_zone").notNull().default("unknown"),
  deliveryDistanceMeters: integer("delivery_distance_meters"),

  totalCents: integer("total_cents").notNull(),

  currency: text().notNull().default("EUR"),

  /**
   * État général de la commande.
   *
   * pending_payment
   * paid
   * preparing
   * shipped
   * delivered
   * cancelled
   */
  status: text().notNull().default("pending_payment"),

  /**
   * État séparé du paiement.
   */
  paymentStatus: text("payment_status")
    .notNull()
    .default("pending"),

  paymentProvider: text("payment_provider"),
  paymentReference: text("payment_reference"),

  /**
   * État de l'expédition.
   *
   * pending
   * preparing
   * shipped
   * delivered
   */
  shipmentStatus: text("shipment_status")
    .notNull()
    .default("pending"),

  carrier: text(),
  trackingNumber: text("tracking_number"),
  trackingUrl: text("tracking_url"),

  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),

  /** Remise appliquée sur les t-shirts (pack ou code promo, la meilleure des deux). */
  discountCents: integer("discount_cents").notNull().default(0),
  discountLabel: text("discount_label"),
  promoCode: text("promo_code"),
  /** Carte cadeau utilisée pour payer une partie (ou la totalité) de la commande. */
  giftCardCode: text("gift_card_code"),
  giftCardCents: integer("gift_card_cents").notNull().default(0),
  /** Commande à offrir : mot manuscrit glissé dans le colis. */
  isGift: boolean("is_gift").notNull().default(false),
  giftMessage: text("gift_message"),
  /** Provenance du client (?src= du lien : bio, carte, pub…). */
  source: text(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Paiements.
 *
 * Aucun numéro de carte ni donnée bancaire brute n'est stocké ici.
 * On conservera uniquement les références fournies par le prestataire.
 */
export const payments = pgTable("payments", {
  id: serial().primaryKey(),

  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),

  provider: text().notNull(),
  providerPaymentId: text("provider_payment_id"),

  amountCents: integer("amount_cents").notNull(),
  currency: text().notNull().default("EUR"),

  status: text().notNull().default("pending"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  // Un même checkout SumUp n'est enregistré qu'une fois, même si le webhook est rejoué.
  unique("payments_provider_payment_key").on(table.provider, table.providerPaymentId),
]);
/**
 * Avis clients.
 *
 * Seul un acheteur vérifié peut déposer un avis : la commande doit contenir
 * le t-shirt et avoir été expédiée ou livrée. Un seul avis par t-shirt et
 * par commande. L'avis est publié immédiatement ; la boutique peut le
 * masquer (contenu injurieux, hors sujet, données personnelles) et y
 * répondre publiquement.
 *
 * status : published | hidden
 */
export const productReviews = pgTable("product_reviews", {
  id: serial().primaryKey(),
  productSku: text("product_sku").notNull(),
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  authorName: text("author_name").notNull(),
  size: text(),
  rating: integer().notNull(),
  title: text(),
  body: text().notNull(),
  status: text().notNull().default("published"),
  shopReply: text("shop_reply"),
  shopRepliedAt: timestamp("shop_replied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  unique("product_reviews_order_sku_key").on(table.orderId, table.productSku),
]);

/**
 * Photos jointes à un avis (3 maximum), redimensionnées dans le navigateur
 * avant l'envoi et stockées en base64.
 */
export const reviewPhotos = pgTable("review_photos", {
  id: serial().primaryKey(),
  reviewId: integer("review_id")
    .notNull()
    .references(() => productReviews.id, { onDelete: "cascade" }),
  position: integer().notNull().default(0),
  contentType: text("content_type").notNull(),
  dataBase64: text("data_base64").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Inscrits « Préviens-moi de la prochaine collection ».
 *
 * Consentement explicite (case cochée), date et provenance conservées comme
 * preuve. Chaque e-mail contient un lien de désinscription en un clic
 * (unsubscribeToken). status : subscribed | unsubscribed
 */
export const newsletterSubscribers = pgTable("newsletter_subscribers", {
  id: serial().primaryKey(),
  email: text().notNull().unique(),
  status: text().notNull().default("subscribed"),
  source: text(),
  consentAt: timestamp("consent_at", { withTimezone: true }).notNull().defaultNow(),
  unsubscribeToken: text("unsubscribe_token").notNull().unique(),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Annonces automatiques des nouveautés aux inscrits.
 *
 * announced_products : articles déjà annoncés (ou présents avant la mise en
 * place des annonces) ; un nouvel article absent de cette table déclenche
 * une campagne. announcement_campaigns : un envoi groupé, repris là où il
 * s'est arrêté grâce à lastSubscriberId, jusqu'à completedAt.
 */
export const announcedProducts = pgTable("announced_products", {
  sku: text().primaryKey(),
  campaignId: integer("campaign_id"),
  announcedAt: timestamp("announced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const announcementCampaigns = pgTable("announcement_campaigns", {
  id: serial().primaryKey(),
  items: jsonb().$type<{ sku: string; type: string; name: string; color: string; priceCents: number; image: string; url: string }[]>().notNull(),
  lastSubscriberId: integer("last_subscriber_id").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/**
 * Stock par t-shirt et par taille.
 *
 * Une taille sans ligne ici n'est pas suivie (vente sans limite) : le suivi
 * commence dès le premier comptage dans l'admin.
 */
export const stockLevels = pgTable("stock_levels", {
  id: serial().primaryKey(),
  sku: text().notNull(),
  size: text().notNull(),
  quantity: integer().notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("stock_levels_sku_size_key").on(table.sku, table.size),
]);

/**
 * Historique des mouvements de stock.
 *
 * reason : order (vente en ligne payée) | order_cancel (commande annulée,
 * pièces remises en stock) | market (vente sur place) | count (inventaire)
 * | adjust (correction manuelle).
 */
export const stockMovements = pgTable("stock_movements", {
  id: serial().primaryKey(),
  sku: text().notNull(),
  size: text().notNull(),
  delta: integer().notNull(),
  quantityAfter: integer("quantity_after"),
  reason: text().notNull(),
  reference: text(),
  note: text(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Mesure d'audience maison, sans cookie.
 *
 * visit_pages : pages vues par jour (jour au format AAAA-MM-JJ, heure de Paris).
 * visit_visitors : un visiteur par jour, identifié par une empreinte anonyme
 * recalculée chaque jour (impossible de suivre quelqu'un d'un jour à l'autre),
 * avec la provenance de sa première visite du jour (Google, Instagram, direct…).
 */
export const visitPages = pgTable("visit_pages", {
  id: serial().primaryKey(),
  day: text().notNull(),
  path: text().notNull(),
  views: integer().notNull().default(0),
}, (table) => [
  unique("visit_pages_day_path_key").on(table.day, table.path),
]);

export const visitVisitors = pgTable("visit_visitors", {
  id: serial().primaryKey(),
  day: text().notNull(),
  visitor: text().notNull(),
  source: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("visit_visitors_day_visitor_key").on(table.day, table.visitor),
]);

/**
 * « Vos moments » : photos partagées par les clients avec leur t-shirt FORK.
 *
 * status : published (en ligne) | pending (à valider dans l'admin) | hidden (masquée).
 * Chaque photo est vérifiée par l'IA avant publication (t-shirt FORK visible,
 * photo correcte) ; aiVerdict garde le détail de cette vérification.
 * L'e-mail n'est jamais affiché : il sert à prévenir la personne et à traiter
 * une demande de retrait.
 */
export const moments = pgTable("moments", {
  id: serial().primaryKey(),
  status: text().notNull().default("pending"),
  firstName: text("first_name").notNull(),
  place: text(),
  productSku: text("product_sku"),
  email: text().notNull(),
  contentType: text("content_type").notNull(),
  dataBase64: text("data_base64").notNull(),
  aiVerdict: jsonb("ai_verdict").$type<Record<string, unknown>>(),
  aiNote: text("ai_note"),
  visitorHash: text("visitor_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

/**
 * Codes promo et cartes cadeaux.
 *
 * kind « percent » : -percent % sur les t-shirts (pas cumulable avec le pack,
 * la meilleure remise s'applique). Utilisable une fois par e-mail
 * (oncePerEmail) et éventuellement réservé à une première commande.
 * kind « gift » : carte cadeau à montant ; balanceCents diminue à chaque
 * commande payée. Créée automatiquement au paiement d'une carte cadeau.
 */
export const promoCodes = pgTable("promo_codes", {
  id: serial().primaryKey(),
  code: text().notNull().unique(),
  kind: text().notNull().default("percent"),
  percent: integer(),
  amountCents: integer("amount_cents"),
  balanceCents: integer("balance_cents"),
  firstOrderOnly: boolean("first_order_only").notNull().default(false),
  oncePerEmail: boolean("once_per_email").notNull().default(true),
  active: boolean().notNull().default(true),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  note: text(),
  giftOrderId: integer("gift_order_id"),
  recipientEmail: text("recipient_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Réglages modifiables depuis l'admin (bandeau, pack, livraison offerte, fenêtre -10 %). */
export const siteSettings = pgTable("site_settings", {
  key: text().primaryKey(),
  value: jsonb().$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
