import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Dados da marca do app, lidos do marca.json da pasta de onde o comando foi rodado (TASK-0101).
// O núcleo não escreve o nome do produto: as mensagens usam marca.name.
export type Marca = { id: string; name: string; workerName: string };

// Erro de uso: a mensagem já diz o que fazer, e o comando sai com código 1.
export class ErroDeUso extends Error {}

export const NOME_DO_WORKER = /^[a-z0-9-]{1,40}$/;

export function validaNomeDoWorker(nome: string): string {
  if (!NOME_DO_WORKER.test(nome)) {
    throw new ErroDeUso("Nome inválido: use só letras minúsculas, números e hífen, com até 40 caracteres.");
  }
  return nome;
}

export function lerMarca(pastaApp: string): Marca {
  const caminho = join(pastaApp, "marca.json");
  if (!existsSync(caminho)) {
    throw new ErroDeUso("Sem marca.json nesta pasta: rode este comando na raiz do seu app.");
  }
  let dados: unknown;
  try {
    dados = JSON.parse(readFileSync(caminho, "utf8"));
  } catch {
    throw new ErroDeUso("O marca.json desta pasta não é um JSON válido.");
  }
  const registro = (dados ?? {}) as Record<string, unknown>;
  const { id, name, workerName } = registro;
  if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) {
    throw new ErroDeUso("O marca.json precisa de um id com letras minúsculas, números e hífen.");
  }
  if (typeof name !== "string" || name.trim() === "") {
    throw new ErroDeUso("O marca.json precisa de um name.");
  }
  if (typeof workerName !== "string") {
    throw new ErroDeUso("O marca.json precisa de um workerName.");
  }
  validaNomeDoWorker(workerName);
  return { id, name, workerName };
}
