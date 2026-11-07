import { readFileSync } from "node:fs";
import { join } from "node:path";

// Os defines do preset (__BRAND__, __DEV_ROUTES__) não chegam aos projetos do Vitest 4: sem isto, os testes
// do front não acham as globais. Aqui entram os mesmos valores do build de desenvolvimento do núcleo.
// O Vitest roda a partir da raiz do repositório.
const marca = JSON.parse(readFileSync(join(process.cwd(), "dev", "marca.json"), "utf8"));

Object.assign(globalThis, { __BRAND__: marca, __DEV_ROUTES__: true });
