CREATE TABLE `usage_daily` (
	`day` text PRIMARY KEY NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`rows_read` integer DEFAULT 0 NOT NULL,
	`rows_written` integer DEFAULT 0 NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL
);
