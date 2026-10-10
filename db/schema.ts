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
