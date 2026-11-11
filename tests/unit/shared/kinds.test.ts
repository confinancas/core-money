import { describe, expect, it } from "vitest";
import {
  ehTipoDeNotificacao,
  NOTIFICATION_CATALOG,
  NOTIFICATION_KINDS,
  subtituloDoTipo,
} from "../../../src/shared/notifications/kinds";

// Catálogo das notificações (TASK-0701): 11 tipos na ordem das preferências, com as cores e os links da tabela da spec.
describe("catálogo de notificações", () => {
  it("tem os 11 tipos, na ordem das preferências", () => {
    expect(NOTIFICATION_KINDS).toEqual([
      "pendencias",
      "insight",
      "negativo",
      "meta_dia",
      "vencimento",
      "balanco",
      "consentimento",
      "pix_recebido",
      "fatura_paga",
      "renda_dolar",
      "aviso_ia",
    ]);
    expect(Object.keys(NOTIFICATION_CATALOG)).toEqual([...NOTIFICATION_KINDS]);
  });

  it("cada tipo do catálogo leva o próprio nome de tipo", () => {
    for (const tipo of NOTIFICATION_KINDS) {
      expect(NOTIFICATION_CATALOG[tipo].kind).toBe(tipo);
    }
  });

  it.each([
    ["pendencias", "Transações sem categoria", "alerta", "#FFF5E4", "#E08A00", "/para-categorizar"],
    ["insight", "Insight do dia", "brilho", "#10261E", "#9DFFD6", "/inicio"],
    ["negativo", "Ciclo no negativo", "alerta", "#FFF0F1", "#E5484D", "/inicio"],
    ["meta_dia", "Meta do dia", "alerta", "#FFF5E4", "#E08A00", "/inicio"],
    ["vencimento", "Vencimentos", "relogio", "#FFF0F1", "#E5484D", "/contas"],
    ["balanco", "Lembrete do balanço", "check", "#E7F7EF", "#1E9E63", "/contas"],
    ["consentimento", "Renovar bancos", "banco", "#FFF5E4", "#E08A00", "/configuracoes/bancos/:bankItemId"],
    ["pix_recebido", "Pix recebido", "entrada", "#E6F6EE", "#0A7D50", "/pix-recebido/:transactionId"],
    ["fatura_paga", "Fatura paga", "check", "#E7F7EF", "#1E9E63", "/cartoes/:cardId"],
    ["renda_dolar", "Salário em dólar", "entrada", "#E6F6EE", "#0A7D50", "/renda"],
    ["aviso_ia", "Avisos da assistente", "alerta", "#FFF5E4", "#E08A00", "/inicio"],
  ] as const)("%s: título, ícone, cores e link da tabela", (tipo, titulo, icone, fundo, cor, link) => {
    const item = NOTIFICATION_CATALOG[tipo];
    expect(item.titulo).toBe(titulo);
    expect(item.icone).toBe(icone);
    expect(item.fundo).toBe(fundo);
    expect(item.cor).toBe(cor);
    expect(item.link).toBe(link);
  });

  it("o subtítulo do balanço segue o dia de início do ciclo", () => {
    expect(subtituloDoTipo("balanco", 11)).toBe("Dia 10, para fazer a transferência");
    expect(subtituloDoTipo("balanco", 1)).toBe("No último dia do ciclo, para fazer a transferência");
  });

  it("os outros subtítulos não mudam com o dia", () => {
    expect(subtituloDoTipo("vencimento", 1)).toBe("Faturas e contas 3 dias antes");
    expect(subtituloDoTipo("vencimento", 28)).toBe("Faturas e contas 3 dias antes");
  });

  it("aceita só os tipos do catálogo", () => {
    expect(ehTipoDeNotificacao("vencimento")).toBe(true);
    expect(ehTipoDeNotificacao("limite_pct")).toBe(false);
    expect(ehTipoDeNotificacao("Vencimento")).toBe(false);
    expect(ehTipoDeNotificacao(undefined)).toBe(false);
  });
});
