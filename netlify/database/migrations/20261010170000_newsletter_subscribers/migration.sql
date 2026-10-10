CREATE TABLE "newsletter_subscribers" (
	"id" serial PRIMARY KEY,
	"email" text NOT NULL UNIQUE,
	"status" text DEFAULT 'subscribed' NOT NULL,
	"source" text,
	"consent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unsubscribe_token" text NOT NULL UNIQUE,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
