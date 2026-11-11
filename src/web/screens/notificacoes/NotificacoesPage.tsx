import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { IconeSeta } from "@/components/icons";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import { TopIconButton } from "@/components/ui/top-icon-button";
import { cn } from "@/lib/utils";
import type {
  ListaDeNotificacoes,
  MarcadasDeNotificacoes,
  NotificacaoDaLista,
} from "../../../shared/notifications/api";
import { apiFetch } from "../../lib/api";
import { ItemNotificacao } from "./ItemNotificacao";
import { soItensValidos } from "./validos";

// Central de notificações (/notificacoes, TASK-0701), como os protótipos: o topo verde traz o título, o subtítulo e o
// botão numa linha própria, abaixo. Novas fica dentro do cartão branco. No celular, Novas sobre o topo e Anteriores
// abaixo, em cinza; no tablet e no desktop, duas colunas do mesmo topo, e o rótulo de Anteriores fica sobre a faixa,
// em branco a 90%. "Lida" vale para o lar: abrir ou marcar tira da contagem de todos.
const MENSAGEM_DE_ERRO = "Não consegui carregar as notificações.";
const SOMBRA_DO_CARTAO = "shadow-[0_8px_24px_rgba(22,60,45,0.07)]";

function subtitulo(novas: number): string {
  if (novas <= 0) return "Tudo lido";
  return novas === 1 ? "1 nova" : `${novas} novas`;
}

export function NotificacoesPage() {
  const [lista, setLista] = useState<ListaDeNotificacoes | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [agora] = useState(() => new Date());

  const carregar = useCallback(async () => {
    setFalhou(false);
    try {
      const resposta = await apiFetch<ListaDeNotificacoes>("/api/notifications");
      setLista(soItensValidos(resposta));
    } catch {
      setFalhou(true);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Otimista: a notificação aberta sai das Novas já na tela. O POST vai em segundo plano; se ele falhar, a lista
  // volta ao que o servidor diz na próxima abertura (a notificação continua não lida lá).
  function marcarComoLida(id: string) {
    setLista((atual) => {
      if (!atual) return atual;
      const abriu = atual.new.find((item) => item.id === id);
      if (!abriu) return atual;
      return {
        unreadCount: Math.max(0, atual.unreadCount - 1),
        new: atual.new.filter((item) => item.id !== id),
        previous: [abriu, ...atual.previous],
      };
    });
    void apiFetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }).catch(
      () => undefined,
    );
  }

  // Marca todas: a tela já mostra "Tudo lido"; se o pedido falhar, recarrega o que o servidor tem.
  function marcarTodas() {
    if (!lista || lista.unreadCount === 0) return;
    const todas: NotificacaoDaLista[] = lista.new;
    setLista({ unreadCount: 0, new: [], previous: [...todas, ...lista.previous] });
    apiFetch<MarcadasDeNotificacoes>("/api/notifications/read-all", { method: "POST" }).catch(() => {
      void carregar();
    });
  }

  const novas = lista?.unreadCount ?? 0;
  const semNenhuma = lista !== null && lista.new.length === 0 && lista.previous.length === 0;

  return (
    <section className="flex min-h-dvh flex-col bg-bg">
      <header className="rounded-b-top bg-(image:--gradient-top) px-5 pt-5 pb-[60px] text-white shadow-top tablet:px-8 tablet:pt-[26px]">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4">
          <div className="flex items-center gap-3">
            <TopIconButton label="Voltar ao início" to="/inicio" icon={<IconeSeta />} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h1 className="text-[26px] font-extrabold tracking-[-0.4px]">Notificações</h1>
              {lista !== null && (
                <p className="whitespace-nowrap text-[13px] font-semibold text-white/82">
                  {subtitulo(novas)}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={marcarTodas}
            disabled={lista === null || novas === 0}
            className={cn(
              "inline-flex min-h-[44px] items-center self-start rounded-full px-4 text-[12px] font-extrabold tracking-[1px] uppercase transition-colors",
              novas > 0
                ? "border border-white/35 bg-white/18 text-white"
                : "cursor-default border-0 bg-white/12 text-white/60",
            )}
          >
            Marcar todas como lidas
          </button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-3.5 px-4 tablet:-mt-11 tablet:flex-row tablet:items-start tablet:gap-[18px] tablet:px-6 desktop:px-8">
        {lista === null && !falhou && (
          <div className="-mt-11 flex min-w-0 flex-1 flex-col gap-4 tablet:mt-0">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {falhou && (
          <div className="-mt-11 flex min-w-0 flex-1 flex-col tablet:mt-0">
            <ErrorState title={MENSAGEM_DE_ERRO} onRetry={() => void carregar()} />
          </div>
        )}

        {lista !== null && semNenhuma && (
          <div className="-mt-11 flex min-w-0 flex-1 flex-col tablet:mt-0">
            <div
              className={`rounded-[24px] bg-card px-[18px] py-6 text-center text-[15px] font-bold text-ink-3 ${SOMBRA_DO_CARTAO}`}
            >
              Nenhuma notificação ainda.
            </div>
          </div>
        )}

        {lista !== null && !semNenhuma && (
          <div className="-mt-11 flex min-w-0 flex-1 flex-col tablet:mt-0">
            <section
              aria-labelledby="titulo-das-novas"
              className={`flex flex-col rounded-[24px] bg-card px-[18px] pt-2 pb-1 ${SOMBRA_DO_CARTAO}`}
            >
              <h2
                id="titulo-das-novas"
                className="pt-2.5 pb-0.5 text-[11px] font-extrabold tracking-[1.1px] text-ink-2 uppercase"
              >
                Novas
              </h2>
              {lista.new.length === 0 ? (
                <p className="py-4 text-[14px] font-semibold text-ink-3">Nada novo por aqui.</p>
              ) : (
                lista.new.map((item) => (
                  <div key={item.id} className="border-b border-divider last:border-b-0">
                    <ItemNotificacao notificacao={item} nova agora={agora} aoAbrir={marcarComoLida} />
                  </div>
                ))
              )}
            </section>
          </div>
        )}

        {lista !== null && lista.previous.length > 0 && (
          <div className="flex min-w-0 flex-1 flex-col gap-3.5">
            <h2 className="mx-1.5 mt-1.5 -mb-1 text-[11px] font-extrabold tracking-[1.1px] text-ink-2 uppercase tablet:text-white/90">
              Anteriores
            </h2>
            <section
              aria-label="Anteriores"
              className={`flex flex-col rounded-[24px] bg-card px-[18px] pt-0.5 pb-1 ${SOMBRA_DO_CARTAO}`}
            >
              {lista.previous.map((item) => (
                <div key={item.id} className="border-b border-divider last:border-b-0">
                  <ItemNotificacao notificacao={item} nova={false} agora={agora} aoAbrir={marcarComoLida} />
                </div>
              ))}
            </section>
          </div>
        )}
      </div>

      {lista !== null && (
        <div className="mx-auto flex w-full max-w-[1120px] justify-center px-4 pt-2 pb-8 tablet:px-6 desktop:px-8">
          <Link
            to="/configuracoes#notificacoes"
            className="inline-flex min-h-[44px] items-center gap-1.5 text-[13px] font-extrabold text-primary no-underline"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" />
            </svg>
            Escolher o que avisar
          </Link>
        </div>
      )}
    </section>
  );
}
