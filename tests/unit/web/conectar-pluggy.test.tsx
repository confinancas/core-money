import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StepChaves } from "../../../src/web/screens/bancos/conectar/StepChaves";
import {
  autorizacaoDoBanco,
  cpfParaTela,
  erroDoRotulo,
  estadoDaConexao,
  legendaDoPasso,
  nomeSugerido,
  podeConectarBancos,
  podeContinuarDasChaves,
  siglaDoBanco,
  subtituloDoBanco,
  textoDoBotaoDeBancos,
  textoDoPassoPronto,
} from "../../../src/web/screens/bancos/conectar/view-model";

// Tela Conectar Meu Pluggy (TASK-0203): os textos dos passos, o botão de conectar e o "Continuar" das chaves.

const AGORA = new Date("2026-11-10T12:00:00.000Z");

afterEach(() => {
  cleanup();
});

describe("Conectar Meu Pluggy: textos dos passos", () => {
  it("legenda 'Passo N de 4 · <nome>' para os quatro passos", () => {
    expect(legendaDoPasso(1)).toBe("Passo 1 de 4 · Nome da conexão");
    expect(legendaDoPasso(2)).toBe("Passo 2 de 4 · Chaves da API");
    expect(legendaDoPasso(3)).toBe("Passo 3 de 4 · Escolher bancos");
    expect(legendaDoPasso(4)).toBe("Passo 4 de 4 · Pronto");
  });

  it("o nome sugerido é 'Conta ' + o primeiro nome, e some quando o nome já existe", () => {
    expect(nomeSugerido("Angela Costa", [])).toBe("Conta Angela");
    expect(nomeSugerido("Angela Costa", ["conta angela"])).toBe("");
    expect(nomeSugerido("  ", [])).toBe("");
  });

  it("o nome da conexão recusa os genéricos com a mensagem da spec", () => {
    expect(erroDoRotulo("Conta Angela")).toBeNull();
    expect(erroDoRotulo("Sua conta")).toBe("Use o nome de quem é a conta, para aparecer igual para os dois.");
    expect(erroDoRotulo("   ")).toBe("Dê um nome para a conexão.");
  });

  it("o passo 4 diz '1 banco entrou' ou 'N bancos entraram', com a frase do autoatendimento", () => {
    expect(textoDoPassoPronto(1)).toBe(
      "1 banco entrou no Matrimoney. A partir de agora, tudo se atualiza sozinho uma vez por dia.",
    );
    expect(textoDoPassoPronto(3)).toBe(
      "3 bancos entraram no Matrimoney. A partir de agora, tudo se atualiza sozinho uma vez por dia.",
    );
  });
});

describe("Conectar Meu Pluggy: botões", () => {
  it("'Escolha um banco' sem nenhum, 'Conectar 1 banco' e 'Conectar N bancos'", () => {
    expect(textoDoBotaoDeBancos(0)).toBe("Escolha um banco");
    expect(textoDoBotaoDeBancos(1)).toBe("Conectar 1 banco");
    expect(textoDoBotaoDeBancos(2)).toBe("Conectar 2 bancos");
  });

  it("só conecta com banco escolhido, e cada um sem nome deduzido precisa do nome digitado", () => {
    expect(podeConectarBancos([])).toBe(false);
    expect(podeConectarBancos([{ nomeDeduzido: "Itaú", nomeDigitado: "" }])).toBe(true);
    expect(podeConectarBancos([{ nomeDeduzido: null, nomeDigitado: "" }])).toBe(false);
    expect(podeConectarBancos([{ nomeDeduzido: null, nomeDigitado: "  Banco X  " }])).toBe(true);
  });

  it("'Continuar' das chaves só habilita depois do teste, e não enquanto envia", () => {
    expect(podeContinuarDasChaves(false, false)).toBe(false);
    expect(podeContinuarDasChaves(true, false)).toBe(true);
    expect(podeContinuarDasChaves(true, true)).toBe(false);
  });
});

