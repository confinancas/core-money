import { describe, expect, it } from "vitest";
import { inviteStatus, paraConvite } from "../../../src/worker/invites/status";

// Situação de um convite de cônjuge (TASK-0105): usado, cancelado, vencido ou aguardando, nessa ordem.
const AGORA = new Date("2026-11-08T12:00:00.000Z");
const VENCE_DEPOIS = "2026-11-15T12:00:00.000Z";
const VENCEU_ANTES = "2026-11-01T12:00:00.000Z";
const NA_HORA_EXATA = "2026-11-08T12:00:00.000Z";
const USADO = "2026-11-07T10:00:00.000Z";
const CANCELADO = "2026-11-07T11:00:00.000Z";

const base = { used_at: null, cancelled_at: null, expires_at: VENCE_DEPOIS };

describe("inviteStatus", () => {
  it.each([
    ["aguardando: sem uso, sem cancelamento e com vencimento no futuro", base, "aguardando"],
    ["vencido: o vencimento passou", { ...base, expires_at: VENCEU_ANTES }, "vencido"],
    ["vencido na hora exata: expires_at igual a agora", { ...base, expires_at: NA_HORA_EXATA }, "vencido"],
    ["cancelado: cancelled_at preenchido", { ...base, cancelled_at: CANCELADO }, "cancelado"],
    ["usado: used_at preenchido", { ...base, used_at: USADO }, "usado"],
    [
      "usado vem antes de cancelado e de vencido",
      { used_at: USADO, cancelled_at: CANCELADO, expires_at: VENCEU_ANTES },
      "usado",
    ],
    [
      "cancelado vem antes de vencido",
      { ...base, cancelled_at: CANCELADO, expires_at: VENCEU_ANTES },
      "cancelado",
    ],
    ["sem vencimento gravado: vence (falha fechada)", { ...base, expires_at: null }, "vencido"],
  ])("%s", (_descricao, convite, esperado) => {
    expect(inviteStatus(convite, AGORA)).toBe(esperado);
  });

  it("o vencimento compara instantes, não texto: fuso diferente do UTC vence na mesma hora", () => {
    // 12:00 em São Paulo (UTC-3) é 15:00 UTC: está vencido às 12:00 UTC, mas ainda vale às 14:59 UTC.
    const vencimento = "2026-11-08T12:00:00.000-03:00";
    expect(inviteStatus({ ...base, expires_at: vencimento }, new Date("2026-11-08T14:59:00.000Z"))).toBe(
      "aguardando",
    );
    expect(inviteStatus({ ...base, expires_at: vencimento }, new Date("2026-11-08T15:00:00.000Z"))).toBe(
      "vencido",
    );
  });
});

describe("paraConvite", () => {
  it("devolve só os campos da spec, sem o hash nem o link", () => {
    const dto = paraConvite({
      id: "convite-1",
      household_id: "lar-1",
      kind: "conjuge",
      token_hash: "hash-do-token",
      invitee_name: "[TEST] Pessoa B",
      invitee_email: "pessoa.b@example.com",
      created_by: "membro-1",
      created_at: "2026-11-08T12:00:00.000Z",
      expires_at: VENCE_DEPOIS,
      used_at: null,
      cancelled_at: null,
      created_by_name: "[TEST] Pessoa A",
    });
    expect(dto).toEqual({
      id: "convite-1",
      kind: "conjuge",
      name: "[TEST] Pessoa B",
      email: "pessoa.b@example.com",
      expiresAt: VENCE_DEPOIS,
      createdByName: "[TEST] Pessoa A",
    });
    expect(JSON.stringify(dto)).not.toContain("hash");
  });
});
