import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import type { SyncStatusResponse } from "../../../shared/sync-api";
import { lerEstadoDaImportacao } from "../../api/sync";
import { PausaDoTeto } from "./PausaDoTeto";

// Faixa da importação do histórico (TASK-0204): em andamento, banco pronto ou banco que não terminou. Fica dentro do
// AppFrame, no conteúdo (a moldura bare das telas de acesso não a monta). Consulta a cada 10 s, só com a aba visível.
// Um término aparece enquanto a rota de estado o devolve (as últimas 24 h), mesmo que a página tenha aberto depois dele;
// "OK" grava o runId no localStorage (dentro de try/catch: sem ele, a faixa só some nesta tela).
const CHAVE_DAS_VISTAS = "mm.importacao.vistas";
const MAXIMO_DE_VISTAS = 100;
const INTERVALO_DE_CONSULTA_MS = 10_000;
// Decisão de Gustavo (2026-11-22): no conectar a faixa não aparece (o passo 4 já mostra o bloco), e na pausa a faixa tem
// um "X" que dispensa aquela pausa, guardada pelo pausadaAte (uma pausa nova, com outro pausadaAte, a faixa volta).
const CAMINHO_DO_CONECTAR = "/configuracoes/bancos/conectar";
const CHAVE_DA_PAUSA_DISPENSADA = "mm.importacao.pausaDispensada";

function lerPausaDispensada(): string | null {
  try {
    return window.localStorage.getItem(CHAVE_DA_PAUSA_DISPENSADA);
  } catch {
    return null;
  }
}

function gravarPausaDispensada(pausadaAte: string): void {
  try {
    window.localStorage.setItem(CHAVE_DA_PAUSA_DISPENSADA, pausadaAte);
  } catch {
    // Sem localStorage o "X" vale só nesta tela.
  }
}

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
  const [pausaDispensada, setPausaDispensada] = useState<string | null>(lerPausaDispensada);
  const { pathname } = useLocation();

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

  // No conectar, o passo 4 já mostra o bloco da pausa: a faixa não aparece lá.
  if (estado === null || pathname === CAMINHO_DO_CONECTAR) return null;

  const emAndamento = estado.importing[0];
  if (emAndamento) {
    // Pausada pelo teto (TASK-0209): a frase de quando volta, e o botão "Seguir agora" no plano gratuito.
    if (emAndamento.pausada && emAndamento.pausadaAte !== null) {
      // Dispensada pelo "X" nesta mesma pausa (a pausa nova tem outro pausadaAte, e a faixa volta).
      if (emAndamento.pausadaAte === pausaDispensada) return null;
      const pausadaAte = emAndamento.pausadaAte;
      return (
        <section
          aria-label="Importação do histórico"
          className="mx-auto flex w-full flex-col gap-3 border-b border-line bg-surface px-4 py-3 text-[14px]"
        >
          <div className="flex items-start gap-3">
            <p className="flex-1">Buscando o histórico do {emAndamento.institutionName}</p>
            <button
              type="button"
              aria-label="Fechar aviso"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center font-bold text-accent"
              onClick={() => {
                gravarPausaDispensada(pausadaAte);
                setPausaDispensada(pausadaAte);
              }}
            >
              ×
            </button>
          </div>
          <PausaDoTeto
            pausadaAte={emAndamento.pausadaAte}
            paidPlan={estado.paidPlan}
            aoSeguir={() => {
              void lerEstadoDaImportacao()
                .then(setEstado)
                .catch(() => undefined);
            }}
          />
        </section>
      );
    }
    return (
      <section
        aria-label="Importação do histórico"
        className="mx-auto flex w-full items-center gap-3 border-b border-line bg-surface px-4 py-3 text-[14px]"
      >
        <p className="flex-1">
          Buscando o histórico do {emAndamento.institutionName} · {emAndamento.progressPct}%
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
