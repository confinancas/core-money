import { expect, type Locator, type Page, test } from "@playwright/test";
import { consultaSql, executaSql } from "./helpers/db";
import { LAR_DA_INSTALACAO_PRONTA, semeiaSessaoDaInstalacaoPronta, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta } from "./helpers/setup";

// Renda fixa (TASK-0901) nas três larguras (celular 390, tablet 834, desktop 1440), contra o Worker real da instalação
// pronta. Dados [TEST]: só as rendas com `e2e-rf-` no id, do lar da instalação. Cada teste começa sem rendas de teste
// e semeia só o que usa. Só a falha de rede (a lista que não carrega) é simulada com page.route.

const LAR = LAR_DA_INSTALACAO_PRONTA;
const CLT = "[TEST] Salário CLT";
const DOLAR = "[TEST] Salário em dólar";

const q = (valor: string | number | null): string =>
  valor === null ? "NULL" : typeof valor === "number" ? String(valor) : `'${valor.replace(/'/g, "''")}'`;

// Uma linha de renda fixa do lar de teste. Tudo numa só chamada ao banco de teste.
type Renda = {
  id: string;
  nome: string;
  moeda?: "BRL" | "USD";
  centavos: number;
  dia: number;
  forma: "auto" | "partes" | "manual";
  texto?: string | null;
  fica?: boolean;
};

// O que fica em dólar vale 1 por padrão; em real o banco guarda 0 (a regra da API).
const insereRenda = (renda: Renda): string => {
  const moeda = renda.moeda ?? "BRL";
  const ficaEmDolar = moeda === "USD" && renda.fica !== false ? 1 : 0;
  return `INSERT INTO fixed_incomes (id, household_id, name, currency, amount_cents, usual_day, arrival, statement_text, kept_usd_is_investment, archived_at) VALUES (${q(renda.id)}, ${q(LAR)}, ${q(renda.nome)}, ${q(moeda)}, ${q(renda.centavos)}, ${q(renda.dia)}, ${q(renda.forma)}, ${q(renda.texto ?? null)}, ${ficaEmDolar}, NULL)`;
};

// O nome vira um RegExp literal (os colchetes do [TEST] não são classe de caracteres).
const nomeComoTexto = (nome: string): RegExp => new RegExp(nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

// Estado inicial do lar: nenhuma renda de teste. As que o teste precisa entram depois, com `semeia`.
function limpaRendas(rendas: Renda[] = []): void {
  executaSql(
    "pronta",
    [`DELETE FROM fixed_incomes WHERE household_id = ${q(LAR)}`, ...rendas.map(insereRenda)].join("; "),
  );
}

const CLT_SEMEADA: Renda = {
  id: "e2e-rf-clt",
  nome: CLT,
  centavos: 500000,
  dia: 5,
  forma: "auto",
  texto: "SALARIO",
};

// Alvo de toque: pelo menos 44 px de altura e de largura, medido pelo navegador.
async function caixaDe(alvo: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect(alvo).toBeVisible();
  const caixa = await alvo.boundingBox();
  if (!caixa) throw new Error("O elemento não tem caixa na página.");
  return caixa;
}

async function alvoDeNoMinimo44(alvo: Locator): Promise<void> {
  const caixa = await caixaDe(alvo);
  expect(caixa.height, "altura do alvo").toBeGreaterThanOrEqual(44);
  expect(caixa.width, "largura do alvo").toBeGreaterThanOrEqual(44);
}

// O valor grande do previsto: o primeiro número de imagem dentro do cartão "Previsto por ciclo".
const previstoGrande = (page: Page) =>
  page.getByText("Previsto por ciclo", { exact: true }).locator("xpath=..").getByRole("img").first();

const campoNome = (page: Page) => page.getByLabel("Nome", { exact: true });
const campoValor = (page: Page) => page.getByLabel("Valor por ciclo", { exact: true });
const botaoDeSalvar = (page: Page, texto: string) =>
  page.locator("form").getByRole("button", { name: texto, exact: true });

test.beforeAll(() => {
  semearInstalacaoPronta();
  semeiaSessaoDaInstalacaoPronta();
});

// Cada teste limpa e semeia o próprio lar (uma chamada ao banco de teste). Um wrangler sob carga leva segundos por
// chamada, e o tempo dele conta no teste: o limite do arquivo é maior que o padrão. Nenhum expect muda.
test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await signUpAndSignIn(page);
});

