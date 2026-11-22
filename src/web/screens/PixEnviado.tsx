import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { cn } from "@/lib/utils";
import type { CorpoDoPatch, DetalheDaCompra } from "../../shared/api/transactions";
import { todayInSaoPaulo } from "../../shared/sao-paulo-date";
import type { SpendType } from "../../shared/spend-types";
import { iniciaisDe } from "../../shared/transactions/counterparty";
import { fetchCategorization, type ScopeDaRegra } from "../api/rules";
import {
  criarRegraDoNome,
  fetchTransaction,
  marcarPagamentoDeCartao,
  patchTransaction,
} from "../api/transactions";
import { destinoDeVoltar } from "../app/frame/aba";
import { useRotaAtual } from "../app/rota-atual";
import { useBreakpoint } from "../app/useBreakpoint";
import { EmptyState } from "../components/ui/empty-state";
import { ErrorState } from "../components/ui/error-state";
import { GreenTop } from "../components/ui/green-top";
import { SkeletonCard } from "../components/ui/skeleton";
import { useQueueNavigation } from "../hooks/useQueueNavigation";
import { ApiError, apiEnviar } from "../lib/api";
import { CardPaymentToggle } from "./transaction/CardPaymentToggle";
import { CardWouldAcceptToggle } from "./transaction/CardWouldAcceptToggle";
import { CategoryCard } from "./transaction/CategoryCard";
import { CounterpartyRows } from "./transaction/CounterpartyRows";
import { HideToggle } from "./transaction/HideToggle";
import { PaymentNotice } from "./transaction/PaymentNotice";
import { QueueFooter } from "./transaction/QueueFooter";
import { RememberToggle } from "./transaction/RememberToggle";
import { SpendTypePicker } from "./transaction/SpendTypePicker";
import { type ResultadoDoNome, TitleCard } from "./transaction/TitleCard";
import { linhaDeData, temTipoDeGasto } from "./transaction/view-model";

// Pix enviado (TASK-0404): o detalhe de um Pix (ou TED) de saída de conta. Tudo grava na hora, menos o rodapé: "Lembrar"
// só cria a regra pelo POST /api/rules da TASK-0302. Em modo fila (?fila=1), o rodapé leva ao próximo item.
// Layout: celular em uma coluna (botão fixo acima do menu); tablet: título, categoria e tipo | dados, chaves e botão;
// desktop: título e categoria | tipo e dados | chaves e botão.

type Previa = {
  ruleCategoryId: string | null;
  ruleSpendType: string | null;
  temRegra: boolean;
  scope: ScopeDaRegra;
  matchLabel: string | null;
};

