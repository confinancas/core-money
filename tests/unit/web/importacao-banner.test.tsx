import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppFrame } from "@/app/frame/AppFrame";
import type { Frame } from "@/app/frame/aba";
import { ImportBanner } from "@/components/sync/ImportBanner";
import { definirAcaoDeSessaoExpirada } from "@/lib/api";
import type {
  ImportacaoEmAndamento,
  ImportacaoTerminada,
  SyncStatusResponse,
} from "../../../src/shared/sync-api";
import { desinstalarMatchMedia, instalarMatchMedia } from "./helpers/larguras";

// Faixa da importação do histórico (TASK-0204, R7): os estados na tela, o "OK" que lembra o término, e a moldura que
// decide onde ela fica. Nenhum teste fala com a API: o fetch é falso e responde só a GET /api/sync/status.

const ROTULO = "Importação do histórico";
const CHAVE_DAS_VISTAS = "mm.importacao.vistas";
const ONDE_CABE = "/configuracoes/bancos/banco-test";

let estado: SyncStatusResponse;
let consultas: string[];

function sincronizacaoCom(corpo: Partial<SyncStatusResponse>): SyncStatusResponse {
  return { importing: [], recentlyFinished: [], lastSync: null, banks: [], ...corpo };
}

function terminada(
  status: ImportacaoTerminada["status"],
  finishedAt: string,
  runId = "run-test-1",
): ImportacaoTerminada {
  return {
    runId,
    bankItemId: "banco-test",
    institutionName: "Banco [TEST]",
    kind: "historico",
    status,
    finishedAt,
  };
}

function emAndamento(progressPct: number): ImportacaoEmAndamento {
  return {
    bankItemId: "banco-test",
    institutionName: "Banco [TEST]",
    progressPct,
    startedAt: "2026-11-11T10:00:00.000Z",
    pausada: false,
    pausadaAte: null,
  };
}

// Duas horas antes de agora: o término aconteceu antes de a página abrir (a faixa também anuncia esse caso).
function ha2Horas(): string {
  return new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
}

// Só a consulta do estado tem resposta; as outras (o uso do plano, por exemplo) falham como sem rede.
function fetchFalso(caminho: string): Promise<Response> {
  consultas.push(caminho);
  if (caminho !== "/api/sync/status") return Promise.reject(new TypeError("sem rede no teste"));
  const corpo = JSON.stringify(estado);
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => JSON.parse(corpo) as unknown,
    text: async () => corpo,
  } as Response);
}

// Deixa a consulta de fundo terminar e a tela se atualizar.
async function esperarConsulta() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function faixa() {
  return screen.queryByLabelText(ROTULO);
}

