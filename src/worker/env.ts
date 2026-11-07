import type { BrandConfig } from "../shared/brand/types";
import type { Db } from "./db/client";
import type { Meter } from "./db/metered-d1";
import type { SessionIdentity } from "./household/context";

export type Env = { DB: D1Database; PLUGGY_BASE_URL?: string };

export type AppEnv = {
  Bindings: Env;
  Variables: { db: Db; meter: Meter; marca: BrandConfig; versao: string; session?: SessionIdentity };
};
