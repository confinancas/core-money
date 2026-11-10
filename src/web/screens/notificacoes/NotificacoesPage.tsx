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

// Central de notificações (/notificacoes, TASK-0701): Novas e Anteriores; no celular, uma coluna com Novas sobre o
// topo; no tablet e no desktop, duas colunas. "Lida" vale para o lar: abrir ou marcar tira da contagem de todos.
const MENSAGEM_DE_ERRO = "Não consegui carregar as notificações.";

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
      setLista(await apiFetch<ListaDeNotificacoes>("/api/notifications"));
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
      <header className="rounded-b-top bg-(image:--gradient-top) px-5 pt-5 pb-[60px] text-white shadow-top tablet:px-10">
        <div className="mx-auto flex w-full max-w-[1120px] items-center gap-3">
          <TopIconButton label="Voltar ao início" to="/inicio" icon={<IconeSeta />} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h1 className="text-[26px] font-extrabold tracking-[-0.4px]">Notificações</h1>
            {lista !== null && <p className="text-[13px] font-semibold text-white/82">{subtitulo(novas)}</p>}
          </div>
          <button
            type="button"
            onClick={marcarTodas}
            disabled={lista === null || novas === 0}
            className={cn(
              "inline-flex min-h-[44px] shrink-0 items-center rounded-full px-4 text-[12px] font-extrabold tracking-[1px] uppercase transition-colors",
              novas > 0
                ? "border border-white/35 bg-white/18 text-white"
                : "cursor-default border-0 bg-white/12 text-white/60",
            )}
          >
            Marcar todas como lidas
          </button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-4 pt-0 pb-8 tablet:grid tablet:grid-cols-2 tablet:items-start tablet:gap-5 tablet:px-6 desktop:px-8">
        {lista === null && !falhou && (
          <div className="col-span-full -mt-11 flex flex-col gap-4">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {falhou && (
          <div className="col-span-full -mt-11">
            <ErrorState title={MENSAGEM_DE_ERRO} onRetry={() => void carregar()} />
          </div>
        )}

        {lista !== null && semNenhuma && (
          <div className="col-span-full -mt-11">
            <div className="rounded-[24px] bg-card px-[18px] py-6 text-center text-[15px] font-bold text-ink-3 shadow-[0_8px_24px_rgba(22,60,45,0.07)]">
              Nenhuma notificação ainda.
            </div>
          </div>
        )}

        {lista !== null && !semNenhuma && (
          <div className="-mt-11 flex min-w-0 flex-col gap-2">
            <h2 className="px-1.5 pt-2.5 text-[11px] font-extrabold tracking-[1.1px] text-ink-2 uppercase">
              Novas
            </h2>
            <div className="flex flex-col rounded-[24px] bg-card px-[18px] pt-2 pb-1 shadow-[0_8px_24px_rgba(22,60,45,0.07)]">
              {lista.new.length === 0 ? (
                <p className="py-4 text-[14px] font-semibold text-ink-3">Nada novo por aqui.</p>
              ) : (
                lista.new.map((item) => (
                  <div key={item.id} className="border-b border-divider last:border-b-0">
                    <ItemNotificacao notificacao={item} nova agora={agora} aoAbrir={marcarComoLida} />
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {lista !== null && lista.previous.length > 0 && (
          <div className="flex min-w-0 flex-col gap-2 tablet:-mt-11">
            <h2 className="px-1.5 pt-2.5 text-[11px] font-extrabold tracking-[1.1px] text-ink-2 uppercase">
              Anteriores
            </h2>
            <div className="flex flex-col rounded-[24px] bg-card px-[18px] pt-0.5 pb-1 shadow-[0_8px_24px_rgba(22,60,45,0.07)]">
              {lista.previous.map((item) => (
                <div key={item.id} className="border-b border-divider last:border-b-0">
                  <ItemNotificacao notificacao={item} nova={false} agora={agora} aoAbrir={marcarComoLida} />
                </div>
              ))}
            </div>
          </div>
        )}

        {lista !== null && (
          <div className="col-span-full flex justify-center">
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
      </div>
    </section>
  );
}
