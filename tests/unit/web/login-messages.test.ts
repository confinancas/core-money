import { describe, expect, it } from "vitest";
import { brand } from "../../../src/shared/brand";
import { mensagemDoLogin, PasskeyIndisponivelError } from "../../../src/web/access/passkey-client";
import { ApiError } from "../../../src/web/lib/api";

// Tabela de mensagens da entrada (TASK-0104): uma mensagem por situação.
const erroDoNavegador = (nome: string) =>
  Object.assign(new Error("cancelado pelo navegador"), { name: nome });

describe("mensagemDoLogin", () => {
  it.each([
    [
      "sem PublicKeyCredential",
      new PasskeyIndisponivelError(),
      "Este navegador não usa passkeys. Use o Safari no iPhone, o Chrome no Android ou um navegador atualizado no computador.",
    ],
    [
      "NotAllowedError",
      erroDoNavegador("NotAllowedError"),
      `A entrada foi cancelada, ou este aparelho não tem uma passkey do ${brand.name}. Tente de novo ou use o QR code com o celular.`,
    ],
    [
      "passkey_desconhecida",
      new ApiError(401, "passkey_desconhecida", "x"),
      "Essa passkey não vale mais: o aparelho foi removido. Entre com outro aparelho ou peça um link de recuperação.",
    ],
    [
      "passkey_nao_confere",
      new ApiError(401, "passkey_nao_confere", "x"),
      "A passkey não conferiu. Tente de novo.",
    ],
    [
      "desafio_expirado",
      new ApiError(400, "desafio_expirado", "x"),
      "Demorou demais. Toque em Entrar com passkey de novo.",
    ],
    [
      "outro erro da API",
      new ApiError(500, "erro_interno", "x"),
      "Não deu para entrar agora. Tente de novo.",
    ],
    ["erro sem forma conhecida", new Error("rede"), "Não deu para entrar agora. Tente de novo."],
  ])("%s", (_, erro, esperada) => {
    expect(mensagemDoLogin(erro)).toBe(esperada);
  });
});
