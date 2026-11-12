import { describe, expect, it } from "vitest";
import { semAcentoSql, termoDeBusca } from "../../../src/shared/texto-busca";

// F4 (TASK-0305, rodada 1): a busca de regras não diferencia acento nem caixa, e o símbolo vira espaço.
describe("termoDeBusca", () => {
  it("tira acento e põe em maiúsculas", () => {
    expect(termoDeBusca("joão")).toBe("JOAO");
    expect(termoDeBusca("JOÃO")).toBe("JOAO");
    expect(termoDeBusca("Conceição")).toBe("CONCEICAO");
    expect(termoDeBusca("joao")).toBe("JOAO");
  });

  it("símbolo vira espaço e some das pontas", () => {
    expect(termoDeBusca("pag*jose")).toBe("PAG JOSE");
    expect(termoDeBusca("  pag*jose  ")).toBe("PAG JOSE");
    expect(termoDeBusca("%_")).toBe("");
  });
});

describe("semAcentoSql", () => {
  it("embrulha a expressão em REPLACE e não deixa de fora nenhuma das letras", () => {
    const sql = semAcentoSql("r.match_value");
    expect(sql.startsWith("REPLACE(")).toBe(true);
    for (const letra of ["ã", "ç", "Ã", "Ç", "é", "Ó"]) expect(sql).toContain(`'${letra}'`);
  });
});
