import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { executaSql } from "./db";

// Sessão da instalação pronta, para os testes que passam pelas rotas da moldura (TASK-0104).
// O lar, a pessoa, a passkey e a sessão [TEST] são semeados uma vez, pelo global setup; cada página põe o cookie.
// O cadastro de verdade (com o autenticador virtual) roda na instância de configuração do zero, em login.spec.ts.
export const LAR_DA_INSTALACAO_PRONTA = "e2e-lar-pronto";
export const TOKEN_DE_SESSAO_E2E = "E2E-SESSAO-0104-token-de-teste-0000000001";
const HASH_DA_SESSAO_E2E = createHash("sha256").update(TOKEN_DE_SESSAO_E2E).digest("hex");

// Semeia o lar da instalação pronta: um titular, a passkey dele e a sessão. Idempotente: pode rodar de novo.
export function semeiaSessaoDaInstalacaoPronta(): void {
  const agora = new Date();
  const agoraIso = agora.toISOString();
  const expira = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  executaSql(
    "pronta",
    [
      `INSERT OR IGNORE INTO households (id, brand, created_at) VALUES ('${LAR_DA_INSTALACAO_PRONTA}', 'matrimoney', '${agoraIso}')`,
      `INSERT OR IGNORE INTO members (id, household_id, name, email, role, created_at) VALUES ('e2e-pessoa-pronta', '${LAR_DA_INSTALACAO_PRONTA}', '[TEST] Pessoa A', 'pessoa.a@example.com', 'titular', '${agoraIso}')`,
      `INSERT OR IGNORE INTO passkeys (id, member_id, public_key, counter, transports, device_name, added_via, created_at, last_used_at) VALUES ('e2e-passkey-pronta', 'e2e-pessoa-pronta', 'PUBLICA-TEST-E2E', 0, NULL, 'E2E Chromium', 'cadastro', '${agoraIso}', NULL)`,
      `INSERT OR REPLACE INTO sessions (token_hash, member_id, passkey_id, created_at, last_seen_at, expires_at, notices_seen_at) VALUES ('${HASH_DA_SESSAO_E2E}', 'e2e-pessoa-pronta', 'e2e-passkey-pronta', '${agoraIso}', '${agoraIso}', '${expira}', NULL)`,
    ].join("; "),
  );
}

// Põe o cookie da sessão de teste na página (cada teste tem um contexto novo). A sessão já está no banco pelo global
// setup. Decisão de nível 1 (TASK-0104): na instância pronta o cadastro não roda (ela já está pronta), então o teste
// entra pela sessão semeada.
export async function signUpAndSignIn(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "mm_sess",
      value: TOKEN_DE_SESSAO_E2E,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
