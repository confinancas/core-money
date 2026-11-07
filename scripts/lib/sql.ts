// SQL montado pelos scripts de instalação (TASK-0101). Só entra valor gerado aqui ou id lido do banco, e cada valor
// passa por uma regex antes de virar literal. Nada digitado pela pessoa vai para o SQL.

export const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const FORMATO_HASH = /^[0-9a-f]{64}$/;
export const FORMATO_INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const FORMATO_ID_DO_BANCO = /^[A-Za-z0-9_-]{1,64}$/;

export function literal(valor: string, formato: RegExp): string {
  if (!formato.test(valor)) {
    throw new Error("valor fora do formato esperado no SQL");
  }
  return `'${valor}'`;
}

export function sqlContaPrimeirosAcessosUsados(): string {
  return "SELECT COUNT(*) AS n FROM invites WHERE kind='primeiro_acesso' AND used_at IS NOT NULL";
}

export function sqlCancelaPrimeirosAcessosAbertos(agora: string): string {
  return `UPDATE invites SET cancelled_at = ${literal(agora, FORMATO_INSTANTE)} WHERE kind='primeiro_acesso' AND used_at IS NULL AND cancelled_at IS NULL`;
}

export function sqlInserePrimeiroAcesso(dados: { id: string; hash: string; criadoEm: string }): string {
  return `INSERT INTO invites (id, household_id, kind, token_hash, created_at) VALUES (${literal(dados.id, FORMATO_UUID)}, NULL, 'primeiro_acesso', ${literal(dados.hash, FORMATO_HASH)}, ${literal(dados.criadoEm, FORMATO_INSTANTE)})`;
}

export function sqlListaMembros(): string {
  return "SELECT id, household_id, name, role FROM members ORDER BY created_at";
}

export function sqlCancelaRecuperacoesAbertas(memberId: string, agora: string): string {
  return `UPDATE invites SET cancelled_at = ${literal(agora, FORMATO_INSTANTE)} WHERE kind='recuperacao' AND member_id=${literal(memberId, FORMATO_ID_DO_BANCO)} AND used_at IS NULL AND cancelled_at IS NULL`;
}

export function sqlInsereRecuperacao(dados: {
  id: string;
  householdId: string;
  hash: string;
  memberId: string;
  criadoEm: string;
  expiraEm: string;
}): string {
  return `INSERT INTO invites (id, household_id, kind, token_hash, member_id, created_by, created_at, expires_at) VALUES (${literal(dados.id, FORMATO_UUID)}, ${literal(dados.householdId, FORMATO_ID_DO_BANCO)}, 'recuperacao', ${literal(dados.hash, FORMATO_HASH)}, ${literal(dados.memberId, FORMATO_ID_DO_BANCO)}, NULL, ${literal(dados.criadoEm, FORMATO_INSTANTE)}, ${literal(dados.expiraEm, FORMATO_INSTANTE)})`;
}
