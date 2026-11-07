#!/usr/bin/env node
// Falha se o build de produção (dist/client) trouxer o catálogo do design system.
// O catálogo só existe em `npm run dev` e no build --mode e2e. Procura o texto cru e a forma com escapes \uXXXX.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const saida = join(raiz, "dist", "client");
const proibidos = ["Catálogo do design system", "/dev/catalogo"];

function escaparNaoAscii(texto) {
  return [...texto]
    .map((caractere) => {
      const codigo = caractere.charCodeAt(0);
      return codigo > 127 ? `\\u${codigo.toString(16).padStart(4, "0")}` : caractere;
    })
    .join("");
}

function variantes(texto) {
  return [...new Set([texto, escaparNaoAscii(texto), texto.replaceAll("/", "\\/")])];
}

function arquivosEm(pasta) {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    return statSync(caminho).isDirectory() ? arquivosEm(caminho) : [caminho];
  });
}

try {
  statSync(saida);
} catch {
  console.error(`check-build: ${saida} não existe. Rode npm run build antes.`);
  process.exit(1);
}

const arquivos = arquivosEm(saida);
const achados = [];

for (const arquivo of arquivos) {
  const conteudo = readFileSync(arquivo, "utf8");
  for (const proibido of proibidos) {
    for (const forma of variantes(proibido)) {
      if (conteudo.includes(forma)) achados.push(`${arquivo}: "${proibido}"`);
    }
  }
}

if (achados.length > 0) {
  console.error("check-build: o catálogo do design system entrou no build de produção:");
  for (const achado of achados) console.error(`  ${achado}`);
  process.exit(1);
}

console.log(`check-build: ok, nenhum trecho do catálogo em dist/client (${arquivos.length} arquivos).`);