describe("Conectar Meu Pluggy: o passo 2 na tela", () => {
  const base = {
    rotulo: "Conta Angela",
    chaves: { clientId: "", clientSecret: "" },
    aoMudar: () => undefined,
    testando: false,
    erro: null,
    salvando: false,
    aoTestar: () => undefined,
    aoContinuar: () => undefined,
    aoSalvar: () => undefined,
    aoVoltar: () => undefined,
  };

  it("'Continuar' fica travado até o teste, e vira '✓ Chaves funcionando' depois", () => {
    const { rerender } = render(<StepChaves {...base} modo="nova" testado={false} />);
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Testar chaves" })).toBeDisabled();

    rerender(
      <StepChaves {...base} chaves={{ clientId: "a", clientSecret: "b" }} modo="nova" testado={false} />,
    );
    expect(screen.getByRole("button", { name: "Testar chaves" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();

    rerender(<StepChaves {...base} chaves={{ clientId: "a", clientSecret: "b" }} modo="nova" testado />);
    expect(screen.getByRole("button", { name: "✓ Chaves funcionando" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
  });

  it("no modo trocar, o botão é 'Salvar chaves' e não há 'Continuar'", () => {
    render(
      <StepChaves {...base} modo="trocar" testado={false} chaves={{ clientId: "a", clientSecret: "b" }} />,
    );
    expect(screen.getByRole("button", { name: "Salvar chaves" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continuar" })).toBeNull();
  });

  it("o texto do topo cita a conta, e o segredo fica num campo de senha (não em texto da página)", () => {
    render(
      <StepChaves
        {...base}
        chaves={{ clientId: "11111111-1111-4111-8111-111111111111", clientSecret: "segredo-de-teste-123" }}
        modo="nova"
        testado={false}
      />,
    );
    expect(screen.getByText(/Conta Angela/)).toBeInTheDocument();
    expect(screen.getByLabelText("Client Secret")).toHaveAttribute("type", "password");
  });

  it("editar um campo chama aoMudar com o nome do campo", () => {
    const aoMudar = vi.fn();
    render(<StepChaves {...base} aoMudar={aoMudar} modo="nova" testado={false} />);
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "x" } });
    expect(aoMudar).toHaveBeenCalledWith("clientId", "x");
  });
});

describe("Conectar Meu Pluggy: bancos, CPF e selo da conexão", () => {
  it("sigla de dois caracteres a partir das duas primeiras palavras", () => {
    expect(siglaDoBanco("Itaú")).toBe("IT");
    expect(siglaDoBanco("Banco do Brasil")).toBe("BB");
    expect(siglaDoBanco("Nubank")).toBe("NU");
  });

  it("mostra só os dígitos 7 a 9 do CPF mascarado", () => {
    expect(cpfParaTela("***.456.789-**")).toBe("CPF ***.789");
    expect(cpfParaTela(null)).toBeNull();
  });

  it("'autorizado até MM/AAAA' no cartão do passo 3", () => {
    expect(autorizacaoDoBanco("2027-10-01T00:00:00.000Z")).toBe("autorizado até 10/2027");
    expect(autorizacaoDoBanco(null)).toBe("");
  });

  it("subtítulos de um banco: ativo com validade, perto do fim, desconectado e precisa de atenção", () => {
    const banco = (parcial: Record<string, unknown>) => ({
      id: "b",
      institutionName: "Itaú",
      institutionColor: null,
      consentExpiresAt: "2027-10-01T00:00:00.000Z",
      status: "ativo" as const,
      disconnectedAt: null,
      lastSyncAt: null,
      ...parcial,
    });
    expect(subtituloDoBanco(banco({}), AGORA)).toBe("Ativo · expira em 10/2027");
    expect(subtituloDoBanco(banco({ consentExpiresAt: "2026-11-25T00:00:00.000Z" }), AGORA)).toBe(
      "Consentimento expira em 25/11 · renovar",
    );
    expect(subtituloDoBanco(banco({ consentExpiresAt: null }), AGORA)).toBe("Ativo");
    expect(subtituloDoBanco(banco({ status: "acao_necessaria" }), AGORA)).toBe("Precisa de atenção");
    expect(subtituloDoBanco(banco({ disconnectedAt: "2026-11-01T00:00:00.000Z" }), AGORA)).toBe(
      "Desconectado · histórico mantido",
    );
  });

  it("selo da conexão: 'Sem chaves' vale sobre os outros; depois 'Precisa de atenção'; senão 'Conectado'", () => {
    const conexao = (parcial: Record<string, unknown>) => ({
      id: "c",
      label: "Conta Angela",
      cpfMasked: null,
      hasKeys: true,
      bankItems: [],
      ...parcial,
    });
    expect(estadoDaConexao(conexao({}))).toEqual({ texto: "Conectado", tom: "sucesso" });
    expect(
      estadoDaConexao(
        conexao({
          bankItems: [
            {
              id: "b",
              status: "acao_necessaria",
              institutionName: "X",
              institutionColor: null,
              consentExpiresAt: null,
              disconnectedAt: null,
              lastSyncAt: null,
            },
          ],
        }),
      ),
    ).toEqual({ texto: "Precisa de atenção", tom: "aviso" });
    expect(estadoDaConexao(conexao({ hasKeys: false }))).toEqual({ texto: "Sem chaves", tom: "aviso" });
  });
});
