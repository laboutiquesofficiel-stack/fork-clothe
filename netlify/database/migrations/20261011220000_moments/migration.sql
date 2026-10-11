CREATE TABLE "moments" (
	"id" serial PRIMARY KEY,
	"status" text DEFAULT 'pending' NOT NULL,
	"first_name" text NOT NULL,
	"place" text,
	"product_sku" text,
	"email" text NOT NULL,
	"content_type" text NOT NULL,
	"data_base64" text NOT NULL,
	"ai_verdict" jsonb,
	"ai_note" text,
	"visitor_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
