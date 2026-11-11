import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { lerEstadoDaImportacao } from "../../../api/sync";
import { IconeCheck } from "../../../components/icons";
import { textoDoPassoPronto } from "./view-model";

type Props = {
  rotulo: string;
  quantidade: number;
  // Os bancos desta conexão: o painel de progresso acompanha a importação deles (TASK-0204).
  bancoIds: string[];
  aoIrParaInicio: () => void;
  aoVerEmConfiguracoes: () => void;
};

// Passo 4 (TASK-0203, painel de progresso na TASK-0204): a conta está conectada; enquanto o histórico é buscado, a barra
// mostra o andamento (consulta /api/sync/status a cada 5 s, com a tela aberta). Pausada pelo teto diário, a barra dá
// lugar à frase de que a importação continua amanhã.
export function StepPronto({ rotulo, quantidade, bancoIds, aoIrParaInicio, aoVerEmConfiguracoes }: Props) {
  const [andamento, setAndamento] = useState<{ progressPct: number; pausada: boolean } | null>(null);
  const chave = bancoIds.join(",");
  const progresso = andamento?.progressPct ?? null;
  const pausada = andamento?.pausada ?? false;

  useEffect(() => {
    let ativo = true;
    const ids = chave.split(",").filter((id) => id !== "");
    const buscar = () => {
      lerEstadoDaImportacao()
        .then((resposta) => {
          if (!ativo) return;
          const emAndamento = resposta.importing.find((linha) => ids.includes(linha.bankItemId));
          setAndamento(
            emAndamento ? { progressPct: emAndamento.progressPct, pausada: emAndamento.pausada } : null,
          );
        })
        .catch(() => undefined);
    };
    buscar();
    const intervalo = window.setInterval(buscar, 5_000);
    return () => {
      ativo = false;
      window.clearInterval(intervalo);
    };
  }, [chave]);

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <span
        aria-hidden="true"
        className="flex size-16 items-center justify-center rounded-full bg-success-bg text-success ring-[9px] ring-success-bg/60"
      >
        <IconeCheck size={30} strokeWidth={2.5} />
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="text-[24px] font-extrabold tracking-[-0.3px]">{rotulo} conectada</h2>
        <p className="text-[14px] leading-normal text-ink-2">{textoDoPassoPronto(quantidade)}</p>
      </div>
      {progresso !== null && (
        <section aria-label="Progresso do histórico" className="flex w-full flex-col gap-2">
          <div className="flex items-center justify-between text-[14px] font-bold">
            <span>Buscando o histórico</span>
            {!pausada && <span data-testid="progresso-do-historico">{progresso}%</span>}
          </div>
          {pausada ? (
            <p className="text-[14px] leading-normal text-ink-2" data-testid="pausa-do-historico">
              A importação continua amanhã
            </p>
          ) : (
            <>
              <div
                role="progressbar"
                aria-label="Histórico"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progresso}
                className="h-2 w-full overflow-hidden rounded-full bg-line"
              >
                <div className="h-full rounded-full bg-success" style={{ width: `${progresso}%` }} />
              </div>
              <p className="text-[13px] leading-normal text-ink-2">
                Pode levar alguns minutos. Dá para usar o app enquanto isso; avisamos quando terminar.
              </p>
            </>
          )}
        </section>
      )}
      <div className="flex w-full flex-col gap-3">
        <Button full onClick={aoIrParaInicio}>
          Ir para o início
        </Button>
        <Button variant="secondary" full onClick={aoVerEmConfiguracoes}>
          Ver em Configurações
        </Button>
      </div>
    </div>
  );
}
