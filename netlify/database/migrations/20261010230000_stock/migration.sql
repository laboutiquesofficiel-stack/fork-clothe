CREATE TABLE "stock_levels" (
	"id" serial PRIMARY KEY,
	"sku" text NOT NULL,
	"size" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_levels_sku_size_key" UNIQUE("sku","size")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" serial PRIMARY KEY,
	"sku" text NOT NULL,
	"size" text NOT NULL,
	"delta" integer NOT NULL,
	"quantity_after" integer,
	"reason" text NOT NULL,
	"reference" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
