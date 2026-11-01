CREATE TABLE "studio_designs" (
	"id" serial PRIMARY KEY,
	"public_id" text NOT NULL CONSTRAINT "studio_designs_public_id_key" UNIQUE,
	"design" jsonb NOT NULL,
	"tier" text NOT NULL,
	"price_cents" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"order_id" integer,
	"admin_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_images" (
	"id" serial PRIMARY KEY,
	"public_id" text NOT NULL CONSTRAINT "studio_images_public_id_key" UNIQUE,
	"key" text NOT NULL,
	"content_type" text NOT NULL,
	"data_base64" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"ai_verdict" jsonb,
	"ai_note" text,
	"visitor_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
