import { describe, expect, it } from "vitest";
import { colunasDasSecoes, SETTINGS_SECTIONS, type SettingsSection } from "@/screens/configuracoes/sections";

// Registro das seções de Configurações (TASK-0107): ordem e colunas por largura (tabela da spec), ids únicos e o
// encaixe de uma seção nova (cenário 11). A distribuição é a das telas de 390, 834 e 1440 px. As seções Contas Meu
// Pluggy (TASK-0203) e Renda fixa (TASK-0901) entram no registro com a posição da tabela.
const ids = (coluna: SettingsSection[]) => coluna.map((secao) => secao.id);
const SecaoDeTeste = () => null;

describe("registro de seções", () => {
  it("registra as seções das tasks 0107, 0203, 0802, 0901 e 0701, com ids únicos", () => {
    const registradas = SETTINGS_SECTIONS.map((secao) => secao.id);

    expect(registradas).toEqual([
      "casal",
      "contas-meu-pluggy",
      "ciclo",
      "distribuicao-da-renda",
      "renda-fixa",
      "notificacoes",
      "sincronizacao",
      "dados",
    ]);
    expect(new Set(registradas).size).toBe(registradas.length);
  });

  it("tem os títulos e as ordens da tabela da spec", () => {
    const tabela = SETTINGS_SECTIONS.map((secao) => [secao.id, secao.title, secao.order]);

    expect(tabela).toEqual([
      ["casal", "Casal", 10],
      ["contas-meu-pluggy", "Contas Meu Pluggy", 20],
      ["ciclo", "Ciclo e orçamento", 30],
      ["distribuicao-da-renda", "Distribuição da renda", 40],
      ["renda-fixa", "Renda fixa", 50],
      ["notificacoes", "Notificações", 70],
      ["sincronizacao", "Sincronização", 80],
      ["dados", "Dados", 90],
    ]);
  });
});

describe("colunas por largura", () => {
  it("celular: uma coluna, na ordem da tabela", () => {
    const colunas = colunasDasSecoes(SETTINGS_SECTIONS, "celular");

    expect(colunas.map(ids)).toEqual([
      [
        "casal",
        "contas-meu-pluggy",
        "ciclo",
        "distribuicao-da-renda",
        "renda-fixa",
        "notificacoes",
        "sincronizacao",
        "dados",
      ],
    ]);
  });

  it("tablet: duas colunas; Casal, Contas, Ciclo e Distribuição na primeira, Renda fixa, Notificações, Sincronização e Dados na segunda", () => {
    const colunas = colunasDasSecoes(SETTINGS_SECTIONS, "tablet");

    expect(colunas.map(ids)).toEqual([
      ["casal", "contas-meu-pluggy", "ciclo", "distribuicao-da-renda"],
      ["renda-fixa", "notificacoes", "sincronizacao", "dados"],
    ]);
  });

  it("desktop: três colunas, Casal e Contas à esquerda, Ciclo, Distribuição e Renda fixa no meio, Notificações, Sincronização e Dados à direita", () => {
    const colunas = colunasDasSecoes(SETTINGS_SECTIONS, "desktop");

    expect(colunas.map(ids)).toEqual([
      ["casal", "contas-meu-pluggy"],
      ["ciclo", "distribuicao-da-renda", "renda-fixa"],
      ["notificacoes", "sincronizacao", "dados"],
    ]);
  });

  it("cenário 11: uma seção falsa com order 25 entra entre Contas e Ciclo, na coluna indicada", () => {
    // order 25, e não 20: a seção Contas Meu Pluggy ocupa o 20 (TASK-0203), e o encaixe continua entre dois vizinhos.
    const falsa: SettingsSection = {
      id: "falsa-de-teste",
      title: "Falsa de teste",
      order: 25,
      tabletColumn: 2,
      desktopColumn: 2,
      Component: SecaoDeTeste,
    };
    const registro = [...SETTINGS_SECTIONS, falsa];

    expect(colunasDasSecoes(registro, "celular").map(ids)).toEqual([
      [
        "casal",
        "contas-meu-pluggy",
        "falsa-de-teste",
        "ciclo",
        "distribuicao-da-renda",
        "renda-fixa",
        "notificacoes",
        "sincronizacao",
        "dados",
      ],
    ]);
    expect(colunasDasSecoes(registro, "tablet").map(ids)).toEqual([
      ["casal", "contas-meu-pluggy", "ciclo", "distribuicao-da-renda"],
      ["falsa-de-teste", "renda-fixa", "notificacoes", "sincronizacao", "dados"],
    ]);
    expect(colunasDasSecoes(registro, "desktop").map(ids)).toEqual([
      ["casal", "contas-meu-pluggy"],
      ["falsa-de-teste", "ciclo", "distribuicao-da-renda", "renda-fixa"],
      ["notificacoes", "sincronizacao", "dados"],
    ]);
  });
});
