import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Rodada 2 (TASK-0902): uma lista só de movimentos de entrada (item 10), e nenhum texto de extrato com o nome de quem
// paga nos testes e no arquivo de medição (item 11). São conferências do código-fonte: falham antes da correção.
const raiz = new URL("../../", import.meta.url);
const ler = (arquivo: string): string => readFileSync(new URL(arquivo, raiz), "utf8");

describe("uma lista só de movimentos de entrada (item 10)", () => {
  it("o pipeline e o recasamento usam INCOME_CANDIDATE_MOVEMENTS, sem a lista escrita à mão", () => {
    for (const arquivo of ["src/worker/categorization/pipeline.ts", "src/worker/income/statement-match.ts"]) {
      const texto = ler(arquivo);
      expect(texto, arquivo).toContain("INCOME_CANDIDATE_MOVEMENTS");
      expect(texto, arquivo).not.toContain("'pix_recebido', 'ted_recebida', 'outro'");
    }
  });
});

describe("texto de extrato genérico nos testes e no arquivo de medição (item 11)", () => {
  it("nenhum dos arquivos da task traz o nome de quem paga", () => {
    for (const arquivo of [
      "tests/integration/fixed-income-receipts.test.ts",
      "tests/integration/fx-cron.test.ts",
      "tests/integration/cron-despachante.test.ts",
      "tests/e2e/renda-fixa-cotacao.spec.ts",
      "tests/cpu/TASK-0902.json",
    ]) {
      expect(ler(arquivo), arquivo).not.toContain("HIGLOBE");
    }
  });
});
