import type { Hono } from "hono";
import dadosDaMarca from "../../dev/marca.json";
import pkg from "../../package.json";
import type { BrandConfig } from "../../src/shared/brand/types";
import type { MappedTransaction } from "../../src/worker/bank/map";
import { ingestTransactions } from "../../src/worker/bank/repository";
import { criarWorker } from "../../src/worker/criar-worker";
import type { AppEnv } from "../../src/worker/env";
import { getSession } from "../../src/worker/household/context";

// Entrada da MEDIÇÃO de CPU (TASK-0104): o mesmo Worker de src/worker/index.ts, com uma rota a mais, só de medição.
// O app ainda não tem rota de importação (ela chega com a TASK-0204), e a importação de 100 transações com o pipeline
// de regras é um critério da TASK-0104. Esta rota chama o caminho de verdade (ingestTransactions, que chama o
// afterIngest, o pipeline de regras e o resto). Só o measure-cpu.mjs faz o deploy desta entrada; o app não a usa.

const BANCO_DA_MEDICAO = "cpu-banco";
const CONTA_DA_MEDICAO = "cpu-conta";
const LOJA_DA_MEDICAO = "CPU-LOJA";
const LINHAS_DA_IMPORTACAO = 100;

function rotasDeMedicao(app: Hono<AppEnv>): void {
  // POST /api/cpu/importa-100: 100 movimentos novos (ids novos a cada chamada), casando com a regra de CPU-LOJA.
  app.post("/cpu/importa-100", async (c) => {
    const { householdId } = getSession(c);
    const agora = new Date().toISOString();
    const linhas: MappedTransaction[] = Array.from({ length: LINHAS_DA_IMPORTACAO }, (_, i) => ({
      external_id: `cpu-imp-${crypto.randomUUID()}`,
      account_id: CONTA_DA_MEDICAO,
      card_id: null,
      bill_id: null,
      futura: null,
      movement: "compra",
      occurred_at: agora,
      local_date: agora.slice(0, 10),
      amount_cents: -1000 - i,
      original_description: LOJA_DA_MEDICAO,
      establishment_key: LOJA_DA_MEDICAO,
      counterparty_name: null,
      counterparty_doc_masked: null,
      counterparty_bank: null,
      installment_number: null,
      installment_total: null,
      provider_category: null,
      provider_operation_type: null,
    }));
    const resultado = await ingestTransactions(c.var.db, {
      householdId,
      bankItemId: BANCO_DA_MEDICAO,
      rows: linhas,
      now: agora,
    });
    return c.json({ inseridas: resultado.insertedIds.length }, 200);
  });
}

export default criarWorker({
  marca: dadosDaMarca as BrandConfig,
  versao: pkg.version,
  rotasDoApp: rotasDeMedicao,
});
