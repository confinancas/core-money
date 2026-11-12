import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  cartaoDaIA,
  FILTROS_DA_FILA,
  type FiltroDaFila,
  paraAceitar,
  quantosConfirmados,
} from "../../../shared/para-categorizar";
import { todayInSaoPaulo } from "../../../shared/sao-paulo-date";
import {
  acceptSuggestions,
  fetchQueue,
  type LinhaDaFila,
  type RespostaDaFila,
  undoCategorization,
} from "../../api/categorization";
import { useFeatures } from "../../app/features";
import { IconeCheck } from "../../components/icons";
import { Card } from "../../components/ui/card";
import { ErrorState } from "../../components/ui/error-state";
import { GreenTop } from "../../components/ui/green-top";
import { Segmented } from "../../components/ui/segmented";
import { SkeletonCard } from "../../components/ui/skeleton";
import { categoriaDaSugestao, QueueRow } from "./QueueRow";

// Tela Para categorizar (TASK-0304). Celular e tablet: uma coluna, como o protótipo. Desktop: cartão da IA e filtros à
// esquerda, lista à direita. Cada confirmação fica em "Categorizados agora" com o seu Desfazer, na visita.

const ROTULO_DO_FILTRO: Record<FiltroDaFila, string> = {
  todos: "Todos",
  pix: "Pix",
  cartao: "Cartão",
  entradas: "Entradas",
};

// Uma confirmação da visita: a linha aceita, com as iguais que ela resolveu junto (mesma regra). Desfazer manda os
// itens das duas.
type Confirmada = {
  chave: string;
  nome: string;
  categoria: string;
  cor: string;
  itens: { transactionId: string; categoryId: string }[];
  iguais: number;
};

