CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`bank_item_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`balance_cents` integer NOT NULL,
	`overdraft_used_cents` integer DEFAULT 0 NOT NULL,
	`balance_at` text NOT NULL,
	FOREIGN KEY (`bank_item_id`) REFERENCES `bank_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "accounts_kind_ck" CHECK("accounts"."kind" IN ('corrente', 'caixinha', 'poupanca', 'outra'))
);
--> statement-breakpoint
CREATE INDEX `accounts_bank_item_idx` ON `accounts` (`bank_item_id`);--> statement-breakpoint
CREATE TABLE `bank_items` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`institution_name` text NOT NULL,
	`institution_color` text,
	`consent_expires_at` text,
	`last_sync_at` text,
	`status` text DEFAULT 'ativo' NOT NULL,
	`disconnected_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `pluggy_connections`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bank_items_status_ck" CHECK("bank_items"."status" IN ('ativo', 'instavel', 'acao_necessaria'))
);
--> statement-breakpoint
CREATE TABLE `bills` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`closes_on` text NOT NULL,
	`due_on` text,
	`amount_cents` integer,
	`status` text NOT NULL,
	`paid_on` text,
	`cycle_key` text,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bills_status_ck" CHECK("bills"."status" IN ('aberta', 'fechada', 'paga', 'futura'))
);
--> statement-breakpoint
CREATE INDEX `bills_card_closes_idx` ON `bills` (`card_id`,`closes_on`);--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`bank_item_id` text NOT NULL,
	`last4` text NOT NULL,
	`name` text NOT NULL,
	`limit_cents` integer,
	`available_cents` integer,
	`best_day` integer,
	FOREIGN KEY (`bank_item_id`) REFERENCES `bank_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pluggy_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`label` text NOT NULL,
	`cpf_masked` text,
	`client_id_enc` text,
	`iv` text,
	`client_secret_enc` text,
	`client_secret_iv` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pluggy_connections_household_label_uq` ON `pluggy_connections` (`household_id`,`label`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`bank_item_id` text NOT NULL,
	`kind` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text,
	`new_transactions` integer DEFAULT 0 NOT NULL,
	`progress_pct` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`bank_item_id`) REFERENCES `bank_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sync_runs_kind_ck" CHECK("sync_runs"."kind" IN ('historico', 'diaria', 'manual')),
	CONSTRAINT "sync_runs_status_ck" CHECK("sync_runs"."status" IS NULL OR "sync_runs"."status" IN ('ok', 'instavel', 'repetiu', 'erro'))
);
--> statement-breakpoint
CREATE INDEX `sync_runs_bank_item_started_idx` ON `sync_runs` (`bank_item_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`external_id` text NOT NULL,
	`bank_item_id` text NOT NULL,
	`account_id` text,
	`card_id` text,
	`bill_id` text,
	`movement` text NOT NULL,
	`movement_original` text,
	`movement_locked` integer DEFAULT 0 NOT NULL,
	`occurred_at` text NOT NULL,
	`local_date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`original_description` text NOT NULL,
	`establishment_key` text,
	`custom_name` text,
	`counterparty_name` text,
	`counterparty_doc_masked` text,
	`counterparty_bank` text,
	`pix_key_masked` text,
	`installment_number` integer,
	`installment_total` integer,
	`cycle_key` text,
	`category_id` text,
	`spend_type` text,
	`spend_type_source` text,
	`hidden` integer DEFAULT 0 NOT NULL,
	`hidden_reason` text,
	`income_kind` text,
	`income_subtype` text,
	`fixed_income_id` text,
	`card_would_accept` integer,
	`ai_category_id` text,
	`ai_income_kind` text,
	`ai_income_subtype` text,
	`ai_fixed_income_id` text,
	`ai_confidence` text,
	`ai_reason` text,
	`categorized_at` text,
	`categorized_by` text,
	`rule_id` text,
	`fixed_bill_id` text,
	`is_backfill` integer DEFAULT 0 NOT NULL,
	`provider_category` text,
	`provider_operation_type` text,
	`last_seen_at` text NOT NULL,
	`removed_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_item_id`) REFERENCES `bank_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transactions_movement_ck" CHECK("transactions"."movement" IN ('compra', 'estorno', 'pix_enviado', 'pix_recebido', 'ted_enviada', 'ted_recebida', 'pagamento_fatura', 'transferencia_interna', 'rendimento', 'debito', 'boleto', 'outro')),
	CONSTRAINT "transactions_account_xor_card_ck" CHECK(("transactions"."account_id" IS NULL) <> ("transactions"."card_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_bank_item_external_uq` ON `transactions` (`bank_item_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `transactions_household_cycle_idx` ON `transactions` (`household_id`,`cycle_key`);--> statement-breakpoint
CREATE INDEX `transactions_household_category_cycle_idx` ON `transactions` (`household_id`,`category_id`,`cycle_key`);--> statement-breakpoint
CREATE INDEX `transactions_household_categorized_idx` ON `transactions` (`household_id`,`categorized_at`);--> statement-breakpoint
CREATE INDEX `transactions_household_local_date_idx` ON `transactions` (`household_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `transactions_account_local_date_idx` ON `transactions` (`account_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `transactions_card_local_date_idx` ON `transactions` (`card_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `transactions_card_bill_idx` ON `transactions` (`card_id`,`bill_id`);--> statement-breakpoint
CREATE INDEX `transactions_bill_idx` ON `transactions` (`bill_id`);--> statement-breakpoint
CREATE INDEX `transactions_household_establishment_idx` ON `transactions` (`household_id`,`establishment_key`);--> statement-breakpoint
CREATE INDEX `transactions_household_fixed_bill_cycle_idx` ON `transactions` (`household_id`,`fixed_bill_id`,`cycle_key`);