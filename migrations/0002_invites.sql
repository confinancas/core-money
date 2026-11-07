CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`member_id` text,
	`invitee_name` text,
	`invitee_email` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`expires_at` text,
	`used_at` text,
	`cancelled_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invites_kind_ck" CHECK("invites"."kind" IN ('conjuge', 'recuperacao', 'primeiro_acesso'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_uq` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invites_kind_used_idx` ON `invites` (`kind`,`used_at`);