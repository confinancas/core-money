import { expect, type Locator, type Page, test } from "@playwright/test";
import { consultaSql, executaSql } from "./helpers/db";
import { LAR_DA_INSTALACAO_PRONTA, semeiaSessaoDaInstalacaoPronta, signUpAndSignIn } from "./helpers/sessao";
import { semearInstalacaoPronta } from "./helpers/setup";

// Central de notificações (TASK-0701), na instalação pronta (8788 ou a porta do MM_E2E_PORTA_BASE), com a sessão
// semeada e notificações [TEST] gravadas direto no D1 de teste. Três larguras: os projetos celular, tablet e desktop
// (390, 834 e 1440 px). O sino do Início fica para a TASK-0401, que ainda não está na main.

const LAR = LAR_DA_INSTALACAO_PRONTA;
const HORA = 60 * 60 * 1000;

type Semente = {
  id: string;
  kind: string;
  titulo: string;
  corpo: string;
  link: string;
  // Criada há quantas horas, e (se lida) lida há quantas horas.
  criadaHaHoras: number;
  lidaHaHoras?: number;
};

// Grava as notificações do lar de teste. Os textos são [TEST] e não têm aspas simples.
function semeiaNotificacoes(itens: Semente[]): void {
  const agora = Date.now();
  const sql = itens.map((item) => {
    const criada = new Date(agora - item.criadaHaHoras * HORA).toISOString();
    const lida =
      item.lidaHaHoras === undefined
        ? "NULL"
        : `'${new Date(agora - item.lidaHaHoras * HORA).toISOString()}'`;
    return `INSERT INTO notifications (id, household_id, kind, title, body, link, dedupe_key, created_at, read_at) VALUES ('${item.id}', '${LAR}', '${item.kind}', '${item.titulo}', '${item.corpo}', '${item.link}', 'e2e-${item.id}', '${criada}', ${lida})`;
  });
  if (sql.length > 0) executaSql("pronta", sql.join("; "));
}

const CENARIO_UM: Semente[] = [
  {
    id: "e2e-n1",
    kind: "pendencias",
    titulo: "[TEST] 4 itens para categorizar",
    corpo: "[TEST] 2 são Pix. A IA já sugeriu categoria para 2.",
    link: "/para-categorizar",
    criadaHaHoras: 1,
  },
  {
    id: "e2e-n2",
    kind: "vencimento",
    titulo: "[TEST] Fatura de teste vence em 3 dias",
    corpo: "[TEST] 1.980,00 · vence 15/10 · ainda não foi paga",
    link: "/contas",
    criadaHaHoras: 2,
  },
  {
    id: "e2e-n3",
    kind: "pix_recebido",
    titulo: "[TEST] Pix recebido de pessoa de teste",
    corpo: "+1.500,00 · toque para classificar",
    link: "/pix-recebido/e2e-pix",
    criadaHaHoras: 3,
  },
  {
    id: "e2e-n4",
    kind: "insight",
    titulo: "[TEST] Insight do dia de teste",
    corpo: "[TEST] Resumo de teste, sem valores.",
    link: "/inicio",
    criadaHaHoras: 4,
  },
  {
    id: "e2e-l1",
    kind: "balanco",
    titulo: "[TEST] Lembrete de balanço antigo",
    corpo: "Falta depositar 1.839,80 para cobrir as contas do ciclo.",
    link: "/contas",
    criadaHaHoras: 30,
    lidaHaHoras: 29,
  },
  {
    id: "e2e-l2",
    kind: "fatura_paga",
    titulo: "[TEST] Fatura de teste paga",
    corpo: "2.870,40 · paga com Pix de terceiros",
    link: "/cartoes/e2e-cartao",
    criadaHaHoras: 50,
    lidaHaHoras: 49,
  },
  {
    id: "e2e-l3",
    kind: "consentimento",
    titulo: "[TEST] Consentimento de teste vence",
    corpo: "Renove para o banco continuar atualizando.",
    link: "/configuracoes/bancos/e2e-banco",
    criadaHaHoras: 70,
    lidaHaHoras: 69,
  },
  {
    id: "e2e-l4",
    kind: "renda_dolar",
    titulo: "[TEST] Salário em dólar de teste chegou",
    corpo: "[TEST] Renda de teste · 4.000,00 recebidos · cotação de referência 5,50",
    link: "/renda",
    criadaHaHoras: 90,
    lidaHaHoras: 89,
  },
];

// Os dados do lar de teste voltam ao estado da instalação pronta antes de cada teste.
test.beforeEach(() => {
  semearInstalacaoPronta();
  semeiaSessaoDaInstalacaoPronta();
  executaSql(
    "pronta",
    `DELETE FROM notifications WHERE household_id = '${LAR}'; DELETE FROM notification_prefs WHERE household_id = '${LAR}'; UPDATE households SET cycle_start_day = 11`,
  );
});

// Alvo de toque: pelo menos 44 px de altura e de largura, medido pelo navegador.
async function alvoDeToqueDeNoMinimo44(alvo: Locator): Promise<void> {
  await expect(alvo).toBeVisible();
  const caixa = await alvo.boundingBox();
  expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(caixa?.width ?? 0).toBeGreaterThanOrEqual(44);
}