test("cenário 1: a renda CLT entra na lista com o dia e a forma, e o previsto vira 5.000,00", async ({
  page,
}) => {
  limpaRendas();
  await page.goto("/renda/fixa");
  await expect(page.getByText("Nenhuma renda fixa ainda.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nova renda fixa", exact: true })).toBeVisible();

  await campoNome(page).fill(CLT);
  await campoValor(page).fill("5.000,00");
  await page.getByRole("radio", { name: "Real", exact: true }).click();
  await page.getByRole("button", { name: "Na conta, pelo Open Finance", exact: true }).click();
  await page.getByLabel("Texto que aparece no extrato", { exact: true }).fill("SALARIO");
  await botaoDeSalvar(page, "Adicionar renda fixa").click();

  await expect(page.getByText("todo dia 5 · automático", { exact: true })).toBeVisible();
  await expect(previstoGrande(page)).toHaveAttribute("aria-label", "5.000,00");
  await expect(page).toHaveURL(/\/renda\/fixa\?id=/);
  const linha = await consultaSql(
    "pronta",
    `SELECT amount_cents, kept_usd_is_investment, arrival FROM fixed_incomes WHERE household_id = ${q(LAR)}`,
  );
  expect(linha).toEqual([{ amount_cents: 500000, kept_usd_is_investment: 0, arrival: "auto" }]);
});

