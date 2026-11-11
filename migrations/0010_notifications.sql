CREATE TABLE `notification_prefs` (
	`household_id` text NOT NULL,
	`kind` text NOT NULL,
	`enabled` integer NOT NULL,
	PRIMARY KEY(`household_id`, `kind`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_prefs_enabled_ck" CHECK("notification_prefs"."enabled" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`link` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notifications_kind_ck" CHECK("notifications"."kind" IN ('pendencias', 'insight', 'negativo', 'meta_dia', 'vencimento', 'balanco', 'consentimento', 'pix_recebido', 'fatura_paga', 'renda_dolar', 'aviso_ia'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_household_dedupe_uq` ON `notifications` (`household_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_household_created_idx` ON `notifications` (`household_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_household_unread_idx` ON `notifications` (`household_id`) WHERE "notifications"."read_at" IS NULL;