import { expect, type Locator, type Page, test } from "@playwright/test";
import { executaSql } from "./helpers/db";
import { LAR_DA_INSTALACAO_PRONTA, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta, zeraChavesDaInstalacaoPronta } from "./helpers/setup";

// Para categorizar (TASK-0304) nas três larguras (celular, tablet, desktop), contra o Worker da instalação pronta.
// Dados [TEST] com o prefixo e2e-pc-. Cenários da seção Testes: 2, 3, 4, 5, 6, 12, 16, 20 e 26. Provas de layout:
// colunas do tablet e do desktop, nenhuma sobreposição, botão Aceitar com contraste de 4,5:1 ou mais.

const LAR = LAR_DA_INSTALACAO_PRONTA;
const CONEXAO = "e2e-pc-conexao";
const BANCO = "e2e-pc-banco";
const CONTA = "e2e-pc-conta";
const CARTAO = "e2e-pc-cartao";
const CATEGORIA_IA = "e2e-pc-categoria";
const CATEGORIA_NOME = "Serviços";

const q = (valor: string | number | null): string =>
  valor === null ? "NULL" : typeof valor === "number" ? String(valor) : `'${valor.replace(/'/g, "''")}'`;

type Linha = {
  id: string;
  nome: string;
  chave: string;
  valor: number;
  movement?: string;
  cartao?: boolean;
  sugestao?: boolean;
  data?: string;
};

// Insere o cenário: banco, conta, cartão e categoria de teste, e as linhas dadas (sem categoria, pendentes).
function semeiaFila(linhas: Linha[]): void {
  const agora = new Date().toISOString();
  executaSql("pronta", "DELETE FROM transactions WHERE id LIKE 'e2e-pc-%'");
  executaSql("pronta", `DELETE FROM rules WHERE household_id = ${q(LAR)} AND match_value LIKE 'TEST E2E%'`);
  executaSql(
    "pronta",
    [
      `INSERT OR IGNORE INTO pluggy_connections (id, household_id, label, created_at) VALUES (${q(CONEXAO)}, ${q(LAR)}, '[TEST] Conexão E2E para categorizar', ${q(agora)})`,
      `INSERT OR IGNORE INTO bank_items (id, connection_id, institution_name, institution_color, created_at) VALUES (${q(BANCO)}, ${q(CONEXAO)}, '[TEST] Banco E2E', '#0E9A63', ${q(agora)})`,
      `INSERT OR IGNORE INTO categories (id, household_id, name, color, parent_id, default_spend_type, ai_hint, sort, archived_at) VALUES (${q(CATEGORIA_IA)}, ${q(LAR)}, '[TEST] ${CATEGORIA_NOME}', '#1B84F2', NULL, 'fixos', NULL, 0, NULL)`,
      `INSERT OR IGNORE INTO accounts (id, bank_item_id, kind, name, balance_cents, overdraft_used_cents, balance_at) VALUES (${q(CONTA)}, ${q(BANCO)}, 'corrente', '[TEST] Conta E2E', 0, 0, ${q(agora)})`,
      `INSERT OR IGNORE INTO cards (id, bank_item_id, last4, name) VALUES (${q(CARTAO)}, ${q(BANCO)}, '7777', '[TEST] Cartão E2E')`,
    ].join(";\n"),
  );
  for (const linha of linhas) {
    const cartao = linha.cartao === true;
    executaSql(
      "pronta",
      `INSERT INTO transactions (id, household_id, external_id, bank_item_id, account_id, card_id, movement, occurred_at, local_date,
         amount_cents, original_description, establishment_key, counterparty_name, ai_category_id, last_seen_at)
       VALUES (${q(linha.id)}, ${q(LAR)}, ${q(`[TEST] ext-${linha.id}`)}, ${q(BANCO)}, ${cartao ? "NULL" : q(CONTA)},
         ${cartao ? q(CARTAO) : "NULL"}, ${q(linha.movement ?? (cartao ? "compra" : "pix_enviado"))}, ${q(agora)},
         ${q(linha.data ?? "2026-11-05")}, ${linha.valor}, ${q(linha.nome)}, ${q(linha.chave)},
         NULL, ${linha.sugestao === false ? "NULL" : q(CATEGORIA_IA)}, ${q(agora)})`,
    );
  }
}

