import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { SyncStatusResponse } from "../../../shared/sync-api";
import { lerEstadoDaImportacao } from "../../api/sync";

// Faixa da moldura (TASK-0204): importação em andamento, banco pronto ou banco que não terminou. Consulta a cada 10 s,
// só com a aba visível. "OK" lembra o runId visto no localStorage (dentro de try/catch: sem ele, a faixa só some na tela).
const CHAVE_DAS_VISTAS = "mm.importacao.vistas";

function lerVistas(): string[] {
  try {
    const bruto = window.localStorage.getItem(CHAVE_DAS_VISTAS);
    const lista: unknown = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function marcarVista(runId: string, atuais: string[]): string[] {
  const novas = [...atuais, runId];
  try {
    window.localStorage.setItem(CHAVE_DAS_VISTAS, JSON.stringify(novas));
  } catch {
    // Sem localStorage a faixa some só nesta tela.
  }
  return novas;
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
          if (ativo) setEstado(resposta);
        })
        .catch(() => undefined);
    };
    buscar();
    const intervalo = window.setInterval(buscar, 10_000);
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
          Buscando o histórico do {emAndamento.institutionName} · {emAndamento.progressPct}%
        </p>
      </section>
    );
  }

  const terminada = estado.recentlyFinished.find((linha) => !vistas.includes(linha.runId));
  if (!terminada) return null;

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
        onClick={() => setVistas((atuais) => marcarVista(terminada.runId, atuais))}
      >
        OK
      </button>
    </section>
  );
}
