import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export type OrderItem = {
  sku: string;
  name: string;
  color: string;
  size: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

export const orders = pgTable("orders", {
  id: serial().primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  checkoutToken: text("checkout_token").unique(),
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
  status: text().notNull().default("pending_payment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
