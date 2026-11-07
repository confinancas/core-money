CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`brand` text NOT NULL,
	`cycle_start_day` integer DEFAULT 11 NOT NULL,
	`pct_fixed` integer DEFAULT 35 NOT NULL,
	`pct_comfort` integer DEFAULT 10 NOT NULL,
	`pct_education` integer DEFAULT 5 NOT NULL,
	`pct_extras` integer DEFAULT 5 NOT NULL,
	`pct_goals` integer DEFAULT 10 NOT NULL,
	`pct_pleasures` integer DEFAULT 10 NOT NULL,
	`paid_plan` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "households_brand_ck" CHECK("households"."brand" IN ('matrimoney', 'meumoney')),
	CONSTRAINT "households_cycle_start_day_ck" CHECK("households"."cycle_start_day" BETWEEN 1 AND 28),
	CONSTRAINT "households_pct_fixed_ck" CHECK("households"."pct_fixed" BETWEEN 0 AND 100),
	CONSTRAINT "households_pct_comfort_ck" CHECK("households"."pct_comfort" BETWEEN 0 AND 100),
	CONSTRAINT "households_pct_education_ck" CHECK("households"."pct_education" BETWEEN 0 AND 100),
	CONSTRAINT "households_pct_extras_ck" CHECK("households"."pct_extras" BETWEEN 0 AND 100),
	CONSTRAINT "households_pct_goals_ck" CHECK("households"."pct_goals" BETWEEN 0 AND 100),
	CONSTRAINT "households_pct_pleasures_ck" CHECK("households"."pct_pleasures" BETWEEN 0 AND 100),
	CONSTRAINT "households_pct_sum_ck" CHECK("households"."pct_fixed" + "households"."pct_comfort" + "households"."pct_education" + "households"."pct_extras" + "households"."pct_goals" + "households"."pct_pleasures" <= 100)
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "members_role_ck" CHECK("members"."role" IN ('titular', 'conjuge'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_household_role_uq` ON `members` (`household_id`,`role`);