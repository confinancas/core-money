// Registro das seções de Configurações (TASK-0107). Uma seção nova = um arquivo Section<Nome>.tsx + uma entrada aqui.
//
// Distribuição (ConfiguracoesTablet e ConfiguracoesDesktop do protótipo): celular, uma coluna pela ordem; tablet, duas
// colunas (tabletColumn); desktop, três colunas (desktopColumn). Dentro da coluna, a ordem é `order`.
//
// Tabela completa (as seções das outras tasks entram por elas, sem mexer no layout):
//   id                     título                 order  tablet  desktop  quem entrega
//   casal                  Casal                  10     1       1        esta task
//   contas-meu-pluggy      Contas Meu Pluggy      20     1       1        TASK-0203 (esta entrada)
//   ciclo                  Ciclo e orçamento      30     1       2        esta task
//   distribuicao-da-renda  Distribuição da renda  40     1       2        TASK-0802
//   renda-fixa             Renda fixa             50     2       2        TASK-0901
//   categorias-e-ia        Categorias e IA        60     2       2        TASK-0305
//   notificacoes           Notificações           70     2       3        TASK-0701
//   sincronizacao          Sincronização          80     2       3        esta task
//   plano-cloudflare       Plano da Cloudflare    85     2       3        TASK-0109
//   dados                  Dados                  90     2       3        esta task
//
// Esta task registra só as quatro suas. Encaixes dentro delas: o valor do limite (TASK-0803, em SectionCiclo), o
// subtítulo "Última: …" (TASK-0205, em SectionSincronizacao) e, em SectionDados, "Backup e restauração" (TASK-0108) e
// "Atualizar o app" (TASK-0112), acima de "Sair".
import type { FC } from "react";
import type { Largura } from "../../app/useBreakpoint";
import { SectionCasal } from "./SectionCasal";
import { SectionCategoriasEIA } from "./SectionCategoriasEIA";
import { SectionCiclo } from "./SectionCiclo";
import { SectionContasMeuPluggy } from "./SectionContasMeuPluggy";
import { SectionDados } from "./SectionDados";
import { SectionDistribuicaoRenda } from "./SectionDistribuicaoRenda";
import { SectionNotificacoes } from "./SectionNotificacoes";
import { SectionPlano } from "./SectionPlano";
import { SectionRendaFixa } from "./SectionRendaFixa";
import { SectionSincronizacao } from "./SectionSincronizacao";

export type SettingsSection = {
  id: string;
  title: string;
  order: number;
  tabletColumn: 1 | 2;
  desktopColumn: 1 | 2 | 3;
  Component: FC;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "casal", title: "Casal", order: 10, tabletColumn: 1, desktopColumn: 1, Component: SectionCasal },
  {
    id: "contas-meu-pluggy",
    title: "Contas Meu Pluggy",
    order: 20,
    tabletColumn: 1,
    desktopColumn: 1,
    Component: SectionContasMeuPluggy,
  },
  {
    id: "ciclo",
    title: "Ciclo e orçamento",
    order: 30,
    tabletColumn: 1,
    desktopColumn: 2,
    Component: SectionCiclo,
  },
  {
    id: "distribuicao-da-renda",
    title: "Distribuição da renda",
    order: 40,
    tabletColumn: 1,
    desktopColumn: 2,
    Component: SectionDistribuicaoRenda,
  },
  {
    id: "renda-fixa",
    title: "Renda fixa",
    order: 50,
    tabletColumn: 2,
    desktopColumn: 2,
    Component: SectionRendaFixa,
  },
  {
    id: "categorias-e-ia",
    title: "Categorias e IA",
    order: 60,
    tabletColumn: 2,
    desktopColumn: 2,
    Component: SectionCategoriasEIA,
  },
  {
    id: "notificacoes",
    title: "Notificações",
    order: 70,
    tabletColumn: 2,
    desktopColumn: 3,
    Component: SectionNotificacoes,
  },
  {
    id: "sincronizacao",
    title: "Sincronização",
    order: 80,
    tabletColumn: 2,
    desktopColumn: 3,
    Component: SectionSincronizacao,
  },
  {
    id: "plano-cloudflare",
    title: "Plano da Cloudflare",
    order: 85,
    tabletColumn: 2,
    desktopColumn: 3,
    Component: SectionPlano,
  },
  { id: "dados", title: "Dados", order: 90, tabletColumn: 2, desktopColumn: 3, Component: SectionDados },
];

// As seções de cada coluna, na ordem da largura: uma coluna no celular, duas no tablet, três no desktop.
export function colunasDasSecoes(secoes: SettingsSection[], largura: Largura): SettingsSection[][] {
  const ordenadas = [...secoes].sort((a, b) => a.order - b.order);
  if (largura === "celular") return [ordenadas];
  if (largura === "tablet")
    return [1, 2].map((coluna) => ordenadas.filter((secao) => secao.tabletColumn === coluna));
  return [1, 2, 3].map((coluna) => ordenadas.filter((secao) => secao.desktopColumn === coluna));
}
