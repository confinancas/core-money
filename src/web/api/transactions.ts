import {
  type CorpoDoPatch,
  type DetalheDaCompra,
  DetalheDaCompraSchema,
} from "../../shared/api/transactions";
import { apiEnviar, apiFetch } from "../lib/api";

// Compra (TASK-0403): o detalhe e o PATCH, conferidos pelo schema da spec. A regra de nome nas próximas é um POST em
// /api/rules, o mesmo da categorização (TASK-0302), com createdFrom "lembrar" e só o nome.

export async function fetchTransaction(transacaoId: string): Promise<DetalheDaCompra> {
  const corpo = await apiFetch<unknown>(`/api/transactions/${encodeURIComponent(transacaoId)}`);
  return DetalheDaCompraSchema.parse(corpo);
}

export async function patchTransaction(transacaoId: string, corpo: CorpoDoPatch): Promise<DetalheDaCompra> {
  const resposta = await apiFetch<unknown>(`/api/transactions/${encodeURIComponent(transacaoId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return DetalheDaCompraSchema.parse(resposta);
}

// Usar o nome nas próximas da mesma chave (estabelecimento, na compra): cria ou mescla a regra só com o nome.
export function criarRegraDoNome(transacaoId: string, nome: string): Promise<unknown> {
  return apiEnviar<unknown>("/api/rules", "POST", {
    transactionId: transacaoId,
    set: { customName: nome },
    createdFrom: "lembrar",
  });
}
