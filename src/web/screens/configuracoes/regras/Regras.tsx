import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { GreenTop } from "@/components/ui/green-top";
import { SkeletonCard } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { RegraDaLista } from "../../../../shared/rule-match";
import {
  deleteRule,
  type EscopoDaLista,
  fetchRules,
  type PaginaDeRegras,
} from "../../../api/settings-categorization";
import { CategoryDot } from "../../../components/CategoryDot";
import { ApiError } from "../../../lib/api";
import { acoesDaRegra, linhaDeCriacao, textoDeDesfazer } from "./format";

// Configurações › Regras por estabelecimento (TASK-0305): busca, escopo e a lista de regras ativas do lar. Desfazer pede
// confirmação dentro da linha (nunca confirm()). Desfazer só vale daqui para a frente.
const ESCOPOS: Array<{ id: EscopoDaLista; rotulo: string }> = [
  { id: "todos", rotulo: "Todas" },
  { id: "estabelecimento", rotulo: "Compras" },
  { id: "destinatario", rotulo: "Pix enviados" },
  { id: "remetente", rotulo: "Pix recebidos" },
];

export function Regras() {
  const [escopo, setEscopo] = useState<EscopoDaLista>("todos");
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [pagina, setPagina] = useState<PaginaDeRegras | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [pendente, setPendente] = useState<string | null>(null);
  const [desfazendo, setDesfazendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Cada carga tem um número; só a última que chega vale (troca de escopo ou busca no meio de outra).
  const partida = useRef(0);

  // A busca espera 250 ms depois da última tecla; o escopo muda na hora.
  useEffect(() => {
    const timer = window.setTimeout(() => setBuscaAplicada(busca), 250);
    return () => window.clearTimeout(timer);
  }, [busca]);

  // carregar lê só o escopo e a busca, que são as dependências deste efeito.
  // biome-ignore lint/correctness/useExhaustiveDependencies: carregar é uma função de módulo de escopo do componente.
  useEffect(() => {
    carregar(escopo, buscaAplicada);
  }, [escopo, buscaAplicada]);

  function carregar(esc: EscopoDaLista, termo: string) {
    const esta = ++partida.current;
    setFalhou(false);
    setPendente(null);
    fetchRules({ escopo: esc, busca: termo }).then(
      (resposta) => {
        if (esta === partida.current) setPagina(resposta);
      },
      () => {
        if (esta === partida.current) setFalhou(true);
      },
    );
  }

  function recarregar() {
    setPagina(null);
    carregar(escopo, buscaAplicada);
  }

  async function verMais() {
    if (!pagina?.nextCursor) return;
    setCarregandoMais(true);
    try {
      const mais = await fetchRules({ escopo, busca: buscaAplicada, cursor: pagina.nextCursor });
      setPagina({ total: mais.total, items: [...pagina.items, ...mais.items], nextCursor: mais.nextCursor });
    } catch {
      setErro("Não deu para carregar mais regras.");
    } finally {
      setCarregandoMais(false);
    }
  }

  async function desfazer(regra: RegraDaLista) {
    setDesfazendo(true);
    setErro(null);
    try {
      await deleteRule(regra.id);
      setPagina((atual) =>
        atual
          ? { ...atual, total: atual.total - 1, items: atual.items.filter((item) => item.id !== regra.id) }
          : atual,
      );
      setPendente(null);
    } catch (falha) {
      setErro(
        falha instanceof ApiError && falha.status === 404
          ? "Essa regra já não existe."
          : "Não deu para desfazer. Tente de novo.",
      );
    } finally {
      setDesfazendo(false);
    }
  }

  return (
    <section className="flex min-h-dvh flex-col bg-bg">
      <GreenTop
        variant="detail"
        title="Regras"
        subtitle="Categorias e nomes que você corrigiu"
        back={{ to: "/configuracoes", label: "Voltar às configurações" }}
      />
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 pt-5 pb-8 tablet:px-6">
        <label className="flex flex-col gap-2">
          <span className="sr-only">Buscar estabelecimento ou pessoa</span>
          <input
            type="search"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Buscar estabelecimento ou pessoa"
            className="h-12 rounded-field border border-field-border bg-field px-4 font-sans text-[15px] text-ink outline-none placeholder:text-hidden-ink focus:border-primary focus:ring-[3px] focus:ring-primary/14"
          />
        </label>

        <section aria-label="Tipo de regra" className="flex flex-wrap gap-2">
          {ESCOPOS.map((opcao) => (
            <button
              key={opcao.id}
              type="button"
              aria-pressed={escopo === opcao.id}
              onClick={() => setEscopo(opcao.id)}
              className={cn(
                "min-h-11 rounded-chip border px-4 text-[14px] font-bold transition-colors",
                escopo === opcao.id
                  ? "border-primary bg-primary text-white"
                  : "border-tile-border bg-card text-ink",
              )}
            >
              {opcao.rotulo}
            </button>
          ))}
        </section>

        {erro !== null && (
          <p role="alert" className="text-[14px] font-semibold text-danger">
            {erro}
          </p>
        )}

        {pagina === null ? (
          falhou ? (
            <ErrorState title="Não deu para carregar as regras." onRetry={recarregar} />
          ) : (
            <SkeletonCard />
          )
        ) : pagina.items.length === 0 ? (
          <EmptyState
            title={
              buscaAplicada === ""
                ? "Nenhuma regra ainda. Elas aparecem quando vocês confirmam uma categoria."
                : "Nenhuma regra com esse nome."
            }
          />
        ) : (
          <Card className="flex flex-col overflow-hidden p-0" aria-label="Regras">
            {pagina.items.map((regra) => (
              <LinhaDaRegra
                key={regra.id}
                regra={regra}
                pendente={pendente === regra.id}
                ocupado={desfazendo}
                aoPedir={() => {
                  setErro(null);
                  setPendente(regra.id);
                }}
                aoCancelar={() => setPendente(null)}
                aoConfirmar={() => void desfazer(regra)}
              />
            ))}
            {pagina.nextCursor !== null && (
              <div className="p-4">
                <Button variant="secondary" full loading={carregandoMais} onClick={() => void verMais()}>
                  Ver mais
                </Button>
              </div>
            )}
          </Card>
        )}
      </div>
    </section>
  );
}

function LinhaDaRegra({
  regra,
  pendente,
  ocupado,
  aoPedir,
  aoCancelar,
  aoConfirmar,
}: {
  regra: RegraDaLista;
  pendente: boolean;
  ocupado: boolean;
  aoPedir: () => void;
  aoCancelar: () => void;
  aoConfirmar: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-divider px-4 py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-[15px] font-bold text-ink">{regra.matchLabel}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2">
            {acoesDaRegra(regra).map((acao) =>
              acao.tipo === "categoria" ? (
                <span key={`cat-${acao.nome}`} className="inline-flex items-center gap-1.5 text-ink">
                  <CategoryDot cor={acao.cor ?? "#999999"} />
                  {acao.nome}
                </span>
              ) : (
                <span key={`txt-${acao.texto}`}>{acao.texto}</span>
              ),
            )}
          </span>
          <span className="text-[12px] text-ink-2">{linhaDeCriacao(regra)}</span>
        </div>
        <button
          type="button"
          onClick={aoPedir}
          disabled={pendente}
          className="min-h-11 shrink-0 px-3 text-[14px] font-bold text-danger disabled:opacity-50"
        >
          Desfazer
        </button>
      </div>
      {pendente && (
        <section aria-label="Desfazer regra" className="flex flex-col gap-3 rounded-field bg-field p-3">
          <p className="text-[14px] leading-normal text-ink">{textoDeDesfazer(regra.matchLabel)}</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={ocupado}
              onClick={aoConfirmar}
              className="min-h-11 rounded-field bg-danger px-4 text-[15px] font-bold text-white disabled:opacity-60"
            >
              Desfazer regra
            </button>
            <button
              type="button"
              onClick={aoCancelar}
              className="min-h-11 px-4 text-[15px] font-bold text-ink"
            >
              Cancelar
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
