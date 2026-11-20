import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import type { CorpoDoPatch, DetalheDaCompra } from "../../shared/api/transactions";
import { todayInSaoPaulo } from "../../shared/sao-paulo-date";
import type { SpendType } from "../../shared/spend-types";
import { iniciaisDe } from "../../shared/transactions/counterparty";
import {
  criarRegraDoNome,
  fetchTransaction,
  marcarPagamentoDeCartao,
  patchTransaction,
} from "../api/transactions";
import { type Aba, destinoDeVoltar } from "../app/frame/aba";
import { useRotaAtual } from "../app/rota-atual";
import { ErrorState } from "../components/ui/error-state";
import { GreenTop } from "../components/ui/green-top";
import { SkeletonCard } from "../components/ui/skeleton";
import { useQueueNavigation } from "../hooks/useQueueNavigation";
import { ApiError, apiEnviar, apiFetch } from "../lib/api";
import { CardPaymentToggle } from "./transaction/CardPaymentToggle";
import { CardWouldAcceptToggle } from "./transaction/CardWouldAcceptToggle";
import { CategoryCard } from "./transaction/CategoryCard";
import { CounterpartyRows } from "./transaction/CounterpartyRows";
import { HideToggle } from "./transaction/HideToggle";
import { QueueFooter } from "./transaction/QueueFooter";
import { RememberToggle } from "./transaction/RememberToggle";
import { SpendTypePicker } from "./transaction/SpendTypePicker";
import { type ResultadoDoNome, TitleCard } from "./transaction/TitleCard";
import { temTipoDeGasto } from "./transaction/view-model";

// Pix enviado (TASK-0404): o detalhe de um Pix (ou TED) de saída de conta. Tudo grava na hora, menos o rodapé: "Lembrar"
// só cria a regra pelo POST /api/rules da TASK-0302. Em modo fila (?fila=1), o rodapé leva ao próximo item.

type Previa = {
  ruleCategoryId: string | null;
  ruleSpendType: string | null;
  temRegra: boolean;
  matchLabel: string;
};

export function PixEnviado() {
  const { transactionId = "" } = useParams();
  const [busca] = useSearchParams();
  const navegar = useNavigate();
  const localizacao = useLocation();
  const { aba } = useRotaAtual();
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
        apiFetch<{
          matchLabel: string;
          rule: { setCategoryId: string | null; setSpendType: string | null } | null;
        }>(`/api/rules/${encodeURIComponent(transactionId)}/categorization`),
      ]);
      if (esta !== partida.current) return;
      setDados(lida);
      setPrevia({
        ruleCategoryId: regra.rule?.setCategoryId ?? null,
        ruleSpendType: regra.rule?.setSpendType ?? null,
        temRegra: regra.rule !== null,
        matchLabel: regra.matchLabel,
      });
      // Lembrar nasce ligado quando há categoria e ainda não há regra (protótipo).
      setLembrar(lida.category !== null && regra.rule === null);
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
        navegar(await fila.proximoCaminho());
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
  const titulo = dados?.movement === "ted_enviada" ? "TED enviada" : "Pix enviado";
  const subtitulo =
    emFila && fila.estado !== null && fila.estado.position !== null
      ? `${fila.estado.position} de ${fila.estado.total} para categorizar`
      : undefined;
  const ehPagamento = dados?.isCardPayment === true;
  const categoriaHabilitada = !ehPagamento;
  const avatar = iniciaisDe(dados?.counterparty?.name ?? null);

  return (
    <section className="flex min-h-dvh flex-col bg-bg">
      <GreenTop
        variant="detail"
        title={titulo}
        eyebrow={subtitulo}
        back={{ to: emFila ? "/para-categorizar" : voltarPara, label: "Voltar", aoClicar: voltar }}
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
      {estado === "pronta" && dados !== null && (
        <div className="mx-auto -mt-11 grid w-full max-w-[1120px] items-start gap-5 px-4 pb-8 tablet:grid-cols-2 tablet:px-6 desktop:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-5">
            {avatar !== null && (
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-[13px] font-extrabold text-ink">
                {avatar}
              </span>
            )}
            <TitleCard detalhe={dados} hoje={hoje} aoSalvarNome={salvarNome} />
            <CounterpartyRows detalhe={dados} />
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            {ehPagamento ? (
              <p className="text-[13px] font-semibold text-ink-2">
                Pagamento de cartão · não conta como gasto
              </p>
            ) : (
              <>
                <CategoryCard detalhe={dados} aba={aba} temHistorico={temHistorico} />
                {categoriaHabilitada && temTipoDeGasto(dados) && (
                  <SpendTypePicker
                    detalhe={dados}
                    erro={erroDe.tipo ?? null}
                    aoEscolher={(tipo: SpendType) =>
                      void gravar(
                        "tipo",
                        { spendType: tipo },
                        { spendType: tipo, spendTypeSource: "escolhido" },
                      )
                    }
                  />
                )}
                <RememberToggle
                  ligada={lembrar && dados.category !== null}
                  desabilitada={dados.category === null}
                  matchLabel={previa?.matchLabel ?? "este destinatário"}
                  aviso={
                    dados.category === null
                      ? "Escolha a categoria para poder lembrar."
                      : previa?.temRegra
                        ? `Os próximos Pix para ${previa.matchLabel} já seguem uma regra. Para desfazer, use Configurações › Regras.`
                        : ""
                  }
                  aoMudar={setLembrar}
                />
              </>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <CardPaymentToggle
              ligada={ehPagamento}
              matchLabel={previa?.matchLabel ?? "este destinatário"}
              erro={erroDe.cartao ?? null}
              aoMudar={(ligada) => void alternarPagamento(ligada)}
            />
            {!ehPagamento && (
              <>
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
                  aoMudar={(oculta) =>
                    void gravar(
                      "ocultar",
                      { hidden: oculta },
                      { hidden: oculta, hiddenReason: oculta ? "gasto_terceiros" : null },
                    )
                  }
                />
              </>
            )}
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
        </div>
      )}
    </section>
  );
}
