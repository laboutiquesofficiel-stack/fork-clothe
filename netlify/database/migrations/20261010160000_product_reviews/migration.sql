CREATE TABLE "product_reviews" (
	"id" serial PRIMARY KEY,
	"product_sku" text NOT NULL,
	"order_id" integer NOT NULL,
	"user_id" integer,
	"author_name" text NOT NULL,
	"size" text,
	"rating" integer NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"shop_reply" text,
	"shop_replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_reviews_order_sku_key" UNIQUE("order_id","product_sku")
);
--> statement-breakpoint
CREATE TABLE "review_photos" (
	"id" serial PRIMARY KEY,
	"review_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"content_type" text NOT NULL,
	"data_base64" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "review_photos" ADD CONSTRAINT "review_photos_review_id_product_reviews_id_fkey" FOREIGN KEY ("review_id") REFERENCES "product_reviews"("id") ON DELETE CASCADE;
