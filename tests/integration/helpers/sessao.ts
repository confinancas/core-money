import { env } from "cloudflare:test";
import { sha256Hex } from "../../../src/shared/access-code";
import type { SessionResolver } from "../../../src/worker/household/context";

// Sessão de teste (TASK-0104): um lar [TEST] com o titular, a passkey dele e a sessão com um token fixo. Só dados
// de teste; o token é falso e serve só para o cookie desta suíte.
export const TOKEN_DE_TESTE = "TESTE-SESSAO-0104-token-fixo-de-teste-000";
export const ID_DA_PASSKEY_DE_TESTE = "cred-TEST-0104-01";
export const COOKIE_DE_SESSAO_DE_TESTE = `mm_sess=${TOKEN_DE_TESTE}`;

const ISO = (data: Date) => data.toISOString();
const horasAtras = (horas: number) => ISO(new Date(Date.now() - horas * 60 * 60 * 1000));

export type LarDeTeste = { householdId: string; memberId: string; passkeyId: string };

// Lar, titular e passkey do cadastro. O id da passkey e a chave pública são falsos por padrão (o login real fica
// nos testes que assinam a asserção de verdade).
export async function semearLar(
  d1: D1Database,
  opcoes: { nome?: string; email?: string; memberId?: string; passkeyId?: string; publicKey?: string } = {},
): Promise<LarDeTeste> {
  const householdId = crypto.randomUUID();
  const memberId = opcoes.memberId ?? crypto.randomUUID();
  const passkeyId = opcoes.passkeyId ?? ID_DA_PASSKEY_DE_TESTE;
  const agora = ISO(new Date());
  await d1.batch([
    d1
      .prepare("INSERT INTO households (id, brand, created_at) VALUES (?, 'matrimoney', ?)")
      .bind(householdId, agora),
    d1
      .prepare(
        "INSERT INTO members (id, household_id, name, email, role, created_at) VALUES (?, ?, ?, ?, 'titular', ?)",
      )
      .bind(
        memberId,
        householdId,
        opcoes.nome ?? "[TEST] Pessoa A",
        opcoes.email ?? "pessoa.a@example.com",
        agora,
      ),
    d1
      .prepare(
        "INSERT INTO passkeys (id, member_id, public_key, counter, transports, device_name, added_via, created_at, last_used_at) VALUES (?, ?, ?, 3, '[\"internal\"]', 'iPhone · Safari', 'cadastro', ?, NULL)",
      )
      .bind(passkeyId, memberId, opcoes.publicKey ?? "PUBLICA-TEST-0104", agora),
  ]);
  return { householdId, memberId, passkeyId };
}

// Sessão com um token dado (o padrão é o token fixo de teste). O banco guarda o sha256 do token.
export async function semearSessao(
  d1: D1Database,
  opcoes: {
    memberId: string;
    passkeyId: string;
    token?: string;
    ultimoUsoHaHoras?: number;
    expiraEmHoras?: number;
  },
): Promise<string> {
  const token = opcoes.token ?? TOKEN_DE_TESTE;
  const ultimoUso = horasAtras(opcoes.ultimoUsoHaHoras ?? 0);
  const expira =
    opcoes.expiraEmHoras === undefined
      ? ISO(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
      : ISO(new Date(Date.now() + opcoes.expiraEmHoras * 60 * 60 * 1000));
  await d1
    .prepare(
      "INSERT INTO sessions (token_hash, member_id, passkey_id, created_at, last_seen_at, expires_at, notices_seen_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
    )
    .bind(await sha256Hex(token), opcoes.memberId, opcoes.passkeyId, ultimoUso, ultimoUso, expira)
    .run();
  return token;
}

// Valor de um cookie emitido pela resposta (Set-Cookie), sem os atributos; null quando não veio.
export function valorDoCookie(resposta: Response, nome: string): string | null {
  for (const cabecalho of resposta.headers.getSetCookie()) {
    if (cabecalho.startsWith(`${nome}=`)) return cabecalho.slice(nome.length + 1).split(";")[0] ?? "";
  }
  return null;
}

// O cabeçalho Set-Cookie inteiro do cookie, para ver os atributos (Max-Age, Path, SameSite...).
export function cabecalhoDoCookie(resposta: Response, nome: string): string | null {
  return resposta.headers.getSetCookie().find((texto) => texto.startsWith(`${nome}=`)) ?? null;
}

export async function contaSql(sql: string, ...valores: unknown[]): Promise<number> {
  const linha = await env.DB.prepare(sql)
    .bind(...valores)
    .first<{ n: number }>();
  return linha?.n ?? 0;
}

// Resolvedor fixo para os testes que não são sobre a sessão (settings, assistente, erros, configuração): a identidade
// vem sem cookie, como nos testes do lar. Os 401 e a sessão de verdade ficam em session-guard e login.
export const RESOLVEDOR_DE_TESTE: SessionResolver = async () => ({
  memberId: "[TEST] membro-de-teste",
  householdId: "[TEST] lar-de-teste",
});
