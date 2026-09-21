ALTER TABLE "orders" ADD COLUMN "subtotal_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_zone" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_distance_meters" integer;