test("cenário 2: o salário em dólar mostra o US$, a cotação de referência e o Investimento ligado; a legenda leva o valor em dólar e o previsto continua em real", async ({
  page,
}) => {
  limpaRendas([CLT_SEMEADA]);
  await page.goto("/renda/fixa?nova=1");

  await page.getByRole("radio", { name: "Dólar", exact: true }).click();
  await expect(page.getByText("Cotação automática", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Usa a cotação do dia em que o salário cair. É só referência.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("switch", { name: "O que ficar em dólar é Investimento" })).toBeChecked();

  await campoNome(page).fill(DOLAR);
  await campoValor(page).fill("2.000,00");
  await page.getByRole("button", { name: "Em partes: conta + Pix de terceiros", exact: true }).click();
  await botaoDeSalvar(page, "Adicionar renda fixa").click();

  await expect(page.getByText(`${DOLAR} US$ 2.000,00`, { exact: true })).toBeVisible();
  await expect(page.getByText("todo dia 5 · em partes", { exact: false }).first()).toBeVisible();
  await expect(previstoGrande(page)).toHaveAttribute("aria-label", "5.000,00");
});

test("cenário 6: o dia dá a volta: 31 com + vira 1, e 1 com − vira 31", async ({ page }) => {
  limpaRendas([
    { id: "e2e-rf-d31", nome: "[TEST] Dia 31", centavos: 100000, dia: 31, forma: "manual" },
    { id: "e2e-rf-d1", nome: "[TEST] Dia 1", centavos: 100000, dia: 1, forma: "manual" },
  ]);

  await page.goto("/renda/fixa?id=e2e-rf-d31");
  await expect(page.getByText("Todo dia 31", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Próximo dia", exact: true }).click();
  await expect(page.getByText("Todo dia 1", { exact: true })).toBeVisible();

  await page.goto("/renda/fixa?id=e2e-rf-d1");
  await expect(page.getByText("Todo dia 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Dia anterior", exact: true }).click();
  await expect(page.getByText("Todo dia 31", { exact: true })).toBeVisible();
});

test("cenário 8: trocar a forma para 'Eu lanço na mão' muda a ajuda e o salvamento grava manual", async ({
  page,
}) => {
  limpaRendas([CLT_SEMEADA]);
  await page.goto("/renda/fixa?id=e2e-rf-clt");
  await expect(page.getByRole("heading", { name: "Editar", exact: true })).toBeVisible();
  await expect(page.getByText("O app reconhece pelo texto do extrato e marca como recebido.")).toBeVisible();

  await page.getByRole("button", { name: "Eu lanço na mão", exact: true }).click();
  await expect(
    page.getByText("Vocês confirmam quando cair. Útil para o que não passa pelo banco.", { exact: true }),
  ).toBeVisible();
  await botaoDeSalvar(page, "Salvar alterações").click();

  await expect(page.getByText("todo dia 5 · manual", { exact: true })).toBeVisible();
  // A lista só mostra "manual" depois que a API respondeu ao salvar: o banco já tem a forma nova.
  const linha = consultaSql("pronta", "SELECT arrival FROM fixed_incomes WHERE id = 'e2e-rf-clt'");
  expect(linha[0]?.arrival).toBe("manual");
});

test("cenário 9: excluir é confirmado na tela; a renda sai da lista e do previsto, e a linha fica arquivada", async ({
  page,
}) => {
  limpaRendas([CLT_SEMEADA]);
  const dialogosNativos: string[] = [];
  page.on("dialog", (dialogo) => {
    dialogosNativos.push(dialogo.message());
    void dialogo.dismiss();
  });
  await page.goto("/renda/fixa?id=e2e-rf-clt");

  await page.getByRole("button", { name: "Excluir esta renda fixa", exact: true }).click();
  const confirmacao = page.getByRole("dialog");
  await expect(confirmacao.getByText(`Excluir ${CLT}?`, { exact: true })).toBeVisible();
  await expect(
    confirmacao.getByText("O que já foi recebido continua no histórico.", { exact: true }),
  ).toBeVisible();
  await confirmacao.getByRole("button", { name: "Excluir", exact: true }).click();

  await expect(page.getByText("Nenhuma renda fixa ainda.", { exact: true })).toBeVisible();
  await expect(previstoGrande(page)).toHaveAttribute("aria-label", "0,00");
  expect(dialogosNativos).toEqual([]);
  const linha = await consultaSql("pronta", "SELECT archived_at FROM fixed_incomes WHERE id = 'e2e-rf-clt'");
  expect(linha[0]?.archived_at).not.toBeNull();
});

test("cenário 11: Configurações lista cada renda com o subtítulo e o valor certos, e os links abrem o editor certo", async ({
  page,
}) => {
  limpaRendas([
    CLT_SEMEADA,
    { id: "e2e-rf-usd", nome: DOLAR, moeda: "USD", centavos: 200000, dia: 10, forma: "partes" },
  ]);
  await page.goto("/configuracoes");

  await expect(page.getByRole("heading", { level: 2, name: "Renda fixa", exact: true })).toBeVisible();
  const clt = page.getByRole("link", { name: nomeComoTexto(CLT) });
  await expect(clt).toContainText("Automático pelo Open Finance");
  await expect(clt).toContainText("5.000,00");
  const dolar = page.getByRole("link", { name: nomeComoTexto(DOLAR) });
  await expect(dolar).toContainText("Em partes: conta + Pix de terceiros · cotação do dia em que cair");
  await expect(dolar).toContainText("US$ 2.000,00");

  await dolar.click();
  await expect(page).toHaveURL(/\/renda\/fixa\?id=e2e-rf-usd/);
  await expect(page.getByRole("heading", { name: "Editar", exact: true })).toBeVisible();
  await expect(campoNome(page)).toHaveValue(DOLAR);

  await page.goto("/configuracoes");
  await page.getByRole("link", { name: "Adicionar renda fixa", exact: true }).click();
  await expect(page).toHaveURL(/\/renda\/fixa\?nova=1/);
  await expect(page.getByRole("heading", { name: "Nova renda fixa", exact: true })).toBeVisible();
});

test("larguras e alvos: a lista e o editor se distribuem como no protótipo, sem rolagem lateral e com alvos de 44 px", async ({
  page,
}) => {
  limpaRendas([CLT_SEMEADA]);
  await page.goto("/renda/fixa?id=e2e-rf-clt");
  await expect(page.getByRole("heading", { name: "Editar", exact: true })).toBeVisible();

  const largura = page.viewportSize()?.width ?? 0;
  const rolagemLateral = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(rolagemLateral).toBeLessThanOrEqual(0);

  const lista = await caixaDe(page.locator('[aria-label="Rendas fixas"]'));
  const editor = await caixaDe(page.locator("form"));
  if (largura < 768) {
    // Celular: a lista e, abaixo dela, o editor, na mesma coluna.
    expect(editor.y).toBeGreaterThan(lista.y + lista.height - 1);
    expect(Math.abs(editor.x - lista.x)).toBeLessThanOrEqual(1);
  } else {
    // Tablet e desktop: a lista à esquerda e o editor à direita, do mesmo topo.
    expect(editor.x).toBeGreaterThanOrEqual(lista.x + lista.width - 1);
    expect(Math.abs(editor.y - lista.y)).toBeLessThanOrEqual(2);
  }

  await alvoDeNoMinimo44(page.getByRole("link", { name: "Voltar para Renda", exact: true }));
  await alvoDeNoMinimo44(page.getByRole("button", { name: /Salário CLT/ }));
  await alvoDeNoMinimo44(page.getByRole("button", { name: "Adicionar renda fixa", exact: true }).first());
  await alvoDeNoMinimo44(page.getByRole("radio", { name: "Real", exact: true }));
  await alvoDeNoMinimo44(page.getByRole("button", { name: "Próximo dia", exact: true }));
  await alvoDeNoMinimo44(page.getByRole("button", { name: "Dia anterior", exact: true }));
  await alvoDeNoMinimo44(page.getByRole("button", { name: "Eu lanço na mão", exact: true }));
  await alvoDeNoMinimo44(botaoDeSalvar(page, "Salvar alterações"));
  await alvoDeNoMinimo44(page.getByRole("button", { name: "Excluir esta renda fixa", exact: true }));

  // A chave do Investimento (só no dólar) tem a área de toque de 46 px, do desenho do Switch: acerta nos dois lados do centro.
  await page.getByRole("radio", { name: "Dólar", exact: true }).click();
  const chave = page.getByRole("switch", { name: "O que ficar em dólar é Investimento" });
  const caixa = await caixaDe(chave);
  for (const dy of [-20, 20]) {
    const acertou = await page.evaluate(
      ({ x, y }) => {
        const elemento = document.elementFromPoint(x, y);
        return elemento?.closest('[role="switch"]') !== null;
      },
      { x: caixa.x + caixa.width / 2, y: caixa.y + caixa.height / 2 + dy },
    );
    expect(acertou, `a chave responde a ${dy} px do centro`).toBe(true);
  }
});

test("renda excluída por outra pessoa: o salvamento avisa e a tela volta à primeira da lista", async ({
  page,
}) => {
  limpaRendas([CLT_SEMEADA]);
  await page.goto("/renda/fixa?id=e2e-rf-clt");
  await expect(campoNome(page)).toHaveValue(CLT);

  // A outra pessoa exclui a renda enquanto a edição está aberta.
  executaSql(
    "pronta",
    "UPDATE fixed_incomes SET archived_at = '2026-11-10T12:00:00.000Z' WHERE id = 'e2e-rf-clt'",
  );
  await campoNome(page).fill("[TEST] Salário CLT ajustado");
  await botaoDeSalvar(page, "Salvar alterações").click();

  await expect(page.getByRole("alert")).toHaveText("Esta renda fixa foi excluída por outra pessoa.");
  await expect(page.getByText("Nenhuma renda fixa ainda.", { exact: true })).toBeVisible();
});

test("validação na tela: as mensagens da spec aparecem e nada é gravado", async ({ page }) => {
  limpaRendas([CLT_SEMEADA]);
  await page.goto("/renda/fixa?nova=1");

  await campoNome(page).fill(CLT);
  await campoValor(page).fill("5.000,00");
  await page.getByRole("button", { name: "Na conta, pelo Open Finance", exact: true }).click();
  await botaoDeSalvar(page, "Adicionar renda fixa").click();
  await expect(page.getByText("Já existe uma renda fixa com esse nome.", { exact: true })).toBeVisible();

  await campoNome(page).fill("Salário novo");
  await page.getByLabel("Texto que aparece no extrato", { exact: true }).fill("AB");
  await botaoDeSalvar(page, "Adicionar renda fixa").click();
  await expect(page.getByText("Use de 3 a 60 caracteres.", { exact: true })).toBeVisible();

  await page.getByLabel("Texto que aparece no extrato", { exact: true }).fill("");
  await botaoDeSalvar(page, "Adicionar renda fixa").click();
  await expect(
    page.getByText("Para reconhecer sozinho, diga o texto que aparece no extrato.", { exact: true }),
  ).toBeVisible();

  await page.getByLabel("Texto que aparece no extrato", { exact: true }).fill("SALARIO NOVO");
  await campoValor(page).fill("2,000.00");
  await botaoDeSalvar(page, "Adicionar renda fixa").click();
  await expect(page.getByText("Informe o valor por ciclo.", { exact: true })).toBeVisible();

  const quantas = await consultaSql(
    "pronta",
    `SELECT COUNT(*) AS n FROM fixed_incomes WHERE household_id = ${q(LAR)}`,
  );
  expect(quantas[0]?.n).toBe(1);
});

test("a lista que não carrega mostra o estado de erro, e 'Tentar de novo' recupera", async ({ page }) => {
  limpaRendas([CLT_SEMEADA]);
  await page.route("**/api/fixed-incomes", (rota) => rota.abort("internetdisconnected"));
  await page.goto("/renda/fixa");

  await expect(page.getByText("Não foi possível carregar a renda fixa.", { exact: true })).toBeVisible();
  await page.unroute("**/api/fixed-incomes");
  await page.getByRole("button", { name: "Tentar de novo", exact: true }).click();
  await expect(page.getByRole("button", { name: /Salário CLT/ })).toBeVisible();
});