const DUAS = (): Linha[] => [
  { id: "e2e-pc-1", nome: "[TEST] Pix E2E um", chave: "TEST E2E um", valor: -15000 },
  { id: "e2e-pc-2", nome: "[TEST] Pix E2E dois", chave: "TEST E2E dois", valor: -8000 },
];

// A IA aparece quando existe a linha da chave do Claude. A linha é de teste (o queue não a decifra).
function ligaIADeTeste(): void {
  executaSql(
    "pronta",
    "INSERT INTO app_secrets (name, ciphertext, iv, updated_at) VALUES ('claude_api_key', 'AAAA', 'AAAA', '2026-11-11T00:00:00.000Z')",
  );
}

// Cada executaSql sobe o wrangler (3 a 5 s) e o gancho entra no limite do teste: 120 s, como o Meu Pluggy.
test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  semearInstalacaoPronta();
  ligaIADeTeste();
  await signUpAndSignIn(page);
  semeiaFila(DUAS());
});

async function abre(page: Page): Promise<void> {
  await page.goto("/para-categorizar");
  await expect(page.getByRole("heading", { name: "Para categorizar" })).toBeVisible();
}

// Luminância relativa (WCAG) de uma cor rgb(...), e a razão de contraste entre duas.
async function contrasteDoBotao(botao: Locator): Promise<number> {
  return botao.evaluate((el) => {
    const cor = (texto: string) =>
      texto
        .match(/\d+(\.\d+)?/g)!
        .slice(0, 3)
        .map(Number);
    const lum = ([r, g, b]: number[]) => {
      const c = [r, g, b].map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    };
    const estilo = getComputedStyle(el);
    const a = lum(cor(estilo.color));
    const b = lum(cor(estilo.backgroundColor));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

test("cenário 2: mostra a fila, o progresso e aceita em massa", async ({ page }) => {
  await abre(page);
  await expect(page.getByText("0 de 2 categorizados")).toBeVisible();
  await expect(page.getByText("faltam 2")).toBeVisible();

  const aceitar = page.getByRole("button", { name: "Aceitar", exact: true });
  await expect(aceitar).toBeEnabled();
  const caixa = await aceitar.boundingBox();
  expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(await contrasteDoBotao(aceitar)).toBeGreaterThanOrEqual(4.5);

  await aceitar.click();
  await expect(page.getByText("2 de 2 categorizados")).toBeVisible();
  await expect(page.getByText("tudo certo")).toBeVisible();

  const semRolagemHorizontal = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(semRolagemHorizontal).toBe(true);
});

test("layout: colunas e sobreposição nas três larguras", async ({ page }) => {
  await abre(page);
  const filtros = await page.getByTestId("filtros").boundingBox();
  const lista = await page.getByTestId("lista").boundingBox();
  expect(filtros && lista).toBeTruthy();
  const largura = page.viewportSize()?.width ?? 0;
  if (largura >= 768) {
    // Tablet e desktop: filtros à esquerda, lista à direita, sem sobrepor.
    expect(filtros!.x + filtros!.width).toBeLessThanOrEqual(lista!.x + 1);
  } else {
    // Celular: uma coluna, filtros acima da lista.
    expect(filtros!.y + filtros!.height).toBeLessThanOrEqual(lista!.y + 1);
  }
});

test("cenário 3: o ✓ confirma só a linha; a outra continua na fila", async ({ page }) => {
  await abre(page);
  await page.getByRole("button", { name: /Confirmar .*Serviços.* para \[TEST\] Pix E2E um/ }).click();
  await expect(page.getByText("1 de 2 categorizados")).toBeVisible();
  await expect(page.getByText("faltam 1")).toBeVisible();
  await expect(page.getByText("[TEST] Pix E2E dois")).toBeVisible();
});

test("cenário 4: desfazer devolve a linha à fila e desconta o progresso", async ({ page }) => {
  await abre(page);
  await page.getByRole("button", { name: "Aceitar", exact: true }).click();
  await expect(page.getByText("2 de 2 categorizados")).toBeVisible();
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(page.getByText("0 de 2 categorizados")).toBeVisible();
  await expect(page.getByText("[TEST] Pix E2E um")).toBeVisible();
});

test("cenário 5: no filtro Cartão, Aceitar confirma só as compras", async ({ page }) => {
  semeiaFila([
    ...DUAS(),
    {
      id: "e2e-pc-cartao-1",
      nome: "[TEST] Compra E2E",
      chave: "TEST E2E compra",
      valor: -4590,
      cartao: true,
      data: "2026-11-06",
    },
  ]);
  await abre(page);
  await page.getByRole("button", { name: /^Cartão/ }).click();
  await expect(page.getByText("[TEST] Compra E2E")).toBeVisible();
  await page.getByRole("button", { name: "Aceitar", exact: true }).click();
  await expect(page.getByText("1 de 3 categorizados")).toBeVisible();
  await page.getByRole("button", { name: /^Todos/ }).click();
  await expect(page.getByText("[TEST] Pix E2E um")).toBeVisible();
  await expect(page.getByText("[TEST] Compra E2E")).toHaveCount(0);
});

test("cenário 6: linha sem sugestão mostra o aviso, sem ✓, e leva ao detalhe", async ({ page }) => {
  semeiaFila([
    {
      id: "e2e-pc-sem",
      nome: "[TEST] Pix sem sugestão",
      chave: "TEST E2E sem",
      valor: -2000,
      sugestao: false,
    },
  ]);
  await abre(page);
  await expect(page.getByText("Sem sugestão · toque para escolher")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Confirmar/ })).toHaveCount(0);
  await page.getByText("[TEST] Pix sem sugestão").click();
  await expect(page).toHaveURL(/\/pix\/e2e-pc-sem$/);
});

test("cenário 12: sem pendentes, a tela diz que está tudo categorizado", async ({ page }) => {
  semeiaFila([]);
  await abre(page);
  await expect(page.getByText("Tudo categorizado!")).toBeVisible();
});

test("cenário 16: confirmar uma compra leva as iguais que esperavam", async ({ page }) => {
  semeiaFila([
    { id: "e2e-pc-i1", nome: "[TEST] ASAAS E2E", chave: "TEST E2E igual", valor: -3000, movement: "compra" },
    { id: "e2e-pc-i2", nome: "[TEST] ASAAS E2E", chave: "TEST E2E igual", valor: -3000, movement: "compra" },
    { id: "e2e-pc-i3", nome: "[TEST] ASAAS E2E", chave: "TEST E2E igual", valor: -3000, movement: "compra" },
  ]);
  await abre(page);
  await page
    .getByRole("button", { name: /Confirmar .*Serviços.* para \[TEST\] ASAAS E2E/ })
    .first()
    .click();
  await expect(page.getByText("+ 2 iguais")).toBeVisible();
  await expect(page.getByText("3 de 3 categorizados")).toBeVisible();
});

test("cenário 20: desfazer a confirmação devolve as iguais à fila", async ({ page }) => {
  semeiaFila([
    { id: "e2e-pc-i1", nome: "[TEST] ASAAS E2E", chave: "TEST E2E igual", valor: -3000, movement: "compra" },
    { id: "e2e-pc-i2", nome: "[TEST] ASAAS E2E", chave: "TEST E2E igual", valor: -3000, movement: "compra" },
    { id: "e2e-pc-i3", nome: "[TEST] ASAAS E2E", chave: "TEST E2E igual", valor: -3000, movement: "compra" },
  ]);
  await abre(page);
  await page
    .getByRole("button", { name: /Confirmar .*Serviços.* para \[TEST\] ASAAS E2E/ })
    .first()
    .click();
  await expect(page.getByText("3 de 3 categorizados")).toBeVisible();
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(page.getByText("0 de 3 categorizados")).toBeVisible();
  await expect(page.getByText("faltam 3")).toBeVisible();
});

test("cenário 26: sem a chave do Claude, a tela oferece colar a chave e não aceita nada", async ({
  page,
}) => {
  zeraChavesDaInstalacaoPronta();
  semeiaFila(DUAS().map((linha) => ({ ...linha, sugestao: false })));
  await abre(page);
  await expect(page.getByText("Sem IA: vocês escolhem cada um.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Colar a chave" })).toHaveAttribute(
    "href",
    "/configuracoes/claude",
  );
  await expect(page.getByRole("button", { name: "Aceitar", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Confirmar/ })).toHaveCount(0);
  await expect(page.getByText("Sem sugestão · toque para escolher")).toHaveCount(2);
});
