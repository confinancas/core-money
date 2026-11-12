import { expect, test } from "@playwright/test";
import { executaSql } from "./helpers/db";
import { semeiaSessaoDaInstalacaoPronta, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta } from "./helpers/setup";

// Sincronização (TASK-0205), na instalação pronta. Uma atualização com sucesso, simulada no banco, aparece em
// Configurações como "Última: hoje às HH:MM" (hora de São Paulo). As três larguras são os projetos do Playwright.
// Dados [TEST]; só as linhas deste arquivo entram na limpeza.
const CONEXAO = "00000000-0000-4000-8000-0000000005c1";
const BANCO = "00000000-0000-4000-8000-0000000005b1";
const LIMPEZA = [
  `DELETE FROM sync_runs WHERE bank_item_id = '${BANCO}'`,
  `DELETE FROM bank_items WHERE id = '${BANCO}'`,
  `DELETE FROM pluggy_connections WHERE id = '${CONEXAO}'`,
].join("; ");

const horaDeSaoPaulo = (instante: Date): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instante);

test.beforeEach(() => {
  semearInstalacaoPronta();
  semeiaSessaoDaInstalacaoPronta();
  executaSql("pronta", LIMPEZA);
});

test.afterAll(() => {
  executaSql("pronta", LIMPEZA);
});

test("Configurações mostra a última atualização com sucesso como 'Última: hoje às HH:MM'", async ({ page }) => {
  test.setTimeout(120_000);
  const agora = new Date();
  const instante = agora.toISOString();
  executaSql(
    "pronta",
    [
      `INSERT INTO pluggy_connections (id, household_id, label, cpf_masked, client_id_enc, iv, client_secret_enc, client_secret_iv, created_at)
       VALUES ('${CONEXAO}', (SELECT id FROM households LIMIT 1), '[TEST] Sincronização 0205', NULL, NULL, NULL, NULL, NULL, '${instante}')`,
      `INSERT INTO bank_items (id, connection_id, institution_name, institution_color, consent_expires_at, last_sync_at, status, disconnected_at, created_at)
       VALUES ('${BANCO}', '${CONEXAO}', '[TEST] Banco 0205', NULL, NULL, '${instante}', 'ativo', NULL, '${instante}')`,
    ].join("; "),
  );

  await signUpAndSignIn(page);
  await page.goto("/configuracoes");
  await expect(page.getByText(`Última: hoje às ${horaDeSaoPaulo(agora)}`)).toBeVisible();
});
