import { describe, expect, it } from "vitest";
import { colunasDasSecoes, SETTINGS_SECTIONS, type SettingsSection } from "@/screens/configuracoes/sections";

// Registro das seções de Configurações (TASK-0107): ordem e colunas por largura (tabela da spec), ids únicos e o
// encaixe de uma seção nova (cenário 11). A distribuição é a das telas de 390, 834 e 1440 px.
const ids = (coluna: SettingsSection[]) => coluna.map((secao) => secao.id);
const SecaoDeTeste = () => null;

describe("registro de seções", () => {
  it("registra as seções das tasks 0107, 0802 e 0109, com ids únicos", () => {
    const registradas = SETTINGS_SECTIONS.map((secao) => secao.id);

    expect(registradas).toEqual([
      "casal",
      "ciclo",
      "distribuicao-da-renda",
      "sincronizacao",
      "plano-cloudflare",
      "dados",
    ]);
    expect(new Set(registradas).size).toBe(registradas.length);
  });

  it("tem os títulos e as ordens da tabela da spec", () => {
    const tabela = SETTINGS_SECTIONS.map((secao) => [secao.id, secao.title, secao.order]);

    expect(tabela).toEqual([
      ["casal", "Casal", 10],
      ["ciclo", "Ciclo e orçamento", 30],
      ["distribuicao-da-renda", "Distribuição da renda", 40],
      ["sincronizacao", "Sincronização", 80],
      ["plano-cloudflare", "Plano da Cloudflare", 85],
      ["dados", "Dados", 90],
    ]);
  });
});

describe("colunas por largura", () => {
  it("celular: uma coluna, na ordem da tabela", () => {
    const colunas = colunasDasSecoes(SETTINGS_SECTIONS, "celular");

    expect(colunas.map(ids)).toEqual([
      ["casal", "ciclo", "distribuicao-da-renda", "sincronizacao", "plano-cloudflare", "dados"],
    ]);
  });

  it("tablet: duas colunas; Casal, Ciclo e Distribuição na primeira, Sincronização e Dados na segunda", () => {
    const colunas = colunasDasSecoes(SETTINGS_SECTIONS, "tablet");

    expect(colunas.map(ids)).toEqual([
      ["casal", "ciclo", "distribuicao-da-renda"],
      ["sincronizacao", "plano-cloudflare", "dados"],
    ]);
  });

  it("desktop: três colunas, Casal à esquerda, Ciclo e Distribuição no meio, Sincronização e Dados à direita", () => {
    const colunas = colunasDasSecoes(SETTINGS_SECTIONS, "desktop");

    expect(colunas.map(ids)).toEqual([
      ["casal"],
      ["ciclo", "distribuicao-da-renda"],
      ["sincronizacao", "plano-cloudflare", "dados"],
    ]);
  });

  it("cenário 11: uma seção falsa com order 20 entra entre Casal e Ciclo, na coluna indicada", () => {
    const falsa: SettingsSection = {
      id: "falsa-de-teste",
      title: "Falsa de teste",
      order: 20,
      tabletColumn: 2,
      desktopColumn: 2,
      Component: SecaoDeTeste,
    };
    const registro = [...SETTINGS_SECTIONS, falsa];

    expect(colunasDasSecoes(registro, "celular").map(ids)).toEqual([
      [
        "casal",
        "falsa-de-teste",
        "ciclo",
        "distribuicao-da-renda",
        "sincronizacao",
        "plano-cloudflare",
        "dados",
      ],
    ]);
    expect(colunasDasSecoes(registro, "tablet").map(ids)).toEqual([
      ["casal", "ciclo", "distribuicao-da-renda"],
      ["falsa-de-teste", "sincronizacao", "plano-cloudflare", "dados"],
    ]);
    expect(colunasDasSecoes(registro, "desktop").map(ids)).toEqual([
      ["casal"],
      ["falsa-de-teste", "ciclo", "distribuicao-da-renda"],
      ["sincronizacao", "plano-cloudflare", "dados"],
    ]);
  });
});
