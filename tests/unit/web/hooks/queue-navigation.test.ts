import { describe, expect, it } from "vitest";
import { nextInQueue, withQueueParam } from "../../../../src/web/hooks/useQueueNavigation";

// Modo fila (TASK-0404): a ordem da fila é local_date desc e id desc. Itens de teste [TEST].
const item = (id: string, localDate: string) => ({
  transactionId: id,
  localDate,
  detailPath: `/pix/${id}`,
});

describe("nextInQueue", () => {
  const fila = [item("c", "2026-11-10"), item("b", "2026-11-09"), item("a", "2026-11-08")];

  it("no meio: devolve o item seguinte da lista", () => {
    expect(nextInQueue(fila, { id: "c", localDate: "2026-11-10" })?.transactionId).toBe("b");
  });

  it("no fim: sem depois, devolve o primeiro diferente do atual", () => {
    expect(nextInQueue(fila, { id: "a", localDate: "2026-11-08" })?.transactionId).toBe("c");
  });

  it("atual removido da fila: devolve o primeiro da lista", () => {
    // Removido e mais novo que toda a fila: o primeiro da lista vem depois dele.
    expect(nextInQueue(fila, { id: "zz", localDate: "2026-11-12" })?.transactionId).toBe("c");
  });

  it("mesma data com ids diferentes: o id menor vem depois", () => {
    const mesmaData = [item("d", "2026-11-10"), item("b", "2026-11-10"), item("a", "2026-11-10")];
    expect(nextInQueue(mesmaData, { id: "d", localDate: "2026-11-10" })?.transactionId).toBe("b");
    expect(nextInQueue(mesmaData, { id: "b", localDate: "2026-11-10" })?.transactionId).toBe("a");
  });

  it("lista vazia ou só o atual: null", () => {
    expect(nextInQueue([], { id: "a", localDate: "2026-11-08" })).toBeNull();
    expect(nextInQueue([item("a", "2026-11-08")], { id: "a", localDate: "2026-11-08" })).toBeNull();
  });
});

describe("withQueueParam", () => {
  it("acrescenta ?fila=1 em pix, compras e pix recebido", () => {
    expect(withQueueParam("/pix/t1")).toBe("/pix/t1?fila=1");
    expect(withQueueParam("/compras/t2")).toBe("/compras/t2?fila=1");
    expect(withQueueParam("/pix-recebido/t3")).toBe("/pix-recebido/t3?fila=1");
  });

  it("junta com query existente e não mexe em outro caminho", () => {
    expect(withQueueParam("/pix/t1?x=1")).toBe("/pix/t1?x=1&fila=1");
    expect(withQueueParam("/cartoes/c1")).toBe("/cartoes/c1");
  });
});
