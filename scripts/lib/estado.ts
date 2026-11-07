import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Estado local da instalação: sem segredo. Fica na pasta oculta do app, que o .gitignore do app ignora (TASK-0101).
export type EstadoDaInstalacao = {
  nome: string;
  databaseName: string;
  databaseId: string;
  url: string;
  contaId: string;
  atualizadoEm: string;
};

// Pasta oculta com o id da marca (o id vem do marca.json do app).
export function caminhoDoEstado(pastaApp: string, idDaMarca: string): string {
  return join(pastaApp, `.${idDaMarca}`, "instalacao.json");
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
  const databaseName = textoDe(registro.databaseName);
  const databaseId = textoDe(registro.databaseId);
  const url = textoDe(registro.url);
  const contaId = textoDe(registro.contaId);
  const atualizadoEm = textoDe(registro.atualizadoEm);
  if (!nome || !databaseName || !databaseId || !url || !contaId || !atualizadoEm) return null;
  return { nome, databaseName, databaseId, url, contaId, atualizadoEm };
}

export function gravaEstado(caminho: string, estado: EstadoDaInstalacao): void {
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, `${JSON.stringify(estado, null, 2)}\n`);
}
