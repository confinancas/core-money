import { describe, expect, it } from "vitest";
import {
  bankStatusPill,
  consentView,
  freshnessPill,
  quandoDaExecucao,
  runLine,
} from "../../../src/shared/bank-item-view";

// Dia de hoje fixo: 2026-11-12 (São Paulo). Validades do Pluggy vêm à meia-noite UTC.
const HOJE = "2026-11-12";
const NOME = "[TEST] Banco A";
const validadeEm = (dias: number) => {
  const d = new Date(Date.parse(`${HOJE}T00:00:00Z`) + dias * 86_400_000);
  return `${d.toISOString().slice(0, 10)}T00:00:00.000Z`;
};

describe("consentView", () => {
  it("vencido (um dia atrás): título e texto de vencido, na cor de aviso", () => {
    const v = consentView(validadeEm(-1), HOJE, NOME);
    expect(v.titulo).toBe("Consentimento vencido");
    expect(v.texto).toBe("O [TEST] Banco A parou de atualizar. Renove no Meu Pluggy para voltar.");
    expect(v.tom).toBe("aviso");
    expect(v.diasRestantes).toBe(-1);
  });

  it("vence hoje (0 dias): 'Vence hoje.'", () => {
    const v = consentView(validadeEm(0), HOJE, NOME);
    expect(v.titulo).toBe("Consentimento expira em 12/11");
    expect(v.texto.startsWith("Vence hoje.")).toBe(true);
  });

  it("falta 1 dia: singular", () => {
    const v = consentView(validadeEm(1), HOJE, NOME);
    expect(v.titulo).toBe("Consentimento expira em 13/11");
    expect(v.texto.startsWith("Falta 1 dia.")).toBe(true);
  });

  it("22 dias: 'Faltam 22 dias' e o texto de parar de atualizar", () => {
    const v = consentView(validadeEm(22), HOJE, NOME);
    expect(v.titulo).toBe("Consentimento expira em 04/12");
    expect(v.texto).toBe(
      "Faltam 22 dias. Depois disso, o [TEST] Banco A para de atualizar até vocês renovarem.",
    );
    expect(v.tom).toBe("aviso");
  });

  it("30 dias ainda é 'expira em'", () => {
    const v = consentView(validadeEm(30), HOJE, NOME);
    expect(v.titulo).toBe("Consentimento expira em 12/12");
    expect(v.texto.startsWith("Faltam 30 dias.")).toBe(true);
  });

  it("31 dias: 'válido até' com ano e o texto de 12 meses", () => {
    const v = consentView(validadeEm(31), HOJE, NOME);
    expect(v.titulo).toBe("Consentimento válido até 13/12/2026");
    expect(v.texto).toBe("Vale 12 meses a partir da autorização.");
    expect(v.tom).toBe("sucesso");
  });

  it("F24: a barra é dias restantes sobre 365 (182 dias ≈ 49,9%, não 100%)", () => {
    const v = consentView(validadeEm(182), HOJE, NOME);
    expect(v.barraPct).toBeCloseTo((182 / 365) * 100, 5);
  });

  it("sem data: 'Validade não informada' e sem linha de baixo", () => {
    const v = consentView(null, HOJE, NOME);
    expect(v.titulo).toBe("Validade não informada");
    expect(v.texto).toBe("O Meu Pluggy não disse até quando vale.");
    expect(v.linhaDeBaixo).toBeNull();
    expect(v.barraPct).toBe(0);
  });

  it("autorizado em = validade menos 12 meses, e a barra vai de 0 a 100", () => {
    const v = consentView("2027-11-12T00:00:00.000Z", HOJE, NOME);
    expect(v.linhaDeBaixo).toBe("Autorizado em 12/11/2026 · vale 12 meses");
    expect(v.barraPct).toBeCloseTo((365 / 365) * 100, 5);
    const vencido = consentView(validadeEm(-400), HOJE, NOME);
    expect(vencido.barraPct).toBe(0);
  });

  it("validade em 29/02 de ano comum: autorizado em 28/02", () => {
    const v = consentView("2028-02-29T00:00:00.000Z", "2026-11-12", NOME);
    expect(v.linhaDeBaixo).toBe("Autorizado em 28/02/2027 · vale 12 meses");
  });
});

