import { expect, type Page, test } from "@playwright/test";
import { consultaSql, executaSql } from "./helpers/db";
import { LAR_DA_INSTALACAO_PRONTA, signUpAndSignIn } from "./helpers/sessao";

// Configurações › Categorias e IA (TASK-0305), nas três larguras (projetos celular, tablet e desktop do Playwright).
// A instância pronta é compartilhada pelas specs: cada teste põe e tira só as próprias linhas, com o sufixo "0305" e os
// ids "e2e-0305-…". Cenários 4, 5, 7, 8 e 11 da spec.

const LAR = `'${LAR_DA_INSTALACAO_PRONTA}'`;
const PRINCIPAL = "[TEST] Saúde 0305";
const ACADEMIA = "[TEST] Academia 0305";
const FARMACIA = "[TEST] Farmácia 0305";

// Limpeza do que este arquivo põe: regras e documento do lar, e as categorias com o prefixo do arquivo.
function limpaDoArquivo(): void {
  executaSql(
    "pronta",
    [
      `DELETE FROM rules WHERE household_id = ${LAR} AND match_value LIKE '%0305%'`,
      `DELETE FROM categories WHERE household_id = ${LAR} AND id LIKE 'e2e-0305-sub-%'`,
      `DELETE FROM categories WHERE household_id = ${LAR} AND id LIKE 'e2e-0305-%'`,
      `DELETE FROM ai_rules_document WHERE household_id = ${LAR}`,
    ].join("; "),
  );
}

