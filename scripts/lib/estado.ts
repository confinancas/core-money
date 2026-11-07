import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Estado local da instalação: sem segredo. Fica em .core-money/instalacao.json, pasta fixa e neutra, que o
// .gitignore do app ignora (TASK-0101). O campo marca (o id do marca.json) deixa a TASK-1101 ver de qual marca é a instalação.
export type EstadoDaInstalacao = {
  nome: string;
  marca: string;
  databaseName: string;
  databaseId: string;
  url: string;
  contaId: string;
  atualizadoEm: string;
};

export const PASTA_DO_ESTADO = ".core-money";

// Caminho fixo, igual para qualquer marca: o id da marca vai no JSON, não no nome da pasta.
export function caminhoDoEstado(pastaApp: string): string {
  return join(pastaApp, PASTA_DO_ESTADO, "instalacao.json");
}

const textoDe = (valor: unknown): string | undefined => (typeof valor === "string" ? valor : undefined);

export function lerEstado(caminho: string): EstadoDaInstalacao | null {
  if (!existsSync(caminho)) return null;
  let dados: unknown;
  try {
    dados = JSON.parse(readFileSync(caminho, "utf8"));
  } catch {
    return null;
  }
  const registro = (dados ?? {}) as Record<string, unknown>;
  const nome = textoDe(registro.nome);
  const marca = textoDe(registro.marca);
  const databaseName = textoDe(registro.databaseName);
  const databaseId = textoDe(registro.databaseId);
  const url = textoDe(registro.url);
  const contaId = textoDe(registro.contaId);
  const atualizadoEm = textoDe(registro.atualizadoEm);
  if (!nome || !marca || !databaseName || !databaseId || !url || !contaId || !atualizadoEm) return null;
  return { nome, marca, databaseName, databaseId, url, contaId, atualizadoEm };
}

export function gravaEstado(caminho: string, estado: EstadoDaInstalacao): void {
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, `${JSON.stringify(estado, null, 2)}\n`);
}