function comRota(frame: Frame, elemento: ReactNode) {
  return (
    <MemoryRouter>
      <AppFrame frame={frame} aba={frame === "tab" ? "inicio" : null}>
        {elemento}
      </AppFrame>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  consultas = [];
  estado = sincronizacaoCom({});
  vi.stubGlobal("fetch", fetchFalso);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  instalarMatchMedia(1440);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  desinstalarMatchMedia();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("faixa da importação: os estados", () => {
  it("nada a mostrar: sem importação em andamento nem término não visto, a faixa não aparece", async () => {
    estado = sincronizacaoCom({});
    render(
      <MemoryRouter>
        <ImportBanner />
      </MemoryRouter>,
    );
    await esperarConsulta();

    expect(consultas).toContain("/api/sync/status");
    expect(faixa()).toBeNull();
  });

  it("importando: mostra o banco e o percentual, sem OK nem Ver banco", async () => {
    estado = sincronizacaoCom({ importing: [emAndamento(42)] });
    render(
      <MemoryRouter>
        <ImportBanner />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Buscando o histórico do Banco [TEST] · 42%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "OK" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Ver banco" })).toBeNull();
  });

  it("importando e pausada pelo teto: diz que a importação continua amanhã, no lugar do percentual", async () => {
    estado = sincronizacaoCom({
      importing: [{ ...emAndamento(42), pausada: true, pausadaAte: "2026-11-11T00:00:00.000Z" }],
    });
    render(
      <MemoryRouter>
        <ImportBanner />
      </MemoryRouter>,
    );

    expect(await screen.findByText("A importação continua amanhã")).toBeInTheDocument();
    expect(faixa()).toHaveTextContent("Buscando o histórico do Banco [TEST] · A importação continua amanhã");
    expect(screen.queryByText(/42%/)).toBeNull();
  });

  it("pronto: anuncia o término com OK, que grava o runId e tira a faixa", async () => {
    estado = sincronizacaoCom({ recentlyFinished: [terminada("ok", ha2Horas(), "run-ok")] });
    const usuario = userEvent.setup();
    render(
      <MemoryRouter>
        <ImportBanner />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Histórico do Banco [TEST] pronto.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ver banco" })).toBeNull();

    await usuario.click(screen.getByRole("button", { name: "OK" }));

    expect(faixa()).toBeNull();
    expect(localStorage.getItem(CHAVE_DAS_VISTAS)).toBe(JSON.stringify(["run-ok"]));
  });

  it("um término já visto não volta ao abrir a página de novo", async () => {
    localStorage.setItem(CHAVE_DAS_VISTAS, JSON.stringify(["run-ok"]));
    estado = sincronizacaoCom({ recentlyFinished: [terminada("ok", ha2Horas(), "run-ok")] });
    render(
      <MemoryRouter>
        <ImportBanner />
      </MemoryRouter>,
    );
    await esperarConsulta();

    expect(faixa()).toBeNull();
  });

  it("pronto também quando a repetição terminou bem (status repetiu)", async () => {
    estado = sincronizacaoCom({ recentlyFinished: [terminada("repetiu", ha2Horas())] });
    render(
      <MemoryRouter>
        <ImportBanner />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Histórico do Banco [TEST] pronto.")).toBeInTheDocument();
  });

  it.each<[ImportacaoTerminada["status"], string]>([
    ["instavel", "instável"],
    ["erro", "com erro"],
    [null, "sem status (erro de código)"],
  ])("não terminou (%s, %s): a frase de falha, Ver banco para o banco e OK", async (status) => {
    estado = sincronizacaoCom({ recentlyFinished: [terminada(status, ha2Horas())] });
    render(
      <MemoryRouter>
        <ImportBanner />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Não deu para buscar todo o histórico do Banco [TEST]."),
    ).toBeInTheDocument();
    const ver = screen.getByRole("link", { name: "Ver banco" });
    expect(ver).toHaveAttribute("href", ONDE_CABE);
    expect(ver.className).toContain("min-h-[44px]");
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();
  });

  it("a variante de erro leva o OK a 44 px de altura e largura mínimas", async () => {
    estado = sincronizacaoCom({ recentlyFinished: [terminada("erro", ha2Horas())] });
    render(
      <MemoryRouter>
        <ImportBanner />
      </MemoryRouter>,
    );

    const ok = await screen.findByRole("button", { name: "OK" });
    expect(ok.className).toContain("min-h-[44px]");
    expect(ok.className).toContain("min-w-[44px]");
  });
});

describe("faixa da importação: o que fica guardado", () => {
  it("sem localStorage, a leitura cai no vazio e o OK ainda tira a faixa nesta tela", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("acesso negado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("acesso negado");
    });
    estado = sincronizacaoCom({ recentlyFinished: [terminada("ok", ha2Horas(), "run-sem-armazem")] });
    const usuario = userEvent.setup();
    render(
      <MemoryRouter>
        <ImportBanner />
      </MemoryRouter>,
    );

    await usuario.click(await screen.findByRole("button", { name: "OK" }));

    expect(faixa()).toBeNull();
  });

  it("a lista de vistas guarda só as últimas 100", async () => {
    const antigas = Array.from({ length: 100 }, (_, i) => `run-antigo-${i}`);
    localStorage.setItem(CHAVE_DAS_VISTAS, JSON.stringify(antigas));
    estado = sincronizacaoCom({ recentlyFinished: [terminada("ok", ha2Horas(), "run-novo")] });
    const usuario = userEvent.setup();
    render(
      <MemoryRouter>
        <ImportBanner />
      </MemoryRouter>,
    );

    await usuario.click(await screen.findByRole("button", { name: "OK" }));

    const guardadas = JSON.parse(localStorage.getItem(CHAVE_DAS_VISTAS) ?? "[]") as string[];
    expect(guardadas).toHaveLength(100);
    expect(guardadas[99]).toBe("run-novo");
    expect(guardadas).not.toContain("run-antigo-0");
  });
});

describe("faixa da importação: a consulta de fundo não leva ao login", () => {
  it("sessão vencida (401) na consulta da faixa: a faixa não manda para /entrar", async () => {
    const aoExpirar = vi.fn();
    const restaurar = definirAcaoDeSessaoExpirada(aoExpirar);
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: "nao_autenticado", message: "Sessão encerrada." }),
      } as Response),
    );
    try {
      render(
        <MemoryRouter>
          <ImportBanner />
        </MemoryRouter>,
      );
      await esperarConsulta();

      expect(faixa()).toBeNull();
      expect(aoExpirar).not.toHaveBeenCalled();
    } finally {
      restaurar();
    }
  });
});

describe("faixa da importação: onde monta", () => {
  it("na moldura bare (as telas de acesso) não monta e não consulta a API", async () => {
    estado = sincronizacaoCom({ importing: [emAndamento(10)] });
    render(comRota("bare", <p>Entrar na conta</p>));
    await esperarConsulta();

    expect(screen.getByText("Entrar na conta")).toBeInTheDocument();
    expect(faixa()).toBeNull();
    expect(consultas).not.toContain("/api/sync/status");
  });

  it.each([
    ["celular", 390],
    ["tablet", 900],
    ["desktop", 1440],
  ])(
    "na moldura com sessão, no %s, fica dentro do conteúdo (main), sem empurrar o menu",
    async (_nome, largura) => {
      instalarMatchMedia(largura);
      estado = sincronizacaoCom({ importing: [emAndamento(55)] });
      render(comRota("tab", <p>Conteúdo da tela</p>));

      const secao = await screen.findByLabelText(ROTULO);
      expect(secao.closest("main")).not.toBeNull();
      expect(screen.getByText("Conteúdo da tela")).toBeInTheDocument();
    },
  );
});
