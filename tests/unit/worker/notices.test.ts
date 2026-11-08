import { describe, expect, it } from "vitest";
import {
  avisosDeAparelhoNovo,
  type PasskeyParaAviso,
  type SessaoParaAviso,
} from "../../../src/worker/devices/notices";

// Filtro dos avisos de aparelho novo (TASK-0106), função pura. Os casos da spec: outra passkey, antes e depois do
// "Foi eu" (notices_seen_at), e um added_via que não é recuperação.

const SESSAO: SessaoParaAviso = {
  memberId: "pessoa-b",
  passkeyId: "passkey-do-aparelho-antigo",
  createdAt: "2026-11-08T10:00:00.000Z",
  noticesSeenAt: null,
};

const recuperada = (sobrescreve: Partial<PasskeyParaAviso> = {}): PasskeyParaAviso => ({
  id: "passkey-do-aparelho-novo",
  memberId: "pessoa-b",
  addedVia: "recuperacao",
  deviceName: "iPhone · Safari",
  createdAt: "2026-11-08T11:00:00.000Z",
  ...sobrescreve,
});

describe("avisosDeAparelhoNovo", () => {
  it("avisa do aparelho recuperado depois que a sessão começou", () => {
    expect(avisosDeAparelhoNovo([recuperada()], SESSAO)).toEqual([
      {
        kind: "aparelho_novo",
        passkeyId: "passkey-do-aparelho-novo",
        deviceName: "iPhone · Safari",
        createdAt: "2026-11-08T11:00:00.000Z",
      },
    ]);
  });

  it("não avisa do aparelho desta própria sessão", () => {
    const deste = recuperada({ id: SESSAO.passkeyId });
    expect(avisosDeAparelhoNovo([deste], SESSAO)).toEqual([]);
  });

  it("não avisa de um aparelho criado antes de a sessão começar", () => {
    const antes = recuperada({ createdAt: "2026-11-08T09:00:00.000Z" });
    expect(avisosDeAparelhoNovo([antes], SESSAO)).toEqual([]);
  });

  it("uma passkey criada no mesmo instante que a sessão não avisa (o corte é estrito)", () => {
    const mesmoInstante = recuperada({ createdAt: SESSAO.createdAt });
    expect(avisosDeAparelhoNovo([mesmoInstante], SESSAO)).toEqual([]);
  });

  it("depois do 'Foi eu' (notices_seen_at), o aviso some; um aparelho criado depois dele volta a avisar", () => {
    const vista = { ...SESSAO, noticesSeenAt: "2026-11-08T11:30:00.000Z" };
    expect(avisosDeAparelhoNovo([recuperada()], vista)).toEqual([]);
    const depois = recuperada({ id: "outra", createdAt: "2026-11-08T12:00:00.000Z" });
    expect(avisosDeAparelhoNovo([recuperada(), depois], vista).map((aviso) => aviso.passkeyId)).toEqual([
      "outra",
    ]);
  });

  it("não avisa de passkey de outra pessoa do lar", () => {
    const doOutro = recuperada({ memberId: "pessoa-a" });
    expect(avisosDeAparelhoNovo([doOutro], SESSAO)).toEqual([]);
  });

  it("não avisa de um aparelho que entrou por outro caminho (cadastro, convite ou aparelho)", () => {
    const porAparelho = recuperada({ addedVia: "aparelho" });
    const porConvite = recuperada({ id: "x", addedVia: "convite" });
    expect(avisosDeAparelhoNovo([porAparelho, porConvite], SESSAO)).toEqual([]);
  });

  it("vários avisos saem em ordem de criação", () => {
    const segunda = recuperada({ id: "b", createdAt: "2026-11-08T13:00:00.000Z" });
    const primeira = recuperada({ id: "a", createdAt: "2026-11-08T12:00:00.000Z" });
    expect(avisosDeAparelhoNovo([segunda, primeira], SESSAO).map((aviso) => aviso.passkeyId)).toEqual([
      "a",
      "b",
    ]);
  });
});
