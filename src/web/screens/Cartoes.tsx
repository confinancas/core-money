import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { RespostaDeCartoes } from "../../shared/api/cards";
import { todayInSaoPaulo } from "../../shared/sao-paulo-date";
import { fetchCards } from "../api/cards";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/empty-state";
import { ErrorState } from "../components/ui/error-state";
import { GlassBubble } from "../components/ui/glass-bubble";
import { GreenTop } from "../components/ui/green-top";
import { EyeToggle } from "../components/ui/hide-values";
import { Money } from "../components/ui/money";
import { SkeletonCard } from "../components/ui/skeleton";
import { CartaoNaLista } from "./cartoes/CartaoNaLista";
import { LinhaDeCompra } from "./cartoes/LinhaDeCompra";
import { textoDeCartoes } from "./cartoes/view-model";

// Tela Cartões (TASK-0402): os cartões do lar, as faturas abertas e as parcelas futuras, e as últimas compras.
// Celular: uma coluna. Tablet: os cartões em grade de duas colunas. Desktop: cartões à esquerda e compras à direita.
export function Cartoes() {
  const navigate = useNavigate();
  const [dados, setDados] = useState<RespostaDeCartoes | null>(null);
  const [falhou, setFalhou] = useState(false);

  const carregar = useCallback(async () => {
    setFalhou(false);
    try {
      setDados(await fetchCards());
    } catch {
      setFalhou(true);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const hoje = todayInSaoPaulo(new Date());

  return (
    <section className="flex min-h-dvh flex-col bg-bg">
      <GreenTop
        variant="tab"
        eyebrow={dados ? textoDeCartoes(dados.cards.length) : undefined}
        title="Cartões"
        actions={<EyeToggle />}
        overlap
      />

      {dados === null ? (
        <div className="mx-auto w-full max-w-[1120px] px-4 pt-6 tablet:px-6">
          {falhou ? <ErrorState onRetry={() => void carregar()} /> : <SkeletonCard />}
        </div>
      ) : (
        <>
          <div className="relative z-10 mx-auto -mt-[76px] grid w-full max-w-[1120px] grid-cols-2 gap-3 px-4 tablet:px-6">
            <GlassBubble>
              <p className="text-[12px] font-bold text-white/82">Faturas abertas</p>
              <Money cents={dados.openBillsCents} className="text-[20px] font-extrabold" />
            </GlassBubble>
            <GlassBubble>
              <p className="text-[12px] font-bold text-white/82">Parcelas futuras</p>
              <Money cents={dados.futureInstallmentsCents} className="text-[20px] font-extrabold" />
            </GlassBubble>
          </div>

          <div className="mx-auto grid w-full max-w-[1120px] items-start gap-5 px-4 pt-6 pb-8 tablet:grid-cols-2 tablet:px-6 desktop:grid-cols-3">
            {dados.cards.length === 0 ? (
              <div className="desktop:col-span-3">
                <EmptyState
                  title="Nenhum cartão ainda"
                  description="Os cartões aparecem aqui quando um banco com cartão de crédito estiver conectado."
                  action={
                    <Button variant="secondary" onClick={() => navigate("/configuracoes/bancos/conectar")}>
                      Conectar banco
                    </Button>
                  }
                />
              </div>
            ) : (
              <>
                <div className="grid min-w-0 gap-4 desktop:col-span-2 desktop:grid-cols-2">
                  {dados.cards.map((cartao) => (
                    <CartaoNaLista key={cartao.id} cartao={cartao} hoje={hoje} />
                  ))}
                </div>
                {dados.recent.length > 0 && (
                  <section aria-labelledby="ultimas-compras" className="min-w-0">
                    <div className="flex flex-col gap-1 rounded-card bg-card px-[22px] py-5 shadow-card">
                      <h2 id="ultimas-compras" className="pb-1 text-[16px] font-extrabold text-ink">
                        Últimas compras
                      </h2>
                      {dados.recent.map((compra) => (
                        <LinhaDeCompra key={compra.id} compra={compra} hoje={hoje} mostrarBanco />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
