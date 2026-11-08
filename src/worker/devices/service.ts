// Aparelhos do lar (TASK-0106): a lista de cada pessoa, a remoção (que encerra as sessões do aparelho) e o aparelho
// novo. Uma consulta para a lista; a remoção é um lote, para que a sessão e a passkey saiam juntas.
import type { AparelhoDaPessoa, ComoFoiAdicionado, PessoaComAparelhos } from "../../shared/devices";
import type { registrationOptions } from "../auth/webauthn";

export const SQL_APARELHOS_DO_LAR =
  "SELECT m.id AS member_id, m.name AS member_name, m.role AS member_role, p.id AS passkey_id, p.device_name, p.added_via, p.created_at AS passkey_created_at, p.last_used_at FROM members m LEFT JOIN passkeys p ON p.member_id = m.id WHERE m.household_id = ? ORDER BY m.created_at, p.created_at";

export type LinhaDoLar = {
  member_id: string;
  member_name: string;
  member_role: string;
  passkey_id: string | null;
  device_name: string | null;
  added_via: string | null;
  passkey_created_at: string | null;
  last_used_at: string | null;
};

// Agrupa as linhas por pessoa, na ordem da consulta. Uma pessoa sem aparelho sai com a lista vazia.
export function agrupaAparelhos(
  linhas: LinhaDoLar[],
  eu: string,
  passkeyDestaSessao: string | undefined,
): PessoaComAparelhos[] {
  const pessoas = new Map<string, PessoaComAparelhos>();
  for (const linha of linhas) {
    let pessoa = pessoas.get(linha.member_id);
    if (!pessoa) {
      pessoa = {
        id: linha.member_id,
        name: linha.member_name,
        role: linha.member_role === "conjuge" ? "conjuge" : "titular",
        isMe: linha.member_id === eu,
        devices: [],
      };
      pessoas.set(linha.member_id, pessoa);
    }
    if (linha.passkey_id !== null) {
      pessoa.devices.push({
        id: linha.passkey_id,
        deviceName: linha.device_name ?? "",
        addedVia: (linha.added_via ?? "cadastro") as ComoFoiAdicionado,
        createdAt: linha.passkey_created_at ?? "",
        lastUsedAt: linha.last_used_at,
        isCurrent: linha.passkey_id === passkeyDestaSessao,
      } satisfies AparelhoDaPessoa);
    }
  }
  return [...pessoas.values()];
}

// A passkey é de uma pessoa do lar? Só então ela pode ser removida (o lar é o da sessão).
export const SQL_APARELHO_DO_LAR =
  "SELECT p.id, m.household_id FROM passkeys p JOIN members m ON m.id = p.member_id WHERE p.id = ?";

// Remove a passkey e as sessões ligadas a ela, num lote. Devolve false quando a passkey já não existia (outra
// requisição a removeu antes): o DELETE da passkey não mudou linha nenhuma.
export async function removeAparelho(d1: D1Database, passkeyId: string): Promise<boolean> {
  const [, passkey] = await d1.batch([
    d1.prepare("DELETE FROM sessions WHERE passkey_id = ?").bind(passkeyId),
    d1.prepare("DELETE FROM passkeys WHERE id = ?").bind(passkeyId),
  ]);
  return passkey?.meta.changes === 1;
}

export type PasskeyDaPessoa = { id: string; transports: string | null };

// As passkeys de uma pessoa: o navegador recusa criar uma passkey que já está nesta lista (excludeCredentials).
export async function passkeysDaPessoa(d1: D1Database, memberId: string): Promise<PasskeyDaPessoa[]> {
  const { results } = await d1
    .prepare("SELECT id, transports FROM passkeys WHERE member_id = ? ORDER BY created_at")
    .bind(memberId)
    .all<PasskeyDaPessoa>();
  return results;
}

// A forma que a opção de registro pede (excludeCredentials), a partir das passkeys guardadas.
type ItemDeExcludeCredentials = NonNullable<NonNullable<Parameters<typeof registrationOptions>[2]>[number]>;

export function excludeCredentialsDe(passkeys: PasskeyDaPessoa[]): ItemDeExcludeCredentials[] {
  return passkeys.map((passkey) => ({
    id: passkey.id,
    transports:
      passkey.transports === null
        ? undefined
        : (JSON.parse(passkey.transports) as ItemDeExcludeCredentials["transports"]),
  }));
}
