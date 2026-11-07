import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import { type Meter, meteredD1 } from "./metered-d1";
import * as schema from "./schema";

// $client é o binding medido (o drizzle() o devolve); o lar usa o batch dele para o INSERT condicional.
export type Db = DrizzleD1Database<typeof schema> & { $client: D1Database };

export function createDb(d1: D1Database, meter: Meter): Db {
  return drizzle(meteredD1(d1, meter), { schema });
}
