import type { BrandConfig } from "../shared/brand/types";
import type { Db } from "./db/client";
import type { Meter } from "./db/metered-d1";

export type Env = { DB: D1Database };

export type AppEnv = {
  Bindings: Env;
  Variables: { db: Db; meter: Meter; marca: BrandConfig; versao: string };
};
