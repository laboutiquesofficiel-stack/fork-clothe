ALTER TABLE "orders" ADD COLUMN "discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_label" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "promo_code" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gift_card_code" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gift_card_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "is_gift" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gift_message" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "source" text;--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" serial PRIMARY KEY,
	"code" text NOT NULL CONSTRAINT "promo_codes_code_key" UNIQUE,
	"kind" text DEFAULT 'percent' NOT NULL,
	"percent" integer,
	"amount_cents" integer,
	"balance_cents" integer,
	"first_order_only" boolean DEFAULT false NOT NULL,
	"once_per_email" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"note" text,
	"gift_order_id" integer,
	"recipient_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "site_settings" (
	"key" text PRIMARY KEY,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "promo_codes" ("code", "kind", "percent", "first_order_only", "once_per_email", "note") VALUES
	('BIENVENUE10', 'percent', 10, true, true, 'Fenêtre d''inscription : -10 % sur la première commande'),
	('REVIENS10', 'percent', 10, false, true, 'Cartes FORK (colis et marché) : -10 % une fois par client')
ON CONFLICT ("code") DO NOTHING;
