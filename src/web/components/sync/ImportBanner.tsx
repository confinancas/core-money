import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { SyncStatusResponse } from "../../../shared/sync-api";
import { lerEstadoDaImportacao } from "../../api/sync";

// Faixa da importação do histórico (TASK-0204): em andamento, banco pronto ou banco que não terminou. Fica dentro do
// AppFrame, no conteúdo (a moldura bare das telas de acesso não a monta). Consulta a cada 10 s, só com a aba visível.
// Um término aparece enquanto a rota de estado o devolve (as últimas 24 h), mesmo que a página tenha aberto depois dele;
// "OK" grava o runId no localStorage (dentro de try/catch: sem ele, a faixa só some nesta tela).
const CHAVE_DAS_VISTAS = "mm.importacao.vistas";
const MAXIMO_DE_VISTAS = 100;
const INTERVALO_DE_CONSULTA_MS = 10_000;

function lerVistas(): string[] {
  try {
    const bruto = window.localStorage.getItem(CHAVE_DAS_VISTAS);
    const lista: unknown = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function gravarVistas(vistas: string[]): void {
  try {
    window.localStorage.setItem(CHAVE_DAS_VISTAS, JSON.stringify(vistas));
  } catch {
    // Sem localStorage a faixa some só nesta tela.
  }
}

export function ImportBanner() {
  const [estado, setEstado] = useState<SyncStatusResponse | null>(null);
  const [vistas, setVistas] = useState<string[]>(lerVistas);

  useEffect(() => {
    let ativo = true;
    const buscar = () => {
      if (document.visibilityState !== "visible") return;
      lerEstadoDaImportacao()
        .then((resposta) => {
          if (!ativo) return;
          setEstado(resposta);
        })
        .catch(() => undefined);
    };
    buscar();
    const intervalo = window.setInterval(buscar, INTERVALO_DE_CONSULTA_MS);
    return () => {
      ativo = false;
      window.clearInterval(intervalo);
    };
  }, []);

  if (estado === null) return null;

  const emAndamento = estado.importing[0];
  if (emAndamento) {
    return (
      <section
        aria-label="Importação do histórico"
        className="mx-auto flex w-full items-center gap-3 border-b border-line bg-surface px-4 py-3 text-[14px]"
      >
        <p className="flex-1">
          {emAndamento.pausada ? (
            <>
              Buscando o histórico do {emAndamento.institutionName} ·{" "}
              <span>A importação continua amanhã</span>
            </>
          ) : (
            <>
              Buscando o histórico do {emAndamento.institutionName} · {emAndamento.progressPct}%
            </>
          )}
        </p>
      </section>
    );
  }

  const terminada = estado.recentlyFinished.find((linha) => !vistas.includes(linha.runId));
  if (!terminada) return null;

  function marcarComoVista(runId: string) {
    const novas = [...vistas, runId].slice(-MAXIMO_DE_VISTAS);
    gravarVistas(novas);
    setVistas(novas);
  }

  const deuCerto = terminada.status === "ok" || terminada.status === "repetiu";
  return (
    <section
      aria-label="Importação do histórico"
      className="mx-auto flex w-full flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 text-[14px]"
    >
      {deuCerto ? (
        <p className="flex-1">Histórico do {terminada.institutionName} pronto.</p>
      ) : (
        <p className="flex-1">Não deu para buscar todo o histórico do {terminada.institutionName}.</p>
      )}
      {!deuCerto && (
        <Link
          to={`/configuracoes/bancos/${terminada.bankItemId}`}
          className="flex min-h-[44px] items-center font-bold text-accent"
        >
          Ver banco
        </Link>
      )}
      <button
        type="button"
        className="flex min-h-[44px] min-w-[44px] items-center justify-center font-bold text-accent"
        onClick={() => marcarComoVista(terminada.runId)}
      >
        OK
      </button>
    </section>
  );
}
