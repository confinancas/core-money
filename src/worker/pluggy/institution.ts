// Banco e resumo de uma conexão do Meu Pluggy (TASK-0203). Funções puras: recebem o item e as contas já lidas.
import { BANKS, institutionFromText } from "../../shared/bank-codes";
import type { PluggyAccount, PluggyItem } from "./types";

export const COR_PADRAO_DO_BANCO = "#0E9A63";
// Conector do Meu Pluggy (o item é um espelho: o nome do banco está nas contas).
export const CONECTOR_MEU_PLUGGY = 200;

export type InstituicaoDoItem = { name: string | null; color: string };

const corDoBancoPeloNome = (nome: string | null): string | null =>
  nome === null ? null : (BANKS.find((banco) => banco.name === nome)?.color ?? null);

// Conector comum: o nome e a cor do próprio conector. Meu Pluggy: o banco sai do texto das contas.
export function institutionFromItem(item: PluggyItem, accounts: PluggyAccount[]): InstituicaoDoItem {
  if (item.connector.id !== CONECTOR_MEU_PLUGGY) {
    const nome = item.connector.name;
    const primaria = item.connector.primaryColor?.trim();
    const cor = primaria ? (primaria.startsWith("#") ? primaria : `#${primaria}`) : null;
    return { name: nome, color: cor ?? corDoBancoPeloNome(nome) ?? COR_PADRAO_DO_BANCO };
  }

  for (const conta of accounts) {
    for (const texto of [conta.marketingName, conta.name]) {
      if (typeof texto !== "string" || texto.trim() === "") continue;
      const banco = institutionFromText(texto);
      if (banco !== null) return { name: banco.name, color: banco.color };
    }
  }
  return { name: null, color: COR_PADRAO_DO_BANCO };
}

// "Conta corrente", "poupança" e "cartão final NNNN", unidos por vírgula e "e". Sem repetição.
export function accountsSummary(accounts: PluggyAccount[]): string {
  const partes: string[] = [];
  const adicionar = (parte: string) => {
    if (!partes.includes(parte)) partes.push(parte);
  };
  for (const conta of accounts) {
    if (conta.type === "CREDIT") {
      const finais = (conta.number ?? "").replace(/\D/g, "").slice(-4);
      adicionar(finais === "" ? "cartão" : `cartão final ${finais}`);
    } else if (conta.subtype === "SAVINGS_ACCOUNT") {
      adicionar("poupança");
    } else {
      adicionar("Conta corrente");
    }
  }
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}
