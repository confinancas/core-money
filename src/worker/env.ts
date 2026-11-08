import type { BrandConfig } from "../shared/brand/types";
import type { Db } from "./db/client";
import type { Meter } from "./db/metered-d1";
import type { SessionIdentity } from "./household/context";

// MASTER_KEY: base64 de 32 bytes, o secret do Worker que cifra as chaves no banco (ADR-004).
// ANTHROPIC_BASE_URL: só o E2E aponta para o stub local; em produção fica o endereço oficial.
// PLUGGY_BASE_URL: só o E2E e os testes apontam para o servidor local; em produção fica o endereço oficial.
// SETUP_SEM_CACHE: "1" nas instâncias de teste que voltam à configuração do zero (E2E de 8790 e o Worker de medição):
// o portão não guarda "pronto" no módulo, então o D1 pode voltar a cadastro no mesmo processo (TASK-0103).
export type Env = {
  DB: D1Database;
  MASTER_KEY: string;
  ANTHROPIC_BASE_URL?: string;
  PLUGGY_BASE_URL?: string;
  SETUP_SEM_CACHE?: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { db: Db; meter: Meter; marca: BrandConfig; versao: string; session?: SessionIdentity };
};
