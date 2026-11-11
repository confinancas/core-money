ALTER TABLE `sync_runs` ADD COLUMN `slices_total` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD COLUMN `slices_done` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD COLUMN `retried` integer DEFAULT 0 NOT NULL CONSTRAINT `sync_runs_retried_ck` CHECK (`retried` IN (0, 1));--> statement-breakpoint
ALTER TABLE `sync_runs` ADD COLUMN `error_code` text;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD COLUMN `cursor_json` text;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD COLUMN `heartbeat_at` text;--> statement-breakpoint
CREATE INDEX `sync_runs_open_idx` ON `sync_runs` (`bank_item_id`,`finished_at`);--> statement-breakpoint
CREATE INDEX `sync_runs_open_heartbeat_idx` ON `sync_runs` (`heartbeat_at`) WHERE "sync_runs"."finished_at" IS NULL;--> statement-breakpoint
CREATE INDEX `bank_items_connection_idx` ON `bank_items` (`connection_id`);--> statement-breakpoint
CREATE INDEX `transactions_no_cycle_local_date_idx` ON `transactions` (`local_date`) WHERE "transactions"."cycle_key" IS NULL AND "transactions"."removed_at" IS NULL;
