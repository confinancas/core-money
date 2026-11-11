CREATE TABLE `fixed_income_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`fixed_income_id` text NOT NULL,
	`cycle_key` text NOT NULL,
	`transaction_id` text,
	`amount_cents` integer NOT NULL,
	`received_on` text NOT NULL,
	`fx_rate` integer,
	`fx_date` text,
	`confirmed_by` text NOT NULL,
	FOREIGN KEY (`fixed_income_id`) REFERENCES `fixed_incomes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fixed_income_receipts_amount_ck" CHECK("fixed_income_receipts"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fixed_income_receipts_transaction_uq` ON `fixed_income_receipts` (`transaction_id`) WHERE "fixed_income_receipts"."transaction_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `fixed_income_receipts_income_cycle_idx` ON `fixed_income_receipts` (`fixed_income_id`,`cycle_key`);--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`currency` text NOT NULL,
	`date` text NOT NULL,
	`rate` integer NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`currency`, `date`),
	CONSTRAINT "fx_rates_rate_ck" CHECK("fx_rates"."rate" > 0)
);
