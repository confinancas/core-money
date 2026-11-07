import {
  IconeBarras,
  IconeCartao,
  IconeCasa,
  IconeEngrenagem,
  IconeSetaParaBaixo,
  IconeSetaParaCima,
} from "@/components/icons";
import type { Aba } from "./aba";

// Itens do menu, na ordem do celular sem a IA (Início, Cartões, Contas, IA, Renda, Relatório, Configurações).
export type ItemDeMenu = {
  aba: Exclude<Aba, "ia">;
  caminho: string;
  nome: string;
  rotuloAcessivel: string;
  Icone: typeof IconeCasa;
};

export const ITENS_DE_MENU: ItemDeMenu[] = [
  { aba: "inicio", caminho: "/inicio", nome: "Início", rotuloAcessivel: "Início", Icone: IconeCasa },
  { aba: "cartoes", caminho: "/cartoes", nome: "Cartões", rotuloAcessivel: "Cartões", Icone: IconeCartao },
  {
    aba: "contas",
    caminho: "/contas",
    nome: "Contas do mês",
    rotuloAcessivel: "Contas do mês (despesas)",
    Icone: IconeSetaParaCima,
  },
  { aba: "renda", caminho: "/renda", nome: "Renda", rotuloAcessivel: "Renda", Icone: IconeSetaParaBaixo },
  {
    aba: "relatorio",
    caminho: "/relatorio",
    nome: "Relatório",
    rotuloAcessivel: "Relatório",
    Icone: IconeBarras,
  },
  {
    aba: "configuracoes",
    caminho: "/configuracoes",
    nome: "Configurações",
    rotuloAcessivel: "Configurações",
    Icone: IconeEngrenagem,
  },
];

export const CAMINHO_DA_IA = "/assistente";
