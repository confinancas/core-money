CREATE TABLE `cycles` (
	`household_id` text NOT NULL,
	`key` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`prev_income_cents` integer,
	`spend_limit_cents` integer,
	`recurring_cents` integer,
	`daily_target_cents` integer,
	`target_computed_on` text,
	`balance_closed_at` text,
	`pct_fixed` integer,
	`pct_comfort` integer,
	`pct_education` integer,
	`pct_extras` integer,
	`pct_goals` integer,
	`pct_pleasures` integer,
	PRIMARY KEY(`household_id`, `key`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cycles_household_starts_idx` ON `cycles` (`household_id`,`starts_on`);