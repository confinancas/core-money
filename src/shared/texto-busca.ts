// Busca de regras sem acento (TASK-0305, rodada 1, F4). O termo e a chave do casamento saem sem acento e em maiúsculas
// A-Z, dos dois lados. O UPPER do SQLite não mexe em letra acentuada, por isso a chave passa pelo mesmo mapa de
// REPLACE (minúsculas e maiúsculas) antes de comparar. O lado SQL e o lado JS usam a mesma lista de letras.

// Letras do português com acento, e a letra sem acento de cada uma (minúsculas e maiúsculas).
const PARES: ReadonlyArray<readonly [string, string]> = [
  ["á", "a"],
  ["à", "a"],
  ["â", "a"],
  ["ã", "a"],
  ["é", "e"],
  ["ê", "e"],
  ["í", "i"],
  ["ó", "o"],
  ["ô", "o"],
  ["õ", "o"],
  ["ú", "u"],
  ["ç", "c"],
  ["Á", "A"],
  ["À", "A"],
  ["Â", "A"],
  ["Ã", "A"],
  ["É", "E"],
  ["Ê", "E"],
  ["Í", "I"],
  ["Ó", "O"],
  ["Ô", "O"],
  ["Õ", "O"],
  ["Ú", "U"],
  ["Ç", "C"],
];

// Termo da busca: sem acento, em maiúsculas, com tudo que não é A–Z ou 0–9 trocado por espaço (assim "pag*jose" acha
// "PAG JOSEDASILVA"). Sem espaços repetidos nem nas pontas.
export function termoDeBusca(texto: string): string {
  let semAcento = texto;
  for (const [com, sem] of PARES) semAcento = semAcento.split(com).join(sem);
  return semAcento
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

// Expressão SQL que tira o acento da coluna (ou expressão) dada. A ordem das trocas não importa: cada letra acentuada
// vira a sua letra base, e o resultado vai para UPPER no SQL de quem chama.
export function semAcentoSql(expressao: string): string {
  return PARES.reduce((sql, [com, sem]) => `REPLACE(${sql}, '${com}', '${sem}')`, expressao);
}
