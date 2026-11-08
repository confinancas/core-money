// Regra da renovação da sessão (TASK-0104), pura: sem banco e sem cookie, para o teste unitário.
// A sessão se renova quando a última visita tem mais de 24 h ("mais de": 24 h exatas ainda não renovam).
// Abaixo disso, a requisição não escreve nada no banco.
const RENOVA_DEPOIS_DE_MS = 24 * 60 * 60 * 1000;

export function shouldRenew(lastSeenAt: string, agora: Date): boolean {
  return agora.getTime() - Date.parse(lastSeenAt) > RENOVA_DEPOIS_DE_MS;
}