// Posição do elemento (o boundingBox do navegador).
async function caixaDe(alvo: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect(alvo).toBeVisible();
  const caixa = await alvo.boundingBox();
  if (!caixa) throw new Error("O elemento não tem caixa na página.");
  return caixa;
}

// Nenhuma rolagem horizontal da página.
async function semRolagemHorizontal(page: Page): Promise<void> {
  const sobra = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sobra).toBeLessThanOrEqual(0);
}

// As duas colunas nas três larguras (cenário 11): uma coluna com Novas acima de Anteriores no celular; duas colunas,
// Novas à esquerda e Anteriores à direita, do mesmo topo, no tablet e no desktop.
async function provaDasColunas(page: Page): Promise<void> {
  const novas = await caixaDe(page.getByRole("heading", { level: 2, name: "Novas", exact: true }));
  const anteriores = await caixaDe(page.getByRole("heading", { level: 2, name: "Anteriores", exact: true }));

  if (test.info().project.name === "celular") {
    expect(novas.y).toBeLessThan(anteriores.y);
    expect(Math.abs(novas.x - anteriores.x)).toBeLessThanOrEqual(1);
    return;
  }
  expect(novas.x).toBeLessThan(anteriores.x);
  expect(Math.abs(novas.y - anteriores.y)).toBeLessThanOrEqual(2);
}

const contaNaoLidas = () =>
  Number(
    consultaSql(
      "pronta",
      `SELECT COUNT(*) AS n FROM notifications WHERE household_id = '${LAR}' AND read_at IS NULL`,
    )[0]?.n ?? -1,
  );

