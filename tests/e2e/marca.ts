import { readFileSync } from "node:fs";
import { join } from "node:path";

// Marca do build de teste (dev/marca.json): os textos esperados vêm dela, e não de um literal nos testes.
export const marca = JSON.parse(readFileSync(join(process.cwd(), "dev", "marca.json"), "utf8")) as {
  name: string;
};
