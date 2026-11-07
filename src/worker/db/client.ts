import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import { type Meter, meteredD1 } from "./metered-d1";
import * as schema from "./schema";

export type Db = DrizzleD1Database<typeof schema>;

export function createDb(d1: D1Database, meter: Meter): Db {
  return drizzle(meteredD1(d1, meter), { schema });
}
