CREATE TABLE `passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer NOT NULL,
	`transports` text,
	`device_name` text NOT NULL,
	`added_via` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "passkeys_added_via_ck" CHECK("passkeys"."added_via" IN ('cadastro', 'convite', 'aparelho', 'recuperacao'))
);
--> statement-breakpoint
CREATE INDEX `passkeys_member_idx` ON `passkeys` (`member_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`passkey_id` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`notices_seen_at` text,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`passkey_id`) REFERENCES `passkeys`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_passkey_idx` ON `sessions` (`passkey_id`);--> statement-breakpoint
CREATE INDEX `sessions_member_idx` ON `sessions` (`member_id`);--> statement-breakpoint
CREATE TABLE `webauthn_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`challenge` text NOT NULL,
	`member_id` text,
	`purpose` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT "webauthn_challenges_purpose_ck" CHECK("webauthn_challenges"."purpose" IN ('cadastro', 'login', 'convite', 'aparelho', 'recuperacao', 'reivindicar'))
);
