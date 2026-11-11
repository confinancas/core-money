import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { pluggyFalsoEmMemoria } from "../../../src/worker/dev/pluggy-fake-fetch";
import { startRun } from "../../../src/worker/sync/runs";
import { type ResultadoDaFatia, runSyncSlice } from "../../../src/worker/sync/slice";
import {
  AGORA,
  AMBIENTE,
  contaDeTransacoes,
  db,
  dbComFalha,
  execucao,
  HOJE,
  rodar,
  semearBanco,
} from "./importacao-helpers";

// Falha entre o INSERT e o afterIngest (TASK-0204, R6b): o módulo fica real, e o teste arma uma falha à mão. Só este
// arquivo usa o mock; o resto da suíte roda o afterIngest de verdade.
const armadas = vi.hoisted(() => ({ afterIngest: 0 }));
vi.mock("../../../src/worker/bank/after-ingest", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../src/worker/bank/after-ingest")>();
  return {
    ...real,
    afterIngest: async (...argumentos: Parameters<typeof real.afterIngest>) => {
      if (armadas.afterIngest > 0) {
        armadas.afterIngest -= 1;
        throw new Error("Network connection lost");
      }
      return real.afterIngest(...argumentos);
    },
  };
});

const BASE = pluggyFalsoEmMemoria(2);

describe("falha passageira do D1 repete a fatia (TASK-0204, R6a)", () => {
  it.each(["Network connection lost", "database is locked", "SQLITE_BUSY: database is busy"])(
    "%s na primeira escrita: a fatia repete com 300 s, não encerra; a fatia seguinte, com o D1 bom, termina repetiu",
    async (mensagem) => {
      const banco = await semearBanco();
      const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;

      const primeira = await runSyncSlice(
        AMBIENTE,
        { db: dbComFalha(() => new Error(mensagem)), fetch: BASE },
        { runId, seq: 0, tentativa: 1 },
        AGORA,
      );
      expect(primeira).toEqual({ tipo: "repete", atrasoSegundos: 300 });
      expect(await execucao(runId)).toMatchObject({ finished_at: null, retried: 1, error_code: null });

      const retomadas = await rodar(runId, BASE, 0, 2);
      expect(retomadas.at(-1)?.resultado).toEqual({ tipo: "encerrou", status: "repetiu", codigo: null });
      expect((await execucao(runId))?.status).toBe("repetiu");
    },
  );

  it("a quarta falha passageira do D1 vai a instável com banco_instavel, como o erro temporário do Pluggy", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    const atrasos: ResultadoDaFatia[] = [];
    for (const tentativa of [1, 2, 3, 4]) {
      atrasos.push(
        await runSyncSlice(
          AMBIENTE,
          { db: dbComFalha(() => new Error("Network connection lost")), fetch: BASE },
          { runId, seq: 0, tentativa },
          AGORA,
        ),
      );
    }
    expect(atrasos).toEqual([
      { tipo: "repete", atrasoSegundos: 300 },
      { tipo: "repete", atrasoSegundos: 1800 },
      { tipo: "repete", atrasoSegundos: 7200 },
      { tipo: "encerrou", status: "instavel", codigo: "banco_instavel" },
    ]);
    expect(await execucao(runId)).toMatchObject({ status: "instavel", error_code: "banco_instavel" });
  });

  it("erro de código (não é do D1) continua sendo erro_inesperado, sem repetir", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    const resultado = await runSyncSlice(
      AMBIENTE,
      { db: dbComFalha(() => new TypeError("cálculo fora da forma esperada")), fetch: BASE },
      { runId, seq: 0, tentativa: 1 },
      AGORA,
    );
    expect(resultado).toEqual({ tipo: "encerrou", status: "erro", codigo: "erro_inesperado" });
    const banco2 = await env.DB.prepare("SELECT status FROM bank_items WHERE id = ?")
      .bind(banco.itemId)
      .first<{ status: string }>();
    expect(banco2?.status).toBe("ativo");
  });
});

