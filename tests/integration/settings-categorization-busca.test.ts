import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/worker/app";
import { aquecerOPortao, callApi, semearPronto } from "./helpers/app";
import { criarLar, criarRegra } from "./helpers/regras";

// F4 (TASK-0305, rodada 1): a busca acha nome com acento, com ou sem acento, e com símbolo no lugar do espaço. A chave
// guardada pode ter letra acentuada em minúscula (o UPPER do SQLite não a muda), como "JOãO CONCEIçãO".

beforeEach(async () => {
  await semearPronto(env.DB);
  await aquecerOPortao(createApp({}));
});

describe("F4: busca de regras sem acento", () => {
  it("acha 'JOÃO CONCEIÇÃO' com acento, sem acento, em maiúsculas e pelo sobrenome", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "destinatario",
      matchValue: "[TEST] JOãO CONCEIçãO|***",
      createdFrom: "confirmacao",
    });
    const app = createApp({ resolveSession: async () => lar });
    const total = async (busca: string) =>
      (
        (await (await callApi(app, "GET", `/api/rules?busca=${encodeURIComponent(busca)}`)).json()) as {
          total: number;
        }
      ).total;
    expect(await total("joão")).toBe(1);
    expect(await total("joao")).toBe(1);
    expect(await total("JOÃO")).toBe(1);
    expect(await total("conceição")).toBe(1);
    expect(await total("xyz-nao-existe")).toBe(0);
  });

  it("'pag*jose' acha 'PAG JOSEDASILVA'", async () => {
    const lar = await criarLar();
    await criarRegra(lar, {
      scope: "estabelecimento",
      matchValue: "PAG JOSEDASILVA",
      createdFrom: "lembrar",
    });
    const app = createApp({ resolveSession: async () => lar });
    const corpo = (await (
      await callApi(app, "GET", `/api/rules?busca=${encodeURIComponent("pag*jose")}`)
    ).json()) as {
      total: number;
    };
    expect(corpo.total).toBe(1);
  });
});
