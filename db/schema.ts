import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
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
});

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
});