test.describe("Notificações", () => {
  test("cenário 1: 4 não lidas em Novas com o ponto verde, e as lidas em Anteriores, mais novas primeiro", async ({
    page,
  }) => {
    semeiaNotificacoes(CENARIO_UM);
    await signUpAndSignIn(page);
    await page.goto("/notificacoes");

    await expect(page.getByRole("heading", { level: 1, name: "Notificações", exact: true })).toBeVisible();
    await expect(page.getByText("4 novas", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Não lida" })).toHaveCount(4);

    // Ordem: Novas da mais nova para a mais antiga, depois Anteriores da mais nova para a mais antiga.
    const textos = await page.getByRole("link").allTextContents();
    const posicoes = [
      "4 itens para categorizar",
      "Fatura de teste vence em 3 dias",
      "Pix recebido de pessoa de teste",
      "Insight do dia de teste",
      "Lembrete de balanço antigo",
      "Fatura de teste paga",
      "Consentimento de teste vence",
      "Salário em dólar de teste chegou",
    ].map((titulo) => textos.findIndex((texto) => texto.includes(titulo)));
    for (const posicao of posicoes) expect(posicao).toBeGreaterThanOrEqual(0);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);

    // A hora segue o formato do app (Hoje, Ontem ou DD/MM), com HH:MM de São Paulo.
    await expect(page.getByText(/^(Hoje|Ontem|\d{2}\/\d{2}(\/\d{4})?) · \d{2}:\d{2}$/).first()).toBeVisible();

    await provaDasColunas(page);
    await semRolagemHorizontal(page);
  });

  test("cenário 2: tocar numa notificação a marca como lida para o lar e vai ao link", async ({ page }) => {
    semeiaNotificacoes(CENARIO_UM);
    await signUpAndSignIn(page);
    await page.goto("/notificacoes");

    await page.getByRole("link", { name: /Fatura de teste vence em 3 dias/ }).click();

    await expect(page).toHaveURL(/\/contas$/);
    await expect
      .poll(() =>
        Number(
          consultaSql(
            "pronta",
            `SELECT COUNT(*) AS n FROM notifications WHERE id = 'e2e-n2' AND read_at IS NOT NULL`,
          )[0]?.n ?? 0,
        ),
      )
      .toBe(1);
  });

  test("cenário 3: 'Marcar todas como lidas' põe 'Tudo lido' e apaga o botão", async ({ page }) => {
    semeiaNotificacoes(CENARIO_UM);
    await signUpAndSignIn(page);
    await page.goto("/notificacoes");
    const botao = page.getByRole("button", { name: "Marcar todas como lidas", exact: true });
    await alvoDeToqueDeNoMinimo44(botao);

    await botao.click();

    await expect(page.getByText("Tudo lido", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Não lida" })).toHaveCount(0);
    await expect(botao).toBeDisabled();
    await expect.poll(contaNaoLidas).toBe(0);
  });

  test("cenário 9: sem notificações, 'Nenhuma notificação ainda.'", async ({ page }) => {
    await signUpAndSignIn(page);
    await page.goto("/notificacoes");

    await expect(page.getByText("Nenhuma notificação ainda.", { exact: true })).toBeVisible();
    await expect(page.getByText("Tudo lido", { exact: true })).toBeVisible();
  });

  test("cenário 9: falha ao carregar mostra a mensagem com 'Tentar de novo', e o botão recarrega", async ({
    page,
  }) => {
    semeiaNotificacoes(CENARIO_UM);
    await signUpAndSignIn(page);
    await page.route("**/api/notifications", (rota) =>
      rota.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "erro_interno" }),
      }),
    );
    await page.goto("/notificacoes");

    await expect(page.getByRole("alert")).toContainText("Não consegui carregar as notificações.");
    await page.unroute("**/api/notifications");
    await page.getByRole("button", { name: "Tentar de novo", exact: true }).click();
    await expect(page.getByText("4 novas", { exact: true })).toBeVisible();
  });

  test("cenário 10: o valor do corpo sai com centavos menores, sem quebra", async ({ page }) => {
    semeiaNotificacoes([
      {
        id: "e2e-valor",
        kind: "vencimento",
        titulo: "[TEST] Fatura de valor",
        corpo: "1.980,00 · vence 15/10",
        link: "/contas",
        criadaHaHoras: 1,
      },
    ]);
    await signUpAndSignIn(page);
    await page.goto("/notificacoes");

    const valor = page.locator(".mm-money", { hasText: "1.980" });
    await expect(valor).toBeVisible();
    const medidas = await valor.evaluate((elemento) => {
      const centavos = elemento.querySelector(".mm-cents");
      return {
        cents: centavos?.textContent ?? "",
        tamanhoCentavos: centavos ? Number.parseFloat(getComputedStyle(centavos).fontSize) : 0,
        tamanhoInteiro: Number.parseFloat(getComputedStyle(elemento).fontSize),
        quebra: getComputedStyle(elemento).whiteSpace,
      };
    });
    expect(medidas.cents).toBe(",00");
    expect(medidas.tamanhoCentavos).toBeLessThan(medidas.tamanhoInteiro);
    expect(medidas.quebra).toBe("nowrap");
  });

  test("larguras e alvos: as duas colunas, sem rolagem lateral, e alvos de 44 px", async ({ page }) => {
    semeiaNotificacoes(CENARIO_UM);
    await signUpAndSignIn(page);
    await page.goto("/notificacoes");
    await expect(page.getByText("4 novas", { exact: true })).toBeVisible();

    await provaDasColunas(page);
    await semRolagemHorizontal(page);
    await alvoDeToqueDeNoMinimo44(page.getByRole("link", { name: "Voltar ao início", exact: true }));
    await alvoDeToqueDeNoMinimo44(page.getByRole("button", { name: "Marcar todas como lidas", exact: true }));
    await alvoDeToqueDeNoMinimo44(page.getByRole("link", { name: /Fatura de teste vence em 3 dias/ }));
    await alvoDeToqueDeNoMinimo44(page.getByRole("link", { name: "Escolher o que avisar", exact: true }));
  });

  test("'Escolher o que avisar' leva às preferências, e o switch grava na hora e continua depois de recarregar", async ({
    page,
  }) => {
    await signUpAndSignIn(page);
    await page.goto("/notificacoes");
    await page.getByRole("link", { name: "Escolher o que avisar", exact: true }).click();

    await expect(page).toHaveURL(/\/configuracoes#notificacoes$/);
    const vencimentos = page.getByRole("switch", { name: "Vencimentos", exact: true });
    await expect(vencimentos).toHaveAttribute("aria-checked", "true");
    // O alvo é a linha inteira (64 px no mínimo): a chave em si tem 32 px de altura, e a área de toque de 46 px é um
    // pseudo-elemento do Switch, que o boundingBox não mede.
    await alvoDeToqueDeNoMinimo44(vencimentos.locator("xpath=ancestor::div[contains(@class,'min-h-16')][1]"));

    await vencimentos.click();
    await expect(vencimentos).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(() =>
        Number(
          consultaSql(
            "pronta",
            `SELECT COUNT(*) AS n FROM notification_prefs WHERE household_id = '${LAR}' AND kind = 'vencimento' AND enabled = 0`,
          )[0]?.n ?? 0,
        ),
      )
      .toBe(1);

    await page.reload();
    await expect(page.getByRole("switch", { name: "Vencimentos", exact: true })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(page.getByRole("switch", { name: "Insight do dia", exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("falha ao gravar a preferência: o switch volta e a mensagem aparece", async ({ page }) => {
    await signUpAndSignIn(page);
    await page.route("**/api/notification-prefs", (rota) => {
      if (rota.request().method() === "PUT") return rota.abort("internetdisconnected");
      return rota.continue();
    });
    await page.goto("/configuracoes#notificacoes");

    const vencimentos = page.getByRole("switch", { name: "Vencimentos", exact: true });
    await expect(vencimentos).toHaveAttribute("aria-checked", "true");
    await vencimentos.click();

    await expect(page.getByRole("alert")).toContainText("Não consegui salvar. Tente de novo.");
    await expect(vencimentos).toHaveAttribute("aria-checked", "true");
  });

  test("a linha do balanço mostra o dia de início do ciclo", async ({ page }) => {
    executaSql("pronta", "UPDATE households SET cycle_start_day = 5");
    await signUpAndSignIn(page);
    await page.goto("/configuracoes#notificacoes");

    await expect(page.getByText("Dia 4, para fazer a transferência", { exact: true })).toBeVisible();
  });
});
