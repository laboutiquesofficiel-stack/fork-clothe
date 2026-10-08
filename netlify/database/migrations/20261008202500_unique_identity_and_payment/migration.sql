-- Supprime d'éventuels doublons d'identité Google (même compte Google enregistré
-- deux fois pour le même client), en gardant la ligne la plus ancienne, avant
-- de poser la contrainte d'unicité.
DELETE FROM "user_identities" a USING "user_identities" b WHERE a."provider" = b."provider" AND a."provider_account_id" = b."provider_account_id" AND a."id" > b."id";--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_provider_account_key" UNIQUE("provider","provider_account_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_payment_key" UNIQUE("provider","provider_payment_id");