// A semente do lar é criada na primeira leitura da lista (só com o lar vazio). Por isso a página abre primeiro, e só
// depois entram as categorias do teste.
async function preparaCategorias(page: Page): Promise<void> {
  await page.goto("/configuracoes/categorias");
  await expect(page.getByRole("link", { name: "Nova categoria", exact: true })).toBeVisible();
  executaSql(
    "pronta",
    [
      `INSERT INTO categories (id, household_id, name, color, parent_id, default_spend_type, ai_hint, sort, archived_at) VALUES ('e2e-0305-saude', ${LAR}, '${PRINCIPAL}', '#F0559A', NULL, NULL, NULL, 0, NULL)`,
      `INSERT INTO categories (id, household_id, name, color, parent_id, default_spend_type, ai_hint, sort, archived_at) VALUES ('e2e-0305-sub-academia', ${LAR}, '${ACADEMIA}', '#F0559A', 'e2e-0305-saude', NULL, NULL, 0, NULL)`,
      `INSERT INTO categories (id, household_id, name, color, parent_id, default_spend_type, ai_hint, sort, archived_at) VALUES ('e2e-0305-sub-farmacia', ${LAR}, '${FARMACIA}', '#F0559A', 'e2e-0305-saude', NULL, NULL, 0, NULL)`,
    ].join("; "),
  );
  await page.reload();
  await expect(page.getByRole("link", { name: PRINCIPAL, exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  limpaDoArquivo();
  await signUpAndSignIn(page);
});

test.afterEach(() => {
  limpaDoArquivo();
});

// Nas larguras com lista e editor lado a lado (tablet e desktop), o editor fica à direita da lista.
// No celular, o editor é a rota própria e a lista não aparece.
function ehLarguraDupla(largura: number): boolean {
  return largura >= 768;
}

test("cenário 4: renomear uma subcategoria e trocar a cor; o seletor mostra o nome novo", async ({
  page,
}) => {
  await preparaCategorias(page);
  await page.getByRole("link", { name: ACADEMIA, exact: true }).click();
  await expect(page).toHaveURL(/\/configuracoes\/categorias\/e2e-0305-sub-academia$/);

  await page.getByLabel("Nome", { exact: true }).fill("[TEST] Academia nova 0305");
  await page.getByRole("radio", { name: "Rosa", exact: true }).check({ force: true });
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  // Depois de salvar, a lista recarrega e o editor volta com o nome novo.
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("[TEST] Academia nova 0305");

  const salvo = consultaSql(
    "pronta",
    `SELECT name, color FROM categories WHERE id = 'e2e-0305-sub-academia'`,
  );
  expect(salvo[0]).toMatchObject({ name: "[TEST] Academia nova 0305" });

  await page.goto("/categorias/escolher");
  await expect(page.getByRole("radio", { name: "[TEST] Academia nova 0305", exact: true })).toBeVisible();
});

test("cenário 5: arquivar a principal leva as subcategorias; reativar a principal as devolve à lista", async ({
  page,
}, info) => {
  await preparaCategorias(page);
  await page.getByRole("link", { name: PRINCIPAL, exact: true }).click();
  await page.getByRole("button", { name: "Arquivar categoria", exact: true }).click();

  await expect(page.getByText("Arquivar [TEST] Saúde 0305? Ela some da lista de escolha")).toBeVisible();
  await expect(page.getByText("As subcategorias também serão arquivadas.")).toBeVisible();
  await page.getByRole("button", { name: "Arquivar", exact: true }).click();

  await expect(page.getByRole("button", { name: /Arquivadas \(3\)/ })).toBeVisible();
  const arquivadas = consultaSql(
    "pronta",
    `SELECT COUNT(*) AS n FROM categories WHERE id LIKE 'e2e-0305-%' AND archived_at IS NOT NULL`,
  );
  expect(arquivadas[0]).toMatchObject({ n: 3 });

  // Reativar a principal pela lista de arquivadas (no celular, a lista volta pela URL).
  await page.goto("/configuracoes/categorias");
  await page.getByRole("button", { name: /Arquivadas \(3\)/ }).click();
  await page.getByRole("link", { name: PRINCIPAL, exact: true }).click();
  await page.getByRole("button", { name: "Reativar categoria", exact: true }).click();
  await expect(page.getByRole("button", { name: "Arquivar categoria", exact: true })).toBeVisible();

  const ativa = consultaSql("pronta", `SELECT archived_at FROM categories WHERE id = 'e2e-0305-saude'`);
  expect(ativa[0]).toMatchObject({ archived_at: null });

  // Posições: lista e editor lado a lado nas larguras duplas; no celular, só o editor.
  const largura = page.viewportSize()?.width ?? info.project.use.viewport?.width ?? 390;
  if (ehLarguraDupla(largura)) {
    const linha = await page.getByRole("link", { name: PRINCIPAL, exact: true }).boundingBox();
    const nome = await page.getByLabel("Nome", { exact: true }).boundingBox();
    expect(linha).not.toBeNull();
    expect(nome).not.toBeNull();
    expect((nome?.x ?? 0) >= (linha?.x ?? 0) + (linha?.width ?? 0)).toBe(true);
  } else {
    await expect(page.getByRole("link", { name: ACADEMIA, exact: true })).toHaveCount(0);
  }
});

test("cenário 7: desfazer uma regra tira ela da lista e não mexe nas transações antigas", async ({
  page,
}) => {
  await preparaCategorias(page);
  executaSql(
    "pronta",
    `INSERT INTO rules (id, household_id, scope, match_value, set_custom_name, set_category_id, set_spend_type, set_income_kind, set_income_subtype, set_fixed_income_id, set_movement, created_from, created_by, created_at, disabled_at) VALUES ('e2e-0305-regra-1', ${LAR}, 'estabelecimento', 'PAG JOSEDASILVA 0305', '[TEST] Renomeado 0305', NULL, NULL, NULL, NULL, NULL, NULL, 'lembrar', 'e2e-pessoa-pronta', '2026-11-05T15:00:00.000Z', NULL)`,
  );
  await page.goto("/configuracoes/regras");
  const linha = page.getByText("PAG JOSEDASILVA 0305", { exact: true });
  await expect(linha).toBeVisible();

  const linhaDaRegra = page
    .locator("div")
    .filter({ has: page.getByText("PAG JOSEDASILVA 0305", { exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Desfazer", exact: true }) })
    .last();
  await linhaDaRegra.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(
    page.getByText(
      "Desfazer a regra de PAG JOSEDASILVA 0305? As próximas transações voltam para a fila Para categorizar. As que já foram continuam como estão.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Desfazer regra", exact: true }).click();

  await expect(linha).toHaveCount(0);
  const regra = consultaSql("pronta", `SELECT disabled_at FROM rules WHERE id = 'e2e-0305-regra-1'`);
  expect(regra[0]?.disabled_at).not.toBeNull();
});

test("cenário 8: salvar o documento mostra 'Salvo em' e grava o texto", async ({ page }) => {
  await page.goto("/configuracoes/documento-ia");
  const area = page.getByRole("textbox");
  await expect(area).toBeVisible();
  await area.fill("[TEST] Pix para a diarista é Serviços");
  await expect(page.getByText("de 4.000")).toBeVisible();
  await page.getByRole("button", { name: "Salvar documento", exact: true }).click();

  await expect(page.getByText(/Salvo em \d\d\/\d\d às \d\d:\d\d/)).toBeVisible();
  const gravado = consultaSql("pronta", `SELECT text FROM ai_rules_document WHERE household_id = ${LAR}`);
  expect(gravado[0]).toMatchObject({ text: "[TEST] Pix para a diarista é Serviços" });
});

test("cenário 11: sem regras que casem, a lista mostra o texto de vazio", async ({ page }) => {
  // Desvio registrado nas Evidências: a instância compartilhada pode ter regras de outras specs, então o vazio é
  // provado por uma busca que não casa com nada, que cai no mesmo estado vazio da lista.
  await page.goto("/configuracoes/regras");
  await page.getByRole("searchbox").fill("NAO EXISTE 0305");
  await expect(
    page.getByText("Nenhuma regra ainda. Elas aparecem quando vocês confirmam uma categoria."),
  ).toBeVisible();
});
