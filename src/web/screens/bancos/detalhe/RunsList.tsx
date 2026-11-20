import type { DetalheDoBancoDto } from "../../../../shared/bank-item-view";
import { quandoDaExecucao, runLine } from "../../../../shared/bank-item-view";
import { Card } from "../../../components/ui/card";
import { StatusPill } from "../../../components/ui/status-pill";

// Histórico de atualizações (TASK-0206): até as 10 execuções mais recentes, com o texto e a pílula de runLine.
export function RunsList({ execucoes, agora }: { execucoes: DetalheDoBancoDto["runs"]; agora: Date }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="px-1 text-[12px] font-extrabold uppercase tracking-[1.2px] text-ink-2">
        Histórico de atualizações
      </h2>
      <Card className="flex flex-col overflow-hidden p-0">
        {execucoes.length === 0 && (
          <p className="px-4 pb-4 text-[14px] text-ink-2">Nenhuma atualização ainda.</p>
        )}
        {execucoes.map((execucao) => {
          const linha = runLine(execucao);
          return (
            <div key={execucao.id} className="flex flex-col gap-1 border-t border-field-border px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-semibold text-ink-2">
                  {quandoDaExecucao(execucao.finishedAt ?? execucao.startedAt, agora)}
                </span>
                {linha.pilula !== null && (
                  <StatusPill tone={linha.pilula.tom === "neutro" ? "aviso" : linha.pilula.tom}>
                    {linha.pilula.texto}
                  </StatusPill>
                )}
              </div>
              <p className="text-[14px] text-ink">{linha.texto}</p>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
