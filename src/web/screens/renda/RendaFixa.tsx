import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { GlassBubble } from "@/components/ui/glass-bubble";
import { GreenTop } from "@/components/ui/green-top";
import { Money } from "@/components/ui/money";
import { SkeletonCard } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ARRIVAL_SHORT_LABELS,
  type FixedIncomeDto,
  type FixedIncomesResponse,
} from "../../../shared/fixed-incomes";
import { fetchFixedIncomes } from "../../api/fixed-incomes";
import { FixedIncomeEditor } from "./FixedIncomeEditor";

// Renda fixa (TASK-0901): o previsto por ciclo, a lista e o editor. ?id=<id> abre essa renda; ?nova=1 abre o editor
// vazio; sem parâmetro, a primeira da lista. Em real, o previsto soma as rendas em real; o dólar aparece sem conversão
// até a TASK-0902 trazer a cotação.

const MENSAGEM_DE_EXCLUIDA = "Esta renda fixa foi excluída por outra pessoa.";
// Cores dos trechos da barra do previsto, na ordem das rendas (tokens do design system).
const CORES_DA_BARRA = ["bg-white", "bg-primary-soft-2", "bg-white/60", "bg-primary-ink"];

export function RendaFixa() {
  const [parametros, definirParametros] = useSearchParams();
  const [dados, setDados] = useState<FixedIncomesResponse | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setFalhou(false);
    try {
      setDados(await fetchFixedIncomes());
    } catch {
      setFalhou(true);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const rendas = dados?.fixedIncomes ?? [];
  const modoNovo = parametros.get("nova") === "1" || rendas.length === 0;
  const pedida = parametros.get("id");
  const alvo: FixedIncomeDto | null = modoNovo
    ? null
    : (rendas.find((renda) => renda.id === pedida) ?? rendas[0] ?? null);

  // Salvou: a lista recarrega antes de a renda nova ser selecionada (para ela já aparecer na lista).
  async function aoSalvar(renda: FixedIncomeDto, criada: boolean) {
    setAviso(null);
    await carregar();
    if (criada) definirParametros({ id: renda.id });
  }

  async function aoExcluir() {
    setAviso(null);
    await carregar();
    definirParametros({});
  }

  // Outra pessoa excluiu a renda que estava aberta: a tela avisa, recarrega e volta à primeira da lista.
  async function aoNaoEncontrar() {
    setAviso(MENSAGEM_DE_EXCLUIDA);
    await carregar();
    definirParametros({});
  }

  const previsto = dados?.expectedPerCycle;
  const total = previsto ? previsto.brlCents + (previsto.usdInBrlCents ?? 0) : 0;
  // Só as rendas em real entram na barra por enquanto: o dólar convertido é a TASK-0902.
  const trechos = rendas.filter((renda) => renda.currency === "BRL" && renda.amountCents > 0);

  return (
    <section className="flex min-h-dvh flex-col bg-bg">
      <GreenTop
        variant="detail"
        title="Renda fixa"
        subtitle="O que entra todo ciclo, com dia certo"
        back={{ to: "/renda", label: "Voltar para Renda" }}
      >
        {dados !== null && (
          <GlassBubble className="flex flex-col gap-3">
            <p className="text-[13px] font-semibold text-white/82">Previsto por ciclo</p>
            <Money cents={total} className="text-[34px] font-extrabold leading-tight" />
            {total > 0 && (
              <div
                aria-hidden="true"
                className="flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-white/22"
              >
                {trechos.map((renda, indice) => (
                  <span
                    key={renda.id}
                    className={cn("h-full", CORES_DA_BARRA[indice % CORES_DA_BARRA.length])}
                    style={{ width: `${(renda.amountCents / total) * 100}%` }}
                  />
                ))}
              </div>
            )}
            <ul className="flex flex-col gap-1 text-[13px]">
              {rendas.map((renda) => (
                <li key={renda.id}>
                  {renda.name} {renda.currency === "USD" && "US$ "}
                  <Money cents={renda.amountCents} />
                </li>
              ))}
            </ul>
          </GlassBubble>
        )}
      </GreenTop>

      <div className="mx-auto grid w-full max-w-[1120px] items-start gap-5 px-4 pt-6 pb-8 tablet:grid-cols-2 tablet:gap-[18px] tablet:px-6">
        {dados === null ? (
          falhou ? (
            <div className="tablet:col-span-2">
              <ErrorState title="Não foi possível carregar a renda fixa." onRetry={() => void carregar()} />
            </div>
          ) : (
            <div className="tablet:col-span-2">
              <SkeletonCard />
            </div>
          )
        ) : (
          <>
            {aviso !== null && (
              <p role="alert" className="text-[14px] font-semibold text-danger tablet:col-span-2">
                {aviso}
              </p>
            )}

            <div className="flex min-w-0 flex-col gap-4">
              {rendas.length === 0 ? (
                <EmptyState title="Nenhuma renda fixa ainda." />
              ) : (
                <Card aria-label="Rendas fixas" className="flex flex-col overflow-hidden p-0">
                  {rendas.map((renda) => {
                    const ativa = alvo?.id === renda.id && !modoNovo;
                    const dolar = renda.currency === "USD";
                    return (
                      <button
                        key={renda.id}
                        type="button"
                        aria-pressed={ativa}
                        onClick={() => {
                          setAviso(null);
                          definirParametros({ id: renda.id });
                        }}
                        className={cn(
                          "flex min-h-16 w-full items-center gap-3 border-b border-divider px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-field",
                          ativa && "bg-primary-soft",
                        )}
                      >
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-primary-soft text-[12px] font-extrabold text-primary-ink">
                          {dolar ? "US$" : "R$"}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-[15px] font-bold text-ink">{renda.name}</span>
                          <span className="text-[13px] text-ink-2">
                            {dolar && (
                              <>
                                US$ <Money cents={renda.amountCents} /> ·{" "}
                              </>
                            )}
                            todo dia {renda.usualDay} · {ARRIVAL_SHORT_LABELS[renda.arrival]}
                          </span>
                        </span>
                        <span className="shrink-0 text-[14px] font-bold text-ink">
                          {dolar ? (
                            <>
                              US$ <Money cents={renda.amountCents} />
                            </>
                          ) : (
                            <Money cents={renda.amountCents} />
                          )}
                        </span>
                      </button>
                    );
                  })}
                  <div className="p-4">
                    <Button
                      variant="secondary"
                      full
                      onClick={() => {
                        setAviso(null);
                        definirParametros({ nova: "1" });
                      }}
                    >
                      <span aria-hidden="true">+</span> Adicionar renda fixa
                    </Button>
                  </div>
                </Card>
              )}
            </div>

            <div className="min-w-0">
              <FixedIncomeEditor
                key={modoNovo ? "nova" : (alvo?.id ?? "vazia")}
                renda={alvo}
                existentes={rendas}
                aoSalvar={(renda, criada) => void aoSalvar(renda, criada)}
                aoExcluir={() => void aoExcluir()}
                aoNaoEncontrar={() => void aoNaoEncontrar()}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