describe("runLine", () => {
  const base = {
    kind: "diaria",
    status: "ok",
    errorCode: null,
    newTransactions: 14,
    progressPct: 100,
    finishedAt: "2026-11-12T03:12:00.000Z",
    startedAt: "2026-11-12T03:10:00.000Z",
  };

  it("ok com N transações novas", () => {
    expect(runLine(base)).toEqual({
      texto: "14 transações novas",
      pilula: { texto: "OK", tom: "sucesso" },
    });
  });

  it("ok com 1 transação e com nada novo", () => {
    expect(runLine({ ...base, newTransactions: 1 }).texto).toBe("1 transação nova");
    expect(runLine({ ...base, newTransactions: 0 }).texto).toBe("Nada novo");
  });

  it("historico ok: 'Histórico importado · N transações'", () => {
    const linha = runLine({ ...base, kind: "historico", newTransactions: 2 });
    expect(linha.texto).toBe("Histórico importado · 2 transações");
    expect(linha.pilula).toEqual({ texto: "OK", tom: "sucesso" });
  });

  it("repetiu: 'deu certo às HH:MM', com a pílula Repetiu", () => {
    const linha = runLine({ ...base, status: "repetiu" });
    expect(linha.texto).toBe("Banco instável · deu certo às 00:12");
    expect(linha.pilula).toEqual({ texto: "Repetiu", tom: "aviso" });
  });

  it("instavel: 'tenta de novo amanhã', com a pílula Instável", () => {
    const linha = runLine({ ...base, status: "instavel", errorCode: "banco_instavel" });
    expect(linha.texto).toBe("Banco instável · tenta de novo amanhã");
    expect(linha.pilula).toEqual({ texto: "Instável", tom: "aviso" });
  });

  it("aberta: 'Atualizando… N%', sem pílula", () => {
    expect(runLine({ ...base, finishedAt: null, progressPct: 40, status: null })).toEqual({
      texto: "Atualizando… 40%",
      pilula: null,
    });
  });

  it.each([
    ["chaves_invalidas", "As chaves do Meu Pluggy não valem mais"],
    ["sem_chaves", "Faltam as chaves do Meu Pluggy"],
    ["autorizacao_vencida", "Autorização vencida no Meu Pluggy"],
    ["consentimento_vencido", "Consentimento vencido"],
    ["item_inexistente", "Banco não encontrado no Meu Pluggy"],
    ["desconectado", "Parou: banco desconectado"],
    ["qualquer_outro", "Não deu para atualizar"],
  ])("erro %s: texto da spec e pílula Erro", (codigo, texto) => {
    const linha = runLine({ ...base, status: "erro", errorCode: codigo });
    expect(linha.texto).toBe(texto);
    expect(linha.pilula).toEqual({ texto: "Erro", tom: "falta" });
  });
});

describe("quandoDaExecucao", () => {
  const AGORA = new Date("2026-11-12T15:00:00.000Z");
  it("hoje, ontem e uma data antiga", () => {
    expect(quandoDaExecucao("2026-11-12T03:12:00.000Z", AGORA)).toBe("Hoje, 00:12");
    expect(quandoDaExecucao("2026-11-11T03:09:00.000Z", AGORA)).toBe("Ontem, 00:09");
    expect(quandoDaExecucao("2026-10-30T03:15:00.000Z", AGORA)).toBe("30/10, 00:15");
  });
});

describe("freshnessPill e bankStatusPill", () => {
  it("em dia com a atualização de hoje ou de ontem; atrasada com mais de um dia ou sem nenhuma", () => {
    expect(freshnessPill("2026-11-12T03:12:00.000Z", HOJE)).toEqual({ texto: "Em dia", tom: "sucesso" });
    expect(freshnessPill("2026-11-11T03:12:00.000Z", HOJE)).toEqual({ texto: "Em dia", tom: "sucesso" });
    expect(freshnessPill("2026-11-10T03:12:00.000Z", HOJE)).toEqual({ texto: "Atrasada", tom: "aviso" });
    expect(freshnessPill(null, HOJE)).toEqual({ texto: "Atrasada", tom: "aviso" });
  });

  it("o selo do banco: desconectado tem prioridade; depois instável, precisa de atenção e conectado", () => {
    expect(bankStatusPill({ status: "ativo", disconnectedAt: "2026-11-01T00:00:00.000Z" }).texto).toBe(
      "Desconectado",
    );
    expect(bankStatusPill({ status: "instavel", disconnectedAt: null }).texto).toBe("Instável");
    expect(bankStatusPill({ status: "acao_necessaria", disconnectedAt: null }).texto).toBe(
      "Precisa de atenção",
    );
    expect(bankStatusPill({ status: "ativo", disconnectedAt: null })).toEqual({
      texto: "Conectado",
      tom: "sucesso",
    });
  });
});
