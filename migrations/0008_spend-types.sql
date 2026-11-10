CREATE TABLE `automatic_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`kind` text NOT NULL,
	`match_value` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "automatic_rules_kind_ck" CHECK("automatic_rules"."kind" IN ('corretora', 'caixinha')),
	CONSTRAINT "automatic_rules_match_ck" CHECK(length("automatic_rules"."match_value") BETWEEN 3 AND 60)
);
--> statement-breakpoint
CREATE INDEX `automatic_rules_household_kind_idx` ON `automatic_rules` (`household_id`,`kind`);
--> statement-breakpoint
-- Carga inicial (TASK-0802): toda saída já gravada ganha o tipo de gasto. Herda o tipo da categoria (ou da mãe, na
-- subcategoria) e, sem categoria com tipo, Prazeres (padrão). Entradas, pagamento de fatura e transferência não têm tipo.
-- Antes desta migração o tipo não era gravado: nenhuma linha tem escolhido ou regra, e a origem fica categoria ou padrao.
UPDATE transactions AS t SET spend_type = COALESCE(COALESCE((SELECT c.default_spend_type FROM categories AS c WHERE c.id = t.category_id AND c.household_id = t.household_id AND NOT (t.card_id IS NOT NULL AND c.default_spend_type IN ('metas', 'investimentos'))), (SELECT p.default_spend_type FROM categories AS c JOIN categories AS p ON p.id = c.parent_id AND p.household_id = c.household_id WHERE c.id = t.category_id AND c.household_id = t.household_id AND NOT (t.card_id IS NOT NULL AND p.default_spend_type IN ('metas', 'investimentos')))), 'prazeres'), spend_type_source = CASE WHEN COALESCE((SELECT c.default_spend_type FROM categories AS c WHERE c.id = t.category_id AND c.household_id = t.household_id AND NOT (t.card_id IS NOT NULL AND c.default_spend_type IN ('metas', 'investimentos'))), (SELECT p.default_spend_type FROM categories AS c JOIN categories AS p ON p.id = c.parent_id AND p.household_id = c.household_id WHERE c.id = t.category_id AND c.household_id = t.household_id AND NOT (t.card_id IS NOT NULL AND p.default_spend_type IN ('metas', 'investimentos')))) IS NULL THEN 'padrao' ELSE 'categoria' END
WHERE t.spend_type IS NULL
  AND ((t.amount_cents < 0 AND t.movement IN ('compra', 'pix_enviado', 'ted_enviada', 'debito', 'boleto', 'outro'))
    OR t.movement = 'estorno');
