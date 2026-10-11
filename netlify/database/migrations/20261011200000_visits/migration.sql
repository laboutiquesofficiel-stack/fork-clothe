CREATE TABLE "visit_pages" (
	"id" serial PRIMARY KEY,
	"day" text NOT NULL,
	"path" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "visit_pages_day_path_key" UNIQUE("day","path")
);
--> statement-breakpoint
CREATE TABLE "visit_visitors" (
	"id" serial PRIMARY KEY,
	"day" text NOT NULL,
	"visitor" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_visitors_day_visitor_key" UNIQUE("day","visitor")
);
