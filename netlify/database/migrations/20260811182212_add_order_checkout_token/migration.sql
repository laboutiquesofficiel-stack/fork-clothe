ALTER TABLE "orders" ADD COLUMN "checkout_token" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_checkout_token_key" UNIQUE("checkout_token");