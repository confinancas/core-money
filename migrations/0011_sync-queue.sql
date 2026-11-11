PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`bank_item_id` text NOT NULL,
	`kind` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text,
	`new_transactions` integer DEFAULT 0 NOT NULL,
	`progress_pct` integer DEFAULT 0 NOT NULL,
	`slices_total` integer DEFAULT 0 NOT NULL,
	`slices_done` integer DEFAULT 0 NOT NULL,
	`retried` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`cursor_json` text,
	`heartbeat_at` text,
	FOREIGN KEY (`bank_item_id`) REFERENCES `bank_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sync_runs_kind_ck" CHECK("__new_sync_runs"."kind" IN ('historico', 'diaria', 'manual')),
	CONSTRAINT "sync_runs_status_ck" CHECK("__new_sync_runs"."status" IS NULL OR "__new_sync_runs"."status" IN ('ok', 'instavel', 'repetiu', 'erro')),
	CONSTRAINT "sync_runs_retried_ck" CHECK("__new_sync_runs"."retried" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_sync_runs`("id", "bank_item_id", "kind", "started_at", "finished_at", "status", "new_transactions", "progress_pct", "slices_total", "slices_done", "retried", "error_code", "cursor_json", "heartbeat_at") SELECT "id", "bank_item_id", "kind", "started_at", "finished_at", "status", "new_transactions", "progress_pct", "slices_total", "slices_done", "retried", "error_code", "cursor_json", "heartbeat_at" FROM `sync_runs`;--> statement-breakpoint
DROP TABLE `sync_runs`;--> statement-breakpoint
ALTER TABLE `__new_sync_runs` RENAME TO `sync_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `sync_runs_bank_item_started_idx` ON `sync_runs` (`bank_item_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `sync_runs_open_idx` ON `sync_runs` (`bank_item_id`,`finished_at`);