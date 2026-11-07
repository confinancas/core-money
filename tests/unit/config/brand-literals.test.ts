import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A marca vem do marca.json do app: o código não escreve o nome do produto nem o nome de quem usa.
const raiz = fileURLToPath(new URL("../../../", import.meta.url));

function arquivosEm(pasta: string): string[] {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    return statSync(caminho).isDirectory() ? arquivosEm(caminho) : [caminho];
  });
}

const arquivosDoFront = [...arquivosEm(join(raiz, "src")), join(raiz, "index.html")];

describe("marca", () => {
  it("nenhum 'Matrimoney' literal em src/ nem no index.html", () => {
    const achados = arquivosDoFront.filter((arquivo) => readFileSync(arquivo, "utf8").includes("Matrimoney"));

    expect(achados).toEqual([]);
  });

  it("nenhum nome de pessoa do protótipo em src/ nem no index.html", () => {
    const nomes = ["Gustavo", "Angela"];
    const achados = arquivosDoFront.filter((arquivo) => {
      const conteudo = readFileSync(arquivo, "utf8");
      return nomes.some((nome) => conteudo.includes(nome));
    });

    expect(achados).toEqual([]);
  });

  it("src/worker importa da marca só o tipo (types), nunca src/shared/brand/index", () => {
    const importacoes = arquivosEm(join(raiz, "src", "worker")).flatMap((arquivo) => {
      const conteudo = readFileSync(arquivo, "utf8");
      return [...conteudo.matchAll(/from\s+["']([^"']*shared\/brand[^"']*)["']/g)].map((casa) => casa[1]);
    });

    expect(importacoes.length).toBeGreaterThan(0);
    expect(importacoes.filter((caminho) => !/\/brand\/types$/.test(caminho))).toEqual([]);
  });
});