export function ParaCategorizar() {
  const features = useFeatures();
  const [filtro, setFiltro] = useState<FiltroDaFila>("todos");
  const [dados, setDados] = useState<RespostaDaFila | null>(null);
  const [linhas, setLinhas] = useState<LinhaDaFila[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [falhouAcao, setFalhouAcao] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [confirmadas, setConfirmadas] = useState<Confirmada[]>([]);
  const emCurso = useRef(false);
  const maisEmCurso = useRef(false);

  const carregar = useCallback(async (f: FiltroDaFila, c?: string) => {
    setFalhou(false);
    try {
      const resposta = await fetchQueue(f, c);
      setDados(resposta);
      setLinhas((anteriores) => (c ? [...anteriores, ...resposta.items] : resposta.items));
      setCursor(resposta.nextCursor);
      setTotal((atual) => atual ?? resposta.counts.todos);
    } catch {
      setFalhou(true);
    }
  }, []);

  useEffect(() => {
    setLinhas([]);
    void carregar(filtro);
  }, [filtro, carregar]);

  // Aceita as linhas dadas e guarda cada uma como confirmação da visita. As iguais (alsoResolved) entram na confirmação
  // da regra que as resolveu. O que o servidor devolveu em skipped sai da lista sem entrar em "Categorizados agora".
  const confirmar = async (escolhidas: LinhaDaFila[]) => {
    if (emCurso.current || escolhidas.length === 0) return;
    emCurso.current = true;
    setOcupado(true);
    setFalhouAcao(false);
    try {
      const r = await acceptSuggestions(escolhidas.map((l) => l.transactionId));
      const saidas = new Set([
        ...r.accepted.map((a) => a.transactionId),
        ...r.alsoResolved.map((a) => a.transactionId),
        ...r.skipped,
      ]);
      setLinhas((atuais) => atuais.filter((linha) => !saidas.has(linha.transactionId)));
      const novas: (Confirmada & { regra: string | null })[] = [];
      for (const aceita of r.accepted) {
        if (!aceita.categoryId) continue;
        const linha = escolhidas.find((l) => l.transactionId === aceita.transactionId);
        if (!linha) continue;
        novas.push({
          chave: aceita.transactionId,
          nome: linha.title,
          categoria: categoriaDaSugestao(linha),
          cor:
            (linha.suggestion && "categoryColor" in linha.suggestion && linha.suggestion.categoryColor) ||
            "#0E9A63",
          itens: [{ transactionId: aceita.transactionId, categoryId: aceita.categoryId }],
          iguais: 0,
          regra: aceita.ruleId,
        });
      }
      for (const igual of r.alsoResolved) {
        const dona = novas.find((n) => n.regra !== null && n.regra === igual.ruleId) ?? novas[0];
        if (!dona) continue;
        dona.itens.push({ transactionId: igual.transactionId, categoryId: igual.categoryId });
        dona.iguais += 1;
      }
      if (novas.length > 0) {
        setConfirmadas((antes) => [...antes, ...novas]);
      }
      await carregar(filtro);
    } catch {
      setFalhouAcao(true);
    } finally {
      emCurso.current = false;
      setOcupado(false);
    }
  };

  const desfazerAgora = async (confirmacao: Confirmada) => {
    if (emCurso.current) return;
    emCurso.current = true;
    setOcupado(true);
    setFalhouAcao(false);
    try {
      await undoCategorization(confirmacao.itens);
      setConfirmadas((antes) => antes.filter((c) => c.chave !== confirmacao.chave));
      await carregar(filtro);
    } catch {
      setFalhouAcao(true);
    } finally {
      emCurso.current = false;
      setOcupado(false);
    }
  };

  // "Aceitar": só as linhas carregadas no filtro atual com sugestão de categoria (no máximo 100 por chamada).
  const candidatas = paraAceitar(linhas);
  const aceitarTodas = () => void confirmar(candidatas);

  const verMais = async () => {
    if (!cursor || maisEmCurso.current) return;
    maisEmCurso.current = true;
    setCarregandoMais(true);
    try {
      await carregar(filtro, cursor);
    } finally {
      maisEmCurso.current = false;
      setCarregandoMais(false);
    }
  };

  const contagens = dados?.counts;
  const sugeridas = dados?.suggested;
  const iaAtiva = features.ia;
  const cartao = cartaoDaIA({
    iaAtiva,
    sugeridas: sugeridas?.[filtro] ?? 0,
    total: contagens?.[filtro] ?? 0,
  });
  const faltam = contagens?.todos ?? 0;
  const feitas = quantosConfirmados(confirmadas);
  const percentual = total ? Math.min(100, Math.round((feitas / total) * 100)) : 0;
  const hoje = dados?.hoje ?? todayInSaoPaulo(new Date());

  return (
    <section className="flex min-h-dvh flex-col bg-bg pb-24">
      <GreenTop
        variant="detail"
        title="Para categorizar"
        subtitle="O banco não diz o que foi. Só vocês sabem."
        back={{ to: "/inicio", label: "Voltar ao início" }}
        overlap
      >
        {dados !== null && (
          <div
            className="rounded-[22px] border border-white/22 bg-white/14 px-4 py-3.5"
            data-testid="progresso"
          >
            <div className="flex items-baseline justify-between gap-2.5">
              <span className="text-[14px] font-extrabold">
                {feitas} de {total ?? 0} categorizados
              </span>
              <span className="text-[12px] font-bold text-white/82">
                {faltam === 0 ? "tudo certo" : `faltam ${faltam}`}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Progresso"
              aria-valuemin={0}
              aria-valuemax={total ?? 0}
              aria-valuenow={feitas}
              className="mt-2.5 h-2 overflow-hidden rounded-full bg-white/25"
            >
              <div className="h-full rounded-full bg-white" style={{ width: `${percentual}%` }} />
            </div>
          </div>
        )}
      </GreenTop>

      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-4 tablet:px-6 desktop:grid desktop:grid-cols-[320px_minmax(0,1fr)] desktop:items-start desktop:gap-6">
        <aside className="flex min-w-0 flex-col gap-4">
          {contagens && sugeridas && cartao.modo === "sem_ia" && (
            <Card overlap className="flex items-start gap-3 p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-primary-soft text-primary-ink">
                <IconeSparkle />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[14px] font-extrabold text-ink">Sem IA: vocês escolhem cada um.</span>
                <span className="text-[12px] leading-snug text-ink-2">
                  Com a chave do Claude, o app sugere sozinho.
                </span>
                <Link
                  to="/configuracoes/claude"
                  className="mt-1 inline-flex min-h-11 items-center font-extrabold text-primary-ink underline"
                >
                  Colar a chave
                </Link>
              </span>
            </Card>
          )}
          {contagens && sugeridas && cartao.modo === "com_ia" && (
            <Card overlap className="flex items-center gap-3 p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-primary-soft text-primary-ink">
                <IconeSparkle />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[14px] font-extrabold text-ink">{cartao.titulo}</span>
                <span className="text-[12px] leading-snug text-ink-2">
                  Confira as sugestões abaixo antes de aceitar. O que vocês confirmarem entra sozinho nas
                  próximas vezes.
                </span>
              </span>
              {cartao.podeAceitar && (
                <button
                  type="button"
                  onClick={aceitarTodas}
                  disabled={ocupado || candidatas.length === 0}
                  className="min-h-11 shrink-0 rounded-full bg-primary-ink px-4 text-[12px] font-extrabold tracking-[1px] text-white uppercase disabled:opacity-50"
                >
                  Aceitar
                </button>
              )}
            </Card>
          )}
          <Segmented
            label="Filtrar"
            value={filtro}
            onChange={(valor) => setFiltro(valor as FiltroDaFila)}
            options={FILTROS_DA_FILA.map((f) => ({
              value: f,
              label: `${ROTULO_DO_FILTRO[f]} ${contagens ? contagens[f] : ""}`.trim(),
            }))}
          />
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          {falhouAcao && (
            <p role="alert" className="rounded-2xl bg-danger-bg p-3 text-[13px] font-semibold text-danger">
              Não deu para confirmar agora. Tente de novo.
            </p>
          )}

          {falhou && (
            <Card>
              <ErrorState
                title="Não deu para carregar a fila."
                description="Tente de novo em instantes."
                onRetry={() => void carregar(filtro)}
              />
            </Card>
          )}

          {dados === null && !falhou && <SkeletonCard />}

          {dados !== null && (
            <Card className="px-4 py-1.5" aria-label="Lista">
              {linhas.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-7 text-center">
                  <span className="grid size-[52px] place-items-center rounded-full bg-primary-soft text-primary">
                    <IconeCheck size={26} />
                  </span>
                  <p className="text-[16px] font-extrabold text-ink">
                    {faltam === 0 ? "Tudo categorizado!" : "Nada pendente aqui"}
                  </p>
                </div>
              ) : (
                <ul>
                  {linhas.map((linha) => (
                    <QueueRow
                      key={linha.transactionId}
                      linha={linha}
                      hoje={hoje}
                      iaAtiva={iaAtiva}
                      ocupado={ocupado}
                      aoConfirmar={(l) => void confirmar([l])}
                    />
                  ))}
                </ul>
              )}
              {cursor && (
                <button
                  type="button"
                  onClick={() => void verMais()}
                  disabled={carregandoMais || ocupado}
                  className="my-2 min-h-11 w-full rounded-full font-extrabold text-primary-ink disabled:opacity-50"
                >
                  Ver mais
                </button>
              )}
            </Card>
          )}

          {confirmadas.length > 0 && (
            <Card className="px-4 py-3">
              <p className="pb-1 text-[11px] font-extrabold tracking-[1.1px] text-ink-2 uppercase">
                Categorizados agora · {feitas}
              </p>
              <ul>
                {confirmadas.map((c) => (
                  <li
                    key={c.chave}
                    className="flex items-center justify-between gap-2.5 border-t border-divider py-2.5"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[14px] font-bold">
                        {c.nome}
                        {c.iguais > 0 && <span className="text-ink-2"> · + {c.iguais} iguais</span>}
                      </span>
                      <span className="flex items-center gap-1.5 text-[12px] font-bold text-primary-ink">
                        <span className="size-[7px] rounded-full" style={{ background: c.cor }} />
                        {c.categoria}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void desfazerAgora(c)}
                      disabled={ocupado}
                      className="min-h-11 shrink-0 rounded-full px-3 text-[12px] font-extrabold text-primary-ink disabled:opacity-50"
                    >
                      Desfazer
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}

function IconeSparkle() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" opacity="0.7" />
    </svg>
  );
}