export function PixEnviado() {
  const { transactionId = "" } = useParams();
  const [busca] = useSearchParams();
  const navegar = useNavigate();
  const localizacao = useLocation();
  const { aba } = useRotaAtual();
  const largura = useBreakpoint();
  const emFila = busca.get("fila") === "1";
  const fila = useQueueNavigation(transactionId, emFila);

  const [dados, setDados] = useState<DetalheDaCompra | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [estado, setEstado] = useState<"carregando" | "pronta" | "falhou" | "nao_existe">("carregando");
  const [erroDe, setErroDe] = useState<
    Partial<Record<"cartao" | "aceita" | "ocultar" | "tipo" | "geral", string>>
  >({});
  const [lembrar, setLembrar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const partida = useRef(0);

  const carregar = useCallback(async () => {
    const esta = ++partida.current;
    setEstado((atual) => (atual === "pronta" ? atual : "carregando"));
    try {
      const [lida, regra] = await Promise.all([
        fetchTransaction(transactionId),
        fetchCategorization(transactionId),
      ]);
      if (esta !== partida.current) return;
      setDados(lida);
      setPrevia({
        ruleCategoryId: regra.rule?.setCategoryId ?? null,
        ruleSpendType: regra.rule?.setSpendType ?? null,
        temRegra: regra.rule !== null,
        scope: regra.scope,
        matchLabel: regra.matchLabel,
      });
      // Lembrar vem ligado sempre que há categoria, com ou sem regra (item 6 dos textos).
      setLembrar(lida.category !== null);
      setEstado("pronta");
    } catch (erro) {
      if (esta !== partida.current) return;
      setEstado(erro instanceof ApiError && erro.status === 404 ? "nao_existe" : "falhou");
    }
  }, [transactionId]);

  useEffect(() => {
    void carregar();
    return () => {
      partida.current++;
    };
  }, [carregar]);

  // Grava um campo na hora, com volta ao valor anterior e aviso quando o PATCH falha.
  async function gravar(
    campo: "cartao" | "aceita" | "ocultar" | "tipo",
    corpo: CorpoDoPatch,
    mudanca: Partial<DetalheDaCompra>,
  ): Promise<boolean> {
    const anterior = dados;
    if (anterior === null) return false;
    setErroDe({});
    setDados({ ...anterior, ...mudanca });
    try {
      setDados(await patchTransaction(transactionId, corpo));
      return true;
    } catch {
      setDados(anterior);
      setErroDe({ [campo]: "Não deu para salvar. Tente de novo." });
      return false;
    }
  }

  // Nome próprio: grava na hora (como na compra) e, com a chave ligada, cria a regra só com o nome.
  async function salvarNome(nome: string | null, comRegra: boolean): Promise<ResultadoDoNome> {
    try {
      setDados(await patchTransaction(transactionId, { customName: nome }));
    } catch {
      return "erro";
    }
    if (!comRegra || nome === null) return "ok";
    try {
      await criarRegraDoNome(transactionId, nome);
      return "ok";
    } catch {
      return "erro_da_regra";
    }
  }

  async function alternarPagamento(ligada: boolean) {
    setErroDe({});
    try {
      await marcarPagamentoDeCartao(transactionId, ligada);
      await carregar();
      // O item entrou ou saiu da fila: o subtítulo e o "faltam" se refazem.
      await fila.recarregar();
    } catch {
      setErroDe({ cartao: "Não deu para salvar. Tente de novo." });
    }
  }

  const voltarPara = destinoDeVoltar(aba);
  const marcaDeHistorico = (localizacao.state as { temHistorico?: unknown } | null)?.temHistorico;
  const temHistorico =
    typeof marcaDeHistorico === "boolean" ? marcaDeHistorico : localizacao.key !== "default";
  function voltar() {
    if (emFila) navegar("/para-categorizar");
    else if (temHistorico) navegar(-1);
    else navegar(voltarPara);
  }

  // Salvar: grava a regra "Lembrar" quando a chave está ligada e a regra falta ou difere; depois segue a fila ou volta.
  async function salvar() {
    if (dados === null) return;
    setSalvando(true);
    setErroDe({});
    try {
      const categoria = dados.category?.id ?? null;
      const precisaRegra =
        lembrar &&
        categoria !== null &&
        (previa === null ||
          !previa.temRegra ||
          previa.ruleCategoryId !== categoria ||
          previa.ruleSpendType !== dados.spendType);
      if (precisaRegra) {
        await apiEnviar("/api/rules", "POST", {
          transactionId,
          set: { categoryId: categoria, spendType: dados.spendType ?? undefined },
          createdFrom: "lembrar",
        });
      }
      if (emFila) {
        navegar(await fila.proximoCaminho(dados.localDate));
      } else if (temHistorico) {
        navegar(-1);
      } else {
        navegar(voltarPara);
      }
    } catch (erro) {
      setErroDe({
        geral: erro instanceof ApiError ? erro.message : "Não deu para salvar. Tente de novo.",
      });
    } finally {
      setSalvando(false);
    }
  }

  const hoje = todayInSaoPaulo(new Date());
  // Título e pílula seguem a base do movimento: uma TED marcada como pagamento de cartão continua TED.
  const ehTed = dados?.baseMovement === "ted_enviada";
  const titulo = ehTed ? "TED enviada" : "Pix enviado";
  const subtitulo =
    emFila && fila.estado !== null && fila.estado.position !== null
      ? `${fila.estado.position} de ${fila.estado.total} para categorizar`
      : undefined;
  const ehPagamento = dados?.isCardPayment === true;
  // A linha de data do Pix diz de qual instituição saiu o dinheiro (TASK-0404).
  const linhaPix =
    dados !== null
      ? `${linhaDeData({ ...dados, card: null, account: null }, hoje)}${
          dados.origin?.institution ? ` · saiu do ${dados.origin.institution}` : ""
        }`
      : undefined;

  return (
    <section className="flex min-h-dvh flex-col bg-bg">
      <GreenTop
        variant="detail"
        title={titulo}
        subtitle={subtitulo}
        back={{ to: emFila ? "/para-categorizar" : voltarPara, label: "Voltar", aoClicar: voltar }}
        actions={
          dados !== null ? (
            <span className="rounded-full bg-white/20 px-3 py-1 text-[12px] font-bold text-white">
              {ehTed ? "TED" : "PIX"}
            </span>
          ) : undefined
        }
        overlap
      />

      {estado === "carregando" && (
        <div className="mx-auto -mt-11 w-full max-w-[1120px] px-4 tablet:px-6">
          <SkeletonCard />
        </div>
      )}
      {estado === "falhou" && (
        <div className="mx-auto -mt-11 w-full max-w-[1120px] px-4 tablet:px-6">
          <ErrorState title="Não deu para abrir este Pix." onRetry={() => void carregar()} />
        </div>
      )}
      {estado === "nao_existe" && (
        <div className="mx-auto -mt-11 w-full max-w-[1120px] px-4 tablet:px-6">
          <EmptyState title="Este Pix não existe mais." />
        </div>
      )}
      {estado === "pronta" && dados !== null && (
        <Corpo
          dados={dados}
          largura={largura}
          topo={
            <>
              <TitleCard
                detalhe={dados}
                hoje={hoje}
                aoSalvarNome={salvarNome}
                avatar={{ iniciais: iniciaisDe(dados.counterparty?.name ?? null) }}
                linhaDaData={linhaPix}
                kind="pix"
              />
              {ehPagamento ? (
                <PaymentNotice />
              ) : (
                <CategoryCard
                  detalhe={dados}
                  aba={aba}
                  temHistorico={temHistorico}
                  prefixoSemCategoria="Pix não diz o que foi. "
                />
              )}
              {(dados.canMarkCardPayment || ehPagamento) && (
                <CardPaymentToggle
                  ligada={ehPagamento}
                  matchLabel={previa?.matchLabel ?? null}
                  preposicao="para"
                  erro={erroDe.cartao ?? null}
                  aoMudar={(ligada) => void alternarPagamento(ligada)}
                />
              )}
            </>
          }
          tipo={
            !ehPagamento && temTipoDeGasto(dados) ? (
              <SpendTypePicker
                kind="pix"
                detalhe={dados}
                erro={erroDe.tipo ?? null}
                aoEscolher={(tipo: SpendType) =>
                  void gravar("tipo", { spendType: tipo }, { spendType: tipo, spendTypeSource: "escolhido" })
                }
              />
            ) : null
          }
          linhas={<CounterpartyRows detalhe={dados} />}
          chaves={
            ehPagamento ? null : (
              <>
                {/* Sem destinatário (escopo diferente ou sem nome) não há o que lembrar: o cartão some. */}
                {previa?.scope === "destinatario" &&
                  previa.matchLabel !== null &&
                  previa.matchLabel !== "" && (
                    <RememberToggle
                      ligada={lembrar && dados.category !== null}
                      desabilitada={dados.category === null}
                      matchLabel={previa.matchLabel}
                      aviso={
                        dados.category === null
                          ? "Escolha a categoria para poder lembrar."
                          : previa.temRegra
                            ? `Os próximos Pix para ${previa.matchLabel} já seguem uma regra. Para desfazer, use Configurações › Regras.`
                            : ""
                      }
                      aoMudar={setLembrar}
                    />
                  )}
                <CardWouldAcceptToggle
                  ligada={dados.cardWouldAccept}
                  erro={erroDe.aceita ?? null}
                  aoMudar={(ligada) =>
                    void gravar("aceita", { cardWouldAccept: ligada }, { cardWouldAccept: ligada })
                  }
                />
                <HideToggle
                  hidden={dados.hidden}
                  erro={erroDe.ocultar ?? null}
                  texto="Para Pix feito por outra pessoa ou em nome dela. Continua no extrato, mas sai dos totais, gráficos e insights."
                  aoMudar={(oculta) =>
                    void gravar(
                      "ocultar",
                      { hidden: oculta },
                      { hidden: oculta, hiddenReason: oculta ? "gasto_terceiros" : null },
                    )
                  }
                />
              </>
            )
          }
          rodape={
            <div
              className={cn(
                "flex flex-col gap-2",
                largura === "celular" && "sticky bottom-24 z-10 rounded-[30px] bg-bg/95 py-2",
              )}
            >
              {erroDe.geral !== undefined && (
                <p role="alert" className="text-[13px] text-danger">
                  {erroDe.geral}
                </p>
              )}
              <QueueFooter
                fila={
                  emFila && fila.estado !== null
                    ? { faltam: fila.estado.faltam, ultimo: fila.estado.faltam === 0 }
                    : null
                }
                salvando={salvando}
                aoClicar={() => void salvar()}
              />
            </div>
          }
        />
      )}
    </section>
  );
}

// As colunas por largura: celular (uma só, e o botão fora dela, para ficar fixo), tablet (título, categoria e tipo |
// dados, chaves e botão) e desktop (título e categoria | tipo e dados | chaves e botão).
function Corpo({
  largura,
  topo,
  tipo,
  linhas,
  chaves,
  rodape,
}: {
  dados: DetalheDaCompra;
  largura: "celular" | "tablet" | "desktop";
  topo: React.ReactNode;
  tipo: React.ReactNode;
  linhas: React.ReactNode;
  chaves: React.ReactNode;
  rodape: React.ReactNode;
}) {
  const coluna = "flex min-w-0 flex-col gap-5";
  return (
    <div
      className={cn(
        "mx-auto -mt-11 grid w-full max-w-[1120px] items-start gap-5 px-4 pb-8 tablet:px-6",
        largura === "desktop" ? "grid-cols-3" : largura === "tablet" ? "grid-cols-2" : "grid-cols-1",
      )}
    >
      {largura === "desktop" && (
        <>
          <div className={coluna}>{topo}</div>
          <div className={coluna}>
            {tipo}
            {linhas}
          </div>
          <div className={coluna}>
            {chaves}
            {rodape}
          </div>
        </>
      )}
      {largura === "tablet" && (
        <>
          <div className={coluna}>
            {topo}
            {tipo}
          </div>
          <div className={coluna}>
            {linhas}
            {chaves}
            {rodape}
          </div>
        </>
      )}
      {largura === "celular" && (
        <>
          <div className={coluna}>
            {topo}
            {tipo}
            {linhas}
            {chaves}
          </div>
          {rodape}
        </>
      )}
    </div>
  );
}
