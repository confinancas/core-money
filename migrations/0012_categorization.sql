CREATE TABLE `categorization_queue` (
	`transaction_id` text PRIMARY KEY NOT NULL,
	`enqueued_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `categorization_queue_attempts_idx` ON `categorization_queue` (`attempts`,`enqueued_at`);
--> statement-breakpoint
UPDATE `transactions` SET `is_backfill` = 1 WHERE `cycle_key` IS NOT NULL AND `cycle_key` < (SELECT `c`.`key` FROM `cycles` AS `c` WHERE `c`.`household_id` = `transactions`.`household_id` AND `c`.`ends_on` < date('now', '-3 hours') ORDER BY `c`.`starts_on` DESC LIMIT 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `categorization_queue` (`transaction_id`, `enqueued_at`, `attempts`, `last_error`) SELECT `t`.`id`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, NULL FROM `transactions` AS `t` WHERE `t`.`removed_at` IS NULL AND ((`t`.`category_id` IS NULL AND `t`.`ai_category_id` IS NULL AND (`t`.`movement` IN ('compra', 'estorno', 'pix_enviado', 'ted_enviada', 'debito', 'boleto') OR (`t`.`movement` = 'outro' AND `t`.`amount_cents` < 0))) OR (`t`.`movement` IN ('pix_recebido', 'ted_recebida', 'outro') AND `t`.`amount_cents` > 0 AND `t`.`income_kind` IS NULL AND `t`.`ai_income_kind` IS NULL));
