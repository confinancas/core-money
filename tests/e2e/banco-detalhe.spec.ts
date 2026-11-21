import { expect, test } from "@playwright/test";
import { todayInSaoPaulo } from "../../src/shared/sao-paulo-date";
import { executaSql } from "./helpers/db";
import { semeiaSessaoDaInstalacaoPronta, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta } from "./helpers/setup";

// Detalhe do banco conectado (TASK-0206), nas três larguras (os projetos celular, tablet e desktop). O Meu Pluggy falso
// responde à conferência do consentimento (a validade dele é 2027-10-01); os dados são [TEST]; nenhuma chamada sai do
// ambiente de teste. A limpeza só mexe nas linhas deste arquivo.
const ROTULO = "[TEST] Conta 0206";
const ITEM_ITAU = "00000000-0000-4000-8000-0000000000a1";
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const SEGREDO = "TEST-segredo-valido-0203";
const BANCOS = `(SELECT id FROM bank_items WHERE id = '${ITEM_ITAU}' OR connection_id IN (SELECT id FROM pluggy_connections WHERE label = '${ROTULO}'))`;
const LIMPEZA = [
  `DELETE FROM transactions WHERE bank_item_id IN ${BANCOS}`,
  `DELETE FROM sync_runs WHERE bank_item_id IN ${BANCOS}`,
  `DELETE FROM accounts WHERE bank_item_id IN ${BANCOS}`,
  `DELETE FROM bills WHERE card_id IN (SELECT id FROM cards WHERE bank_item_id IN ${BANCOS})`,
  `DELETE FROM cards WHERE bank_item_id IN ${BANCOS}`,
  `DELETE FROM bank_items WHERE id IN ${BANCOS}`,
  `DELETE FROM pluggy_connections WHERE label = '${ROTULO}'`,
].join("; ");

// Data de hoje mais N dias (o dia da validade cai à meia-noite UTC, como no Pluggy). Hoje é o dia de São Paulo, como na
// tela: com o dia do UTC, das 21h à meia-noite de Brasília a tela contava um dia a mais ("Faltam 23 dias").
const diaMaisDias = (dias: number): string => {
  const data = new Date(`${todayInSaoPaulo()}T00:00:00.000Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString();
};

const diaEMesDeIso = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  semearInstalacaoPronta();
  semeiaSessaoDaInstalacaoPronta();
  executaSql("pronta", LIMPEZA);
  await signUpAndSignIn(page);
  // Conexão de verdade, com as chaves do Meu Pluggy falso: o servidor cifra e grava o banco (TASK-0203).
  const resposta = await page.request.post("/api/pluggy-connections", {
    data: {
      label: ROTULO,
      clientId: CLIENT_ID,
      clientSecret: SEGREDO,
      items: [{ itemId: ITEM_ITAU, institutionName: "[TEST] Banco 0206" }],
    },
  });
  expect(resposta.status()).toBe(201);
});

test.afterAll(() => {
  executaSql("pronta", LIMPEZA);
});

test("cenário 2: consentimento que expira em 22 dias mostra a data e 'Faltam 22 dias'", async ({ page }) => {
  const validade = diaMaisDias(22);
  executaSql("pronta", `UPDATE bank_items SET consent_expires_at = '${validade}' WHERE id = '${ITEM_ITAU}'`);
  await page.goto(`/configuracoes/bancos/${ITEM_ITAU}`);
  await expect(
    page.getByRole("heading", { name: `Consentimento expira em ${diaEMesDeIso(validade)}` }),
  ).toBeVisible();
  await expect(page.getByText("Faltam 22 dias.", { exact: false })).toBeVisible();
});

test("cenário 4: renovar abre o Meu Pluggy, e 'Já renovei · conferir' grava a validade nova", async ({
  page,
}) => {
  const validade = diaMaisDias(22);
  executaSql("pronta", `UPDATE bank_items SET consent_expires_at = '${validade}' WHERE id = '${ITEM_ITAU}'`);
  // A aba do Meu Pluggy não sai para a internet no teste.
  await page
    .context()
    .route("https://dashboard.pluggy.ai/**", (rota) =>
      rota.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>[TEST]</title>" }),
    );
  await page.goto(`/configuracoes/bancos/${ITEM_ITAU}`);
  const renovar = page.getByRole("link", { name: "Renovar por mais 12 meses" });
  await expect(renovar).toHaveAttribute("href", "https://dashboard.pluggy.ai");
  await expect(renovar).toHaveAttribute("target", "_blank");
  await renovar.click();
  await expect(page.getByRole("heading", { name: "Renovação aberta no Meu Pluggy" })).toBeVisible();
  await page.getByRole("button", { name: "Já renovei · conferir" }).click();
  await expect(page.getByText("Renovado até 10/2027.")).toBeVisible();
});

test("cenário 7: com uma falha que repetir resolve, 'Baixar agora' vira 'Baixando…' e o botão some", async ({
  page,
}) => {
  const ha = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  executaSql(
    "pronta",
    [
      // A conexão recém-criada deixa uma importação aberta: a falha de teste precisa de um banco sem execução aberta.
      `DELETE FROM sync_runs WHERE bank_item_id = '${ITEM_ITAU}'`,
      `UPDATE bank_items SET status = 'instavel' WHERE id = '${ITEM_ITAU}'`,
      `INSERT INTO sync_runs (id, bank_item_id, kind, started_at, finished_at, status, error_code, cursor_json, heartbeat_at)
       VALUES ('00000000-0000-4000-8000-0000000006a1', '${ITEM_ITAU}', 'diaria', '${ha}', '${ha}', 'instavel', 'banco_instavel', '{"seq":0,"phase":"fim"}', NULL)`,
    ].join("; "),
  );
  await page.goto(`/configuracoes/bancos/${ITEM_ITAU}`);
  await expect(page.getByText("Banco instável · tenta de novo amanhã").first()).toBeVisible();
  const botao = page.getByRole("button", { name: "Baixar agora" });
  await expect(botao).toBeVisible();
  await botao.click();
  await expect(page.getByText(/Baixando… \d+%/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Baixar agora" })).toHaveCount(0);
});

test("cenário 9: desconectar confirma dentro da tela, sem caixa do navegador, e mostra 'Desconectado em'", async ({
  page,
}) => {
  const caixas: string[] = [];
  page.on("dialog", (caixa) => {
    caixas.push(caixa.type());
    void caixa.dismiss();
  });
  await page.goto(`/configuracoes/bancos/${ITEM_ITAU}`);
  // O nome do banco vem do Meu Pluggy (o falso devolve o do conector), por isso o seletor é pelo prefixo.
  await page.getByRole("button", { name: /^Desconectar / }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByText(/^Desconectar o .+\?$/)).toBeVisible();
  await dialogo.getByRole("button", { name: "Desconectar", exact: true }).click();
  await expect(page.getByText(/Desconectado em \d{2}\/\d{2} · histórico mantido/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Conectar de novo" })).toBeVisible();
  expect(caixas).toEqual([]);
});

test("as três larguras: sem rolagem horizontal e com alvos de 44 px", async ({ page }) => {
  await page.goto(`/configuracoes/bancos/${ITEM_ITAU}`);
  await expect(page.getByRole("heading", { name: "Permissões" })).toBeVisible();
  const folga = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(folga).toBeLessThanOrEqual(0);
  const alvos = page.getByRole("link", { name: /Renovar por mais 12 meses|Voltar para Configurações/ });
  const botaoDesconectar = page.getByRole("button", { name: /^Desconectar / });
  for (const alvo of [alvos.first(), botaoDesconectar]) {
    const caixa = await alvo.boundingBox();
    expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
