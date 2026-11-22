import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/worker/app";
import type { Env } from "../../../src/worker/env";
import { callApi, semearPronto } from "../helpers/app";
import { COOKIE_DE_SESSAO_DE_TESTE, semearLar, semearSessao } from "../helpers/sessao";

// Rotas de medição por etapa da fatia (TASK-0208): a cadeia roda em ordem por rodada e cada etapa responde 409
// "etapa_ja_rodou" na repetição. Sem DEV_ROUTES = "1" as rotas não existem (404).
const ambiente = { ...env, DEV_ROUTES: "1" } as unknown as Env;
const RODADA = 1;
const LINHAS = 5;

async function sessaoDeTeste(): Promise<Record<string, string>> {
  await semearPronto(env.DB);
  const lar = await semearLar(env.DB);
  await semearSessao(env.DB, { memberId: lar.memberId, passkeyId: lar.passkeyId });
  return { cookie: COOKIE_DE_SESSAO_DE_TESTE };
}

const chamar = (path: string, corpo: unknown, cabecalhos: Record<string, string>, amb: Env = ambiente) =>
  callApi(createApp(), "POST", `/api/dev/sync-slice/${path}`, corpo, cabecalhos, amb);

describe("medição por etapa da fatia (TASK-0208)", () => {
  it("a cadeia roda em ordem: preparo, etapas e fatia inteira, cada uma com 200", async () => {
    const cabecalhos = await sessaoDeTeste();
    const corpo = { rodada: RODADA, rows: LINHAS };

    expect((await chamar("preparo", corpo, cabecalhos)).status).toBe(200);
    for (const etapa of ["cabecalho", "leitura", "gravacao", "classificacao", "ciclo", "pipeline", "tipos"]) {
      const resposta = await chamar(etapa, corpo, cabecalhos);
      expect(resposta.status, etapa).toBe(200);
    }
    const ids = await chamar("ids", corpo, cabecalhos);
    expect(await ids.json()).toMatchObject({ ids: LINHAS });
    expect((await chamar("completa-gravacao", corpo, cabecalhos)).status).toBe(200);
    expect((await chamar("completa-pos", corpo, cabecalhos)).status).toBe(200);
  });

  it('a rodada em texto ("2", como o medidor troca {i}) vale o mesmo que o número', async () => {
    const cabecalhos = await sessaoDeTeste();
    const resposta = await chamar("preparo", { rodada: "7", rows: LINHAS }, cabecalhos);
    expect(resposta.status).toBe(200);
    const existe = await env.DB.prepare("SELECT id FROM bank_items WHERE id = 'medicao-5-7'").first();
    expect(existe).not.toBeNull();
  });

  it("a gravação põe as linhas da rodada no banco", async () => {
    const cabecalhos = await sessaoDeTeste();
    const corpo = { rodada: 2, rows: LINHAS };
    await chamar("preparo", corpo, cabecalhos);
    const gravacao = await chamar("gravacao", corpo, cabecalhos);
    expect(await gravacao.json()).toMatchObject({ inseridas: LINHAS });
    const total = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM transactions t JOIN bank_items b ON b.id = t.bank_item_id WHERE b.id = 'medicao-5-2'",
    ).first<{ n: number }>();
    expect(total?.n).toBe(LINHAS);
  });

  it.each(["cabecalho", "leitura", "gravacao", "classificacao", "ciclo", "pipeline", "tipos"])(
    "%s: na repetição da rodada responde 409 etapa_ja_rodou sem refazer",
    async (etapa) => {
      const cabecalhos = await sessaoDeTeste();
      const corpo = { rodada: 3, rows: LINHAS };
      await chamar("preparo", corpo, cabecalhos);
      expect((await chamar(etapa, corpo, cabecalhos)).status).toBe(200);
      const repetida = await chamar(etapa, corpo, cabecalhos);
      expect(repetida.status).toBe(409);
      expect(await repetida.json()).toMatchObject({ error: "etapa_ja_rodou" });
    },
  );

  it.each(["completa-gravacao", "completa-pos"])(
    "%s: na repetição responde 409 etapa_ja_rodou",
    async (rota) => {
      const cabecalhos = await sessaoDeTeste();
      const corpo = { rodada: 4, rows: LINHAS };
      await chamar("preparo", corpo, cabecalhos);
      await chamar("completa-gravacao", corpo, cabecalhos);
      if (rota === "completa-pos") expect((await chamar("completa-pos", corpo, cabecalhos)).status).toBe(200);
      const repetida = await chamar(rota, corpo, cabecalhos);
      expect(repetida.status).toBe(409);
      expect(await repetida.json()).toMatchObject({ error: "etapa_ja_rodou" });
    },
  );

  it("completa-pos antes da gravação responde 409 mensagem_anterior_ausente, e cada mensagem faz o que é dela", async () => {
    const cabecalhos = await sessaoDeTeste();
    const corpo = { rodada: 8, rows: LINHAS };
    await chamar("preparo", corpo, cabecalhos);
    const cedo = await chamar("completa-pos", corpo, cabecalhos);
    expect(cedo.status).toBe(409);
    expect(await cedo.json()).toMatchObject({ error: "mensagem_anterior_ausente" });

    await chamar("completa-gravacao", corpo, cabecalhos);
    const fila = async () =>
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM categorization_queue").first<{ n: number }>())?.n ?? 0;
    expect(await fila()).toBe(0);
    await chamar("completa-pos", corpo, cabecalhos);
    expect(await fila()).toBeGreaterThan(0);
  });

  it("etapa sem preparo da rodada responde 404 preparo_ausente", async () => {
    const cabecalhos = await sessaoDeTeste();
    const resposta = await chamar("gravacao", { rodada: 99, rows: LINHAS }, cabecalhos);
    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toMatchObject({ error: "preparo_ausente" });
  });

  it("o preparo repetido responde 409 preparo_existente", async () => {
    const cabecalhos = await sessaoDeTeste();
    const corpo = { rodada: 5, rows: LINHAS };
    expect((await chamar("preparo", corpo, cabecalhos)).status).toBe(200);
    const repetido = await chamar("preparo", corpo, cabecalhos);
    expect(repetido.status).toBe(409);
    expect(await repetido.json()).toMatchObject({ error: "preparo_existente" });
  });

  it('com DEV_ROUTES diferente de "1", a etapa responde 404 e não grava nada', async () => {
    const cabecalhos = await sessaoDeTeste();
    const desligado = { ...env, DEV_ROUTES: "0" } as unknown as Env;
    const resposta = await chamar("preparo", { rodada: 6, rows: LINHAS }, cabecalhos, desligado);
    expect(resposta.status).toBe(404);
    const contagem = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM bank_items WHERE id = 'medicao-5-6'",
    ).first<{
      n: number;
    }>();
    expect(contagem?.n).toBe(0);
  });
});
