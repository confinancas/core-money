CREATE TABLE `fixed_incomes` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`usual_day` integer NOT NULL,
	`arrival` text NOT NULL,
	`statement_text` text,
	`kept_usd_is_investment` integer DEFAULT 1 NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fixed_incomes_currency_ck" CHECK("fixed_incomes"."currency" IN ('BRL', 'USD')),
	CONSTRAINT "fixed_incomes_amount_ck" CHECK("fixed_incomes"."amount_cents" BETWEEN 1 AND 10000000000),
	CONSTRAINT "fixed_incomes_usual_day_ck" CHECK("fixed_incomes"."usual_day" BETWEEN 1 AND 31),
	CONSTRAINT "fixed_incomes_arrival_ck" CHECK("fixed_incomes"."arrival" IN ('auto', 'partes', 'manual')),
	CONSTRAINT "fixed_incomes_kept_ck" CHECK("fixed_incomes"."kept_usd_is_investment" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `fixed_incomes_household_archived_idx` ON `fixed_incomes` (`household_id`,`archived_at`);