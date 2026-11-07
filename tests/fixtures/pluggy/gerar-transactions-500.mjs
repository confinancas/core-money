// Gera transactions-500.json: 500 movimentos fictícios ([TEST], CPF 000.000.000-00), sem dado real.
// Determinístico: rodar de novo produz o mesmo arquivo. Uso: node tests/fixtures/pluggy/gerar-transactions-500.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const destino = join(dirname(fileURLToPath(import.meta.url)), "transactions-500.json");
const CONTA = "00000000-0000-4000-8000-000000000011";
const OPERACOES = ["PIX", "BOLETO", "CARTAO", "TED", "OUTROS"];

const results = [];
for (let i = 1; i <= 500; i++) {
  const mes = i % 2 === 0 ? "10" : "11";
  const dia = String(1 + (i % 28)).padStart(2, "0");
  const hora = i % 3 === 0 ? "T00:00:00.000Z" : "T03:00:00.000Z";
  const credito = i % 5 === 0;
  const magnitude = Number((((i * 37.13) % 900) + 1).toFixed(2));
  const pessoa = { name: "[TEST] Contraparte Teste", documentNumber: { type: "CPF", value: "00000000000" } };
  results.push({
    id: `00000000-0000-4100-8000-${String(i).padStart(12, "0")}`,
    accountId: CONTA,
    date: `2026-${mes}-${dia}${hora}`,
    description: `[TEST] Movimento ${String(i).padStart(3, "0")} Estabelecimento ${String((i % 40) + 1).padStart(2, "0")}`,
    descriptionRaw: null,
    amount: credito ? magnitude : -magnitude,
    currencyCode: "BRL",
    type: credito ? "CREDIT" : "DEBIT",
    status: i % 50 === 0 ? "PENDING" : "POSTED",
    category: "Shopping",
    categoryId: null,
    operationType: OPERACOES[i % OPERACOES.length],
    providerId: null,
    paymentData: credito
      ? { payer: pessoa, receiver: null, paymentMethod: "PIX" }
      : { payer: null, receiver: pessoa, paymentMethod: null },
    creditCardMetadata: null,
  });
}

writeFileSync(destino, `${JSON.stringify({ results, next: null })}\n`);
console.log(`gravado: ${results.length} movimentos`);