describe("falha entre o INSERT e o afterIngest (TASK-0204, R6b)", () => {
  it("a repetição aplica a regra do casal às linhas que a primeira tentativa inseriu sem afterIngest, e não muda a escolhida", async () => {
    const banco = await semearBanco();
    const runId = (await startRun(db(), banco.itemId, "historico", AGORA)) as string;
    // inicio (0) e faturas (1) passam; a fatia 2 é a primeira janela de transações da conta corrente (duas linhas).
    await runSyncSlice(AMBIENTE, { db: db(), fetch: BASE }, { runId, seq: 0, tentativa: 1 }, AGORA);
    await runSyncSlice(AMBIENTE, { db: db(), fetch: BASE }, { runId, seq: 1, tentativa: 1 }, AGORA);

    // A linha que o casal escolheu já existe: o id é o que o Meu Pluggy falso manda para a primeira linha da janela.
    const escolhida = `${banco.itemId}-corrente-${HOJE}-0`;
    await env.DB.prepare(
      `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, movement, occurred_at, local_date,
         amount_cents, original_description, last_seen_at, spend_type, spend_type_source)
       VALUES (?, ?, ?, ?, ?, 'compra', ?, ?, -1000, '[TEST] COMPRA ESCOLHIDA', ?, 'conforto', 'escolhido')`,
    )
      .bind(
        crypto.randomUUID(),
        banco.householdId,
        escolhida,
        banco.itemId,
        `${banco.itemId}-corrente`,
        `${HOJE}T12:00:00.000Z`,
        HOJE,
        AGORA,
      )
      .run();
    const antes = await linhaDaEscolhida(escolhida);

    // O INSERT da fatia passa e o afterIngest falha: a primeira tentativa repete.
    armadas.afterIngest = 1;
    const primeira = await runSyncSlice(
      AMBIENTE,
      { db: db(), fetch: BASE },
      { runId, seq: 2, tentativa: 1 },
      AGORA,
    );
    expect(primeira).toEqual({ tipo: "repete", atrasoSegundos: 300 });
    expect(await contaDeTransacoes(banco.itemId)).toBe(2);

    // A regra do casal para o estabelecimento da linha que a primeira tentativa inseriu. Sem afterIngest, ela não casou.
    const inserida = `${banco.itemId}-corrente-${HOJE}-1`;
    const chave = await env.DB.prepare(
      "SELECT establishment_key AS chave FROM transactions WHERE external_id = ?",
    )
      .bind(inserida)
      .first<{ chave: string }>();
    await env.DB.prepare(
      `INSERT INTO rules (id, household_id, scope, match_value, set_custom_name, set_category_id, set_spend_type, set_movement,
         created_from, created_by, created_at, disabled_at)
       VALUES (?, ?, 'estabelecimento', ?, NULL, NULL, 'conforto', NULL, 'aplicar_todas', ?, ?, NULL)`,
    )
      .bind(crypto.randomUUID(), banco.householdId, chave?.chave ?? "", banco.memberId, AGORA)
      .run();

    const retomadas = await rodar(runId, BASE, 2, 2);
    expect(retomadas.at(-1)?.resultado).toEqual({ tipo: "encerrou", status: "repetiu", codigo: null });

    // A linha inserida pela primeira tentativa recebe a regra na repetição; a escolhida pelo casal fica como ele deixou.
    expect(await linhaDaEscolhida(inserida)).toEqual(
      expect.objectContaining({ spend_type: "conforto", spend_type_source: "regra" }),
    );
    expect(await linhaDaEscolhida(escolhida)).toEqual(antes);
  });
});

type LinhaDaEscolhida = { movement: string; spend_type: string | null; spend_type_source: string | null };

async function linhaDaEscolhida(externalId: string): Promise<LinhaDaEscolhida | null> {
  return env.DB.prepare(
    "SELECT movement, spend_type, spend_type_source FROM transactions WHERE external_id = ?",
  )
    .bind(externalId)
    .first<LinhaDaEscolhida>();
}
