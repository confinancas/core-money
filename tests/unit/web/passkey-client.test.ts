import { describe, expect, it } from "vitest";
import { mensagemDaPasskey, PasskeyIndisponivelError } from "@/access/passkey-client";
import { ApiError } from "@/lib/api";
import { brand } from "../../../src/shared/brand";

// Uma linha da tabela de mensagens do cadastro (TASK-0103) por caso.
const comCausa = (nome: string) => new Error("cerimônia", { cause: new DOMException("x", nome) });

describe("mensagemDaPasskey", () => {
  it("navegador sem passkey", () => {
    expect(mensagemDaPasskey(new PasskeyIndisponivelError())).toEqual({
      mensagem:
        "Este navegador não cria passkeys. Use o Safari no iPhone, o Chrome no Android ou um navegador atualizado no computador.",
      acao: null,
    });
  });

  it("passkey cancelada ou tempo esgotado (NotAllowedError, direto ou na causa)", () => {
    const texto =
      "A criação da passkey foi cancelada ou o tempo acabou. Toque em Criar passkey para tentar de novo.";
    expect(mensagemDaPasskey(new DOMException("cancelada", "NotAllowedError"))).toEqual({
      mensagem: texto,
      acao: null,
    });
    expect(mensagemDaPasskey(comCausa("NotAllowedError")).mensagem).toBe(texto);
  });

  it("passkey já existente neste aparelho (InvalidStateError)", () => {
    expect(mensagemDaPasskey(new DOMException("já", "InvalidStateError")).mensagem).toBe(
      `Este aparelho já tem uma passkey sua neste ${brand.name}.`,
    );
  });

  it("desafio vencido", () => {
    expect(mensagemDaPasskey(new ApiError(400, "desafio_expirado", "x"))).toEqual({
      mensagem: "Demorou demais. Toque em Criar passkey de novo.",
      acao: null,
    });
  });

  it("lar já criado em outro aparelho leva a entrar", () => {
    expect(mensagemDaPasskey(new ApiError(409, "lar_ja_existe", "x"))).toEqual({
      mensagem: "A conta do casal acabou de ser criada em outro aparelho. Entre com a passkey de quem criou.",
      acao: "entrar",
    });
  });

  it("código de primeiro acesso ausente leva à configuração", () => {
    expect(mensagemDaPasskey(new ApiError(403, "codigo_necessario", "x")).acao).toBe("configuracao");
  });

  it("qualquer outro erro", () => {
    expect(mensagemDaPasskey(new ApiError(400, "passkey_invalida", "x"))).toEqual({
      mensagem: "Não deu para criar a passkey agora. Tente de novo.",
      acao: null,
    });
    expect(mensagemDaPasskey(new Error("sem nome"))).toEqual({
      mensagem: "Não deu para criar a passkey agora. Tente de novo.",
      acao: null,
    });
  });
});
