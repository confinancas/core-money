import type { Hono } from "hono";
import dadosDaMarca from "../../dev/marca.json";
import pkg from "../../package.json";
import type { BrandConfig } from "../../src/shared/brand/types";
import type { MappedTransaction } from "../../src/worker/bank/map";
import { ingestTransactions } from "../../src/worker/bank/repository";
import { criarWorker } from "../../src/worker/criar-worker";
import type { AppEnv } from "../../src/worker/env";
import type { ClienteDaIA } from "../../src/worker/categorization/claude";
import { runCategorizationSlice } from "../../src/worker/categorization/cron";
import { getSession } from "../../src/worker/household/context";
import { newMeter } from "../../src/worker/db/metered-d1";

// Anthropic falsa para a medição da fatia (TASK-0303): responde a cada ref do lote com uma sugestão, sem rede. A chave
// é de mentira e não sai deste arquivo para a rede; o cliente de verdade nunca roda aqui.
const CHAVE_DE_MEDICAO = "sk-ant-api03-TEST-medicao-cpu";
const clienteFalsoDeLote: ClienteDaIA = {
  messages: {
    create: async (params) => {
      const conteudo = (params.messages as Array<{ content: string }>)[0]?.content ?? "{}";
      const { transacoes } = JSON.parse(conteudo) as { transacoes: Array<{ ref: string }> };
      const sugestoes = transacoes.map((t) => ({
        ref: t.ref,
        categoria: "c1",
        entrada: null,
        renda: null,
        subtipo: null,
        certeza: "media",
        motivo: "medicao",
      }));
      return {
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify({ sugestoes }) }],
        usage: { input_tokens: 4000, output_tokens: 600, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 },
      };
    },
  },
};

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

  // POST /api/cpu/categorizacao (TASK-0303): uma fatia do cron, com a Anthropic falsa e a chave da medição (sem leitura
  // do segredo: a decifragem é medida na TASK-0102). Cada rodada tira 2 lotes cheios (50 itens) da fila do lar.
  app.post("/cpu/categorizacao", async (c) => {
    getSession(c);
    const resultado = await runCategorizationSlice(c.env, {
      now: () => new Date(),
      createClient: () => clienteFalsoDeLote,
      getApiKey: async () => ({ status: "ok", value: CHAVE_DE_MEDICAO }),
      meter: newMeter(),
    });
    return c.json({ situacao: resultado.situacao, lotes: resultado.lotes, ok: resultado.ok }, 200);
  });
}

export default criarWorker({
  marca: dadosDaMarca as BrandConfig,
  versao: pkg.version,
  rotasDoApp: rotasDeMedicao,
});
