import { describe, expect, it } from "vitest";
import { itemValido, soItensValidos } from "@/screens/notificacoes/validos";
import type { ListaDeNotificacoes, NotificacaoDaLista } from "../../../../src/shared/notifications/api";

// Um item que a tela não consegue mostrar some da lista, e o resto aparece (rodada 1, robustez).
const item = (sobrescritos: Partial<NotificacaoDaLista>): NotificacaoDaLista => ({
  id: "id-de-teste",
  kind: "vencimento",
  title: "[TEST] Fatura de teste",
  body: "[TEST] corpo",
  link: "/contas",
  createdAt: "2026-11-10T11:00:00.000Z",
  ...sobrescritos,
});

describe("itemValido", () => {
  it("aceita um tipo do catálogo com data válida", () => {
    expect(itemValido(item({}))).toBe(true);
  });

  it("recusa um tipo fora do catálogo", () => {
    expect(itemValido(item({ kind: "tipo_que_nao_existe" as NotificacaoDaLista["kind"] }))).toBe(false);
  });

  it("recusa uma data de criação inválida", () => {
    expect(itemValido(item({ createdAt: "não é data" }))).toBe(false);
  });
});

describe("soItensValidos", () => {
  it("tira o item fora do esperado e mantém o resto, nas duas listas", () => {
    const lista: ListaDeNotificacoes = {
      unreadCount: 3,
      new: [
        item({ id: "boa-nova", title: "[TEST] Boa nova" }),
        item({ id: "ruim-tipo", kind: "tipo_que_nao_existe" as NotificacaoDaLista["kind"] }),
      ],
      previous: [
        item({ id: "ruim-data", createdAt: "não é data" }),
        item({ id: "boa-anterior", title: "[TEST] Boa anterior" }),
      ],
    };

    const filtrada = soItensValidos(lista);

    expect(filtrada.new.map((linha) => linha.id)).toEqual(["boa-nova"]);
    expect(filtrada.previous.map((linha) => linha.id)).toEqual(["boa-anterior"]);
    expect(filtrada.unreadCount).toBe(3);
  });
});
