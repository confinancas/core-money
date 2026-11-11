// Portas do E2E: a única fonte delas (TASK-0008). Lidas por scripts/dev/e2e-server.mjs, playwright.config.ts,
// tests/e2e/helpers/db.ts e scripts/dev/anthropic-stub.mjs. Node puro, sem compilação; os tipos vêm de e2e-portas.d.mts.
//
// Sem MM_E2E_PORTA_BASE, a base é 8788 e as portas são as de sempre. Com ela, o bloco são 10 portas a partir da base:
//   base              instalação pronta (baseURL e webServer do Playwright)
//   base + 1          stub do serviço de IA
//   base + 2          configuração do zero
//   base + 3          reservada para o Meu Pluggy falso (TASK-0203)
//   base + 4          inspeção da instalação pronta
//   base + 5          inspeção da configuração do zero
//   base + 6 a + 9    livres, para serviços falsos futuros
// A faixa da base vai de 1024 a 49142: o bloco inteiro fica abaixo de 49152, onde começam as portas efêmeras.

const PORTA_PADRAO = 8788;
const PORTA_MINIMA = 1024;
const PORTA_MAXIMA = 49142;

export function portasDoE2E(entrada) {
  const base = leBase(entrada);
  return {
    base,
    instalacaoPronta: base,
    stub: base + 1,
    configuracao: base + 2,
    pluggy: base + 3,
    inspecaoInstalacaoPronta: base + 4,
    inspecaoConfiguracao: base + 5,
  };
}

function leBase(entrada) {
  if (entrada === undefined) return PORTA_PADRAO;
  const numero = Number(entrada);
  // Forma: o texto tem que ser exatamente o que Number devolve. Recusa o vazio (vira 0), espaço, sinal, zero à
  // esquerda, letra, hexadecimal e notação científica.
  if (String(numero) !== entrada) recusa(entrada);
  // Inteiro: recusa a fração (8788.5).
  if (!Number.isInteger(numero)) recusa(entrada);
  if (numero < PORTA_MINIMA) recusa(entrada);
  if (numero > PORTA_MAXIMA) recusa(entrada);
  return numero;
}

function recusa(entrada) {
  throw new Error(
    `MM_E2E_PORTA_BASE inválida (${JSON.stringify(entrada)}): use um inteiro de ${PORTA_MINIMA} a ${PORTA_MAXIMA}, ou tire a variável para usar ${PORTA_PADRAO}.`,
  );
}
