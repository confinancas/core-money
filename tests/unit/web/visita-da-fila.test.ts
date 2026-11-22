import { beforeEach, describe, expect, it } from "vitest";
import {
  CAMINHO_DA_FILA,
  CHAVE_DA_VISITA,
  encerrarVisitaForaDaFila,
  gravarVisita,
  lerVisita,
} from "../../../src/web/screens/para-categorizar/visita";

// Visita da fila Para categorizar (TASK-0304): sobrevive à remontagem no caminho da fila e acaba fora dele.
const VISITA = { confirmadas: [{ chave: "[TEST] linha" }], total: 2 };

describe("visita da fila", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("grava no caminho da fila e lê de volta, como na remontagem por largura", () => {
    gravarVisita(VISITA, CAMINHO_DA_FILA);
    expect(lerVisita()).toEqual(VISITA);
  });

  it("não grava fora do caminho da fila: uma gravação atrasada depois da navegação não traz a visita de volta", () => {
    gravarVisita(VISITA, "/inicio");
    expect(sessionStorage.getItem(CHAVE_DA_VISITA)).toBeNull();
    expect(lerVisita()).toEqual({ confirmadas: [], total: null });
  });

  it("a moldura encerra a visita em qualquer caminho fora da fila", () => {
    gravarVisita(VISITA, CAMINHO_DA_FILA);
    encerrarVisitaForaDaFila("/inicio");
    expect(lerVisita()).toEqual({ confirmadas: [], total: null });
  });

  it("no caminho da fila, a moldura mantém a visita", () => {
    gravarVisita(VISITA, CAMINHO_DA_FILA);
    encerrarVisitaForaDaFila(CAMINHO_DA_FILA);
    expect(lerVisita()).toEqual(VISITA);
  });
});
