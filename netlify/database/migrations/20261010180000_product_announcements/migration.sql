CREATE TABLE "announced_products" (
	"sku" text PRIMARY KEY,
	"campaign_id" integer,
	"announced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcement_campaigns" (
	"id" serial PRIMARY KEY,
	"items" jsonb NOT NULL,
	"last_subscriber_id" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
-- Articles déjà en vente avant la mise en place des annonces : jamais annoncés.
INSERT INTO "announced_products" ("sku") VALUES ('fork-authentique'), ('fork-lou-faron'), ('fork-les-boutades'), ('fork-les-minots') ON CONFLICT DO NOTHING;
