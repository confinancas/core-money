import { describe, expect, it } from "vitest";
import {
  connectionLabelSchema,
  itemIdsSchema,
  MENSAGEM_CLIENT_ID,
  MENSAGEM_CLIENT_SECRET,
  MENSAGEM_ROTULO_PROIBIDO,
  pluggyKeysSchema,
} from "../../../src/shared/pluggy-api";

const ID_VALIDO = "11111111-1111-4111-8111-111111111111";

describe("connectionLabelSchema", () => {
  it("aceita um nome de quem é a conta e tira as pontas", () => {
    expect(connectionLabelSchema.parse("  Conta Angela  ")).toBe("Conta Angela");
    expect(connectionLabelSchema.parse("[TEST] Conta A").length).toBeGreaterThan(0);
  });

  it("recusa vazio e acima de 40 caracteres", () => {
    expect(connectionLabelSchema.safeParse("   ").success).toBe(false);
    expect(connectionLabelSchema.safeParse("x".repeat(41)).success).toBe(false);
    expect(connectionLabelSchema.safeParse("x".repeat(40)).success).toBe(true);
  });

  it("recusa 'sua conta', 'minha conta' e 'conta' sozinho, sem diferenciar maiúsculas", () => {
    for (const proibido of ["Sua conta", "minha CONTA", "conta", "  Conta  "]) {
      const resultado = connectionLabelSchema.safeParse(proibido);
      expect(resultado.success).toBe(false);
      expect(resultado.error?.issues[0]?.message).toBe(MENSAGEM_ROTULO_PROIBIDO);
    }
  });

  it("aceita 'conta' quando vem junto de outra palavra", () => {
    expect(connectionLabelSchema.safeParse("Conta conjunta").success).toBe(true);
  });
});

describe("pluggyKeysSchema", () => {
  it("aceita um UUID e um segredo de 8 a 200 caracteres sem espaço", () => {
    expect(pluggyKeysSchema.safeParse({ clientId: ID_VALIDO, clientSecret: "segredo-8" }).success).toBe(true);
    expect(pluggyKeysSchema.safeParse({ clientId: ID_VALIDO, clientSecret: "s".repeat(200) }).success).toBe(
      true,
    );
  });

  it("recusa Client ID que não é UUID, com a mensagem do campo", () => {
    const resultado = pluggyKeysSchema.safeParse({ clientId: "nao-e-uuid", clientSecret: "segredo-8" });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual(["clientId"]);
    expect(resultado.error?.issues[0]?.message).toBe(MENSAGEM_CLIENT_ID);
  });

  it("recusa segredo curto, longo ou com espaço", () => {
    for (const secret of ["curto", "s".repeat(201), "com espaco no meio"]) {
      const resultado = pluggyKeysSchema.safeParse({ clientId: ID_VALIDO, clientSecret: secret });
      expect(resultado.success).toBe(false);
      expect(resultado.error?.issues[0]?.message).toBe(MENSAGEM_CLIENT_SECRET);
    }
  });

  it("recusa campo ausente", () => {
    expect(pluggyKeysSchema.safeParse({ clientId: ID_VALIDO }).success).toBe(false);
  });
});

describe("itemIdsSchema", () => {
  it("aceita de 1 a 5 ids e recusa 0 ou 6", () => {
    expect(itemIdsSchema.safeParse([ID_VALIDO]).success).toBe(true);
    expect(itemIdsSchema.safeParse([ID_VALIDO, ID_VALIDO, ID_VALIDO, ID_VALIDO, ID_VALIDO]).success).toBe(
      true,
    );
    expect(itemIdsSchema.safeParse([]).success).toBe(false);
    expect(itemIdsSchema.safeParse(Array(6).fill(ID_VALIDO)).success).toBe(false);
  });

  it("recusa id com espaço ou caractere estranho", () => {
    expect(itemIdsSchema.safeParse(["id com espaço"]).success).toBe(false);
    expect(itemIdsSchema.safeParse(["abc/../x"]).success).toBe(false);
  });
});
