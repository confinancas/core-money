import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { type AiConfidence, suggestionText } from "../../../shared/categorization";
import {
  cartaoDaIA,
  FILTROS_DA_FILA,
  type FiltroDaFila,
  textoDaSugestaoDeEntrada,
} from "../../../shared/para-categorizar";
import {
  acceptSuggestions,
  fetchQueue,
  type LinhaDaFila,
  type RespostaDaFila,
  undoCategorization,
} from "../../api/categorization";
import { useFeatures } from "../../app/features";
import { ErrorState } from "../../components/ui/error-state";

// Tela Para categorizar (TASK-0304). Celular: uma coluna. Tablet e desktop: a mesma lista, com o cartão da IA e os
// filtros acima. Alvos de toque de 44 px. Os textos seguem o protótipo ParaCategorizar.dc.html.

const ROTULO_DO_FILTRO: Record<FiltroDaFila, string> = {
  todos: "Todos",
  pix: "Pix",
  cartao: "Cartão",
  entradas: "Entradas",
};

const COR_DO_TIPO: Record<LinhaDaFila["kind"], { fundo: string; texto: string }> = {
  pix: { fundo: "#FFF5E4", texto: "#C27400" },
  cartao: { fundo: "#F1E9FD", texto: "#7C4DFF" },
  entrada: { fundo: "#E6F6EE", texto: "#0A7D50" },
  outro: { fundo: "#EEF1F4", texto: "#3D4943" },
};

const reais = (centavos: number): string => {
  const valor = Math.abs(centavos) / 100;
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

type Desfazer = {
  items: { transactionId: string; categoryId: string }[];
  categoria: string;
  cor: string;
  extras: number;
};

// Texto da sugestão da linha: categoria (saída) ou renda (entrada). Null quando não há sugestão.
function textoDaSugestao(linha: LinhaDaFila): { texto: string; cor: string | null } | null {
  const s = linha.suggestion;
  if (!s) return null;
  if ("categoryName" in s) {
    return {
      texto: `${s.categoryName ?? ""} · ${suggestionText(s.confidence as AiConfidence | null, s.reason) ?? ""}`,
      cor: s.categoryColor,
    };
  }
  const texto = textoDaSugestaoDeEntrada({
    option: s.option,
    fixedIncomeName: s.fixedIncomeName,
    incomeSubtype: s.incomeSubtype,
    confidence: s.confidence,
    reason: s.reason,
  });
  return texto === null ? null : { texto, cor: null };
}

export function ParaCategorizar() {
  const navigate = useNavigate();
  const features = useFeatures();
  const [filtro, setFiltro] = useState<FiltroDaFila>("todos");
  const [dados, setDados] = useState<RespostaDaFila | null>(null);
  const [linhas, setLinhas] = useState<LinhaDaFila[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [falhouAcao, setFalhouAcao] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [desfazer, setDesfazer] = useState<Desfazer | null>(null);
  const emCurso = useRef(false);

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

  // Confirma as linhas dadas (uma ou várias). Sai da lista o que foi aceito e o que a confirmação resolveu junto.
  const confirmar = async (
    transactionIds: string[],
    rotulo: { categoria: string; cor: string },
    mapa: Map<string, string>,
  ) => {
    if (emCurso.current || transactionIds.length === 0) return;
    emCurso.current = true;
    setOcupado(true);
    setFalhouAcao(false);
    try {
      const r = await acceptSuggestions(transactionIds);
      const aceitas = r.accepted.map((a) => a.transactionId);
      const iguais = r.alsoResolved.map((a) => a.transactionId);
      const saidas = new Set([...aceitas, ...iguais, ...r.skipped]);
      setLinhas((atuais) => atuais.filter((linha) => !saidas.has(linha.transactionId)));
      const itens = [
        ...r.accepted.map((a) => ({
          transactionId: a.transactionId,
          categoryId: a.categoryId ?? mapa.get(a.transactionId) ?? "",
        })),
        ...r.alsoResolved.map((a) => ({ transactionId: a.transactionId, categoryId: a.categoryId })),
      ].filter((item) => item.categoryId !== "");
      setDesfazer({ items: itens, categoria: rotulo.categoria, cor: rotulo.cor, extras: iguais.length });
      await carregar(filtro);
    } catch {
      setFalhouAcao(true);
    } finally {
      emCurso.current = false;
      setOcupado(false);
    }
  };

  const desfazerAgora = async () => {
    if (!desfazer || emCurso.current) return;
    emCurso.current = true;
    setOcupado(true);
    setFalhouAcao(false);
    try {
      await undoCategorization(desfazer.items);
      setDesfazer(null);
      await carregar(filtro);
    } catch {
      setFalhouAcao(true);
    } finally {
      emCurso.current = false;
      setOcupado(false);
    }
  };

  // "Aceitar": só as linhas carregadas no filtro atual com sugestão de categoria (saídas).
  const aceitarTodas = () => {
    const comCategoria = linhas.filter(
      (l) => l.kind !== "entrada" && l.suggestion && "categoryId" in l.suggestion && l.suggestion.categoryId,
    );
    const mapa = new Map(
      comCategoria.map((l) => [l.transactionId, (l.suggestion as { categoryId: string }).categoryId]),
    );
    void confirmar(
      comCategoria.map((l) => l.transactionId),
      { categoria: "Sugestões", cor: "#0E9A63" },
      mapa,
    );
  };

  const confirmarUma = (linha: LinhaDaFila) => {
    if (!linha.suggestion || !("categoryId" in linha.suggestion) || !linha.suggestion.categoryId) return;
    const categoriaId = linha.suggestion.categoryId;
    void confirmar(
      [linha.transactionId],
      { categoria: linha.suggestion.categoryName ?? "", cor: linha.suggestion.categoryColor ?? "#0E9A63" },
      new Map([[linha.transactionId, categoriaId]]),
    );
  };

  const contagens = dados?.counts;
  const sugeridas = dados?.suggested;
  const cartao = cartaoDaIA({
    iaAtiva: features.ia,
    sugeridas: sugeridas?.[filtro] ?? 0,
    total: contagens?.[filtro] ?? 0,
  });
  const faltam = contagens?.todos ?? 0;
  const feitas = Math.max(0, (total ?? 0) - faltam);
  const percentual = total ? Math.min(100, Math.round((feitas / total) * 100)) : 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 md:px-6">
      <header className="pt-4">
        <button
          type="button"
          onClick={() => navigate("/inicio")}
          className="min-h-11 min-w-11 text-sm font-semibold text-[#0A7D50] underline"
        >
          ← Voltar ao início
        </button>
        <h1 className="mt-2 text-2xl font-extrabold text-[#3D4943]">Para categorizar</h1>
        <p className="text-sm text-[#5B6B63]">O banco não diz o que foi. Só vocês sabem.</p>
        <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm" data-testid="progresso">
          <div className="flex justify-between text-sm font-semibold text-[#3D4943]">
            <span>
              {feitas} de {total ?? 0} categorizados
            </span>
            <span>{faltam === 0 ? "tudo certo" : `faltam ${faltam}`}</span>
          </div>
          <div
            className="mt-2 h-2 rounded-full bg-[#E5EDE9]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total ?? 0}
            aria-valuenow={feitas}
          >
            <div className="h-2 rounded-full bg-[#0E9A63]" style={{ width: `${percentual}%` }} />
          </div>
        </div>
      </header>

      <div className="mt-4 grid gap-4 md:grid-cols-[280px_1fr] lg:grid-cols-[320px_1fr]">
        <aside className="flex flex-col gap-4" data-testid="filtros">
          {contagens && sugeridas && cartao.modo === "sem_ia" && (
            <section className="rounded-2xl bg-white p-4 shadow-sm" aria-label="Sugestões da IA">
              <p className="text-sm font-semibold text-[#3D4943]">Sem IA: vocês escolhem cada um.</p>
              <p className="mt-1 text-xs text-[#5B6B63]">Com a chave do Claude, o app sugere sozinho.</p>
              <Link
                to="/configuracoes/claude"
                className="mt-3 inline-flex min-h-11 items-center font-bold text-[#0A7D50] underline"
              >
                Colar a chave
              </Link>
            </section>
          )}
          {contagens && sugeridas && cartao.modo === "com_ia" && (
            <section className="rounded-2xl bg-white p-4 shadow-sm" aria-label="Sugestões da IA">
              <p className="text-sm font-semibold text-[#3D4943]">{cartao.titulo}</p>
              <p className="mt-1 text-xs text-[#5B6B63]">
                Confira as sugestões abaixo antes de aceitar. O que vocês confirmarem entra sozinho nas
                próximas vezes.
              </p>
              {cartao.podeAceitar && (
                <button
                  type="button"
                  onClick={aceitarTodas}
                  disabled={ocupado || linhas.every((l) => l.kind === "entrada" || !l.suggestion)}
                  className="mt-3 min-h-11 w-full rounded-xl bg-[#0A7D50] px-4 font-bold text-white disabled:opacity-50"
                >
                  Aceitar
                </button>
              )}
            </section>
          )}
          <nav className="flex gap-2 overflow-x-auto" aria-label="Filtros">
            {FILTROS_DA_FILA.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filtro === f}
                onClick={() => setFiltro(f)}
                className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold ${filtro === f ? "bg-[#0A7D50] text-white" : "bg-white text-[#3D4943]"}`}
              >
                {ROTULO_DO_FILTRO[f]} {contagens ? contagens[f] : ""}
              </button>
            ))}
          </nav>
        </aside>

        <section aria-label="Lista" data-testid="lista">
          {falhou && (
            <ErrorState
              title="Não deu para carregar a fila."
              description="Tente de novo em instantes."
              onRetry={() => void carregar(filtro)}
            />
          )}
          {falhouAcao && (
            <p role="alert" className="mb-2 rounded-xl bg-[#FDECEC] p-3 text-sm text-[#9B1C1C]">
              Não deu para confirmar agora. Tente de novo.
            </p>
          )}

          {desfazer && (
            <div className="mb-3 flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm">
              <div>
                <p className="text-sm font-semibold text-[#3D4943]">
                  Categorizados agora · {desfazer.items.length}
                </p>
                <p className="text-xs text-[#5B6B63]">
                  <span
                    className="mr-1 inline-block h-2 w-2 rounded-full"
                    style={{ background: desfazer.cor }}
                  />
                  {desfazer.categoria}
                  {desfazer.extras > 0 ? ` · + ${desfazer.extras} iguais` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void desfazerAgora()}
                disabled={ocupado}
                className="min-h-11 rounded-xl px-4 font-bold text-[#0A7D50] disabled:opacity-50"
              >
                Desfazer
              </button>
            </div>
          )}

          {dados && linhas.length === 0 && !falhou && (
            <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
              {faltam === 0 ? (
                <p className="font-bold text-[#3D4943]">Tudo categorizado!</p>
              ) : (
                <p className="font-bold text-[#3D4943]">Nada pendente aqui</p>
              )}
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {linhas.map((linha) => {
              const cor = COR_DO_TIPO[linha.kind];
              const sugestao = textoDaSugestao(linha);
              const podeConfirmar = linha.kind !== "entrada" && sugestao !== null;
              return (
                <li
                  key={linha.transactionId}
                  className="flex items-center gap-2 rounded-2xl bg-white p-3 shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() => navigate(linha.detailPath)}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xs font-bold"
                      style={{ background: cor.fundo, color: cor.texto }}
                    >
                      {linha.kind === "cartao"
                        ? "Cart"
                        : linha.kind === "entrada"
                          ? "+"
                          : linha.kind === "pix"
                            ? "Pix"
                            : "Out"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-[#3D4943]">{linha.title}</span>
                      <span className="block truncate text-xs text-[#5B6B63]">
                        {linha.localDate.slice(8, 10)}/{linha.localDate.slice(5, 7)}
                        {linha.institutionName ? ` · ${linha.institutionName}` : ""}
                      </span>
                      {sugestao ? (
                        <span className="block truncate text-xs text-[#3D4943]">
                          {sugestao.cor && (
                            <span
                              className="mr-1 inline-block h-2 w-2 rounded-full"
                              style={{ background: sugestao.cor }}
                            />
                          )}
                          {sugestao.texto}
                        </span>
                      ) : (
                        <span className="block text-xs font-semibold text-[#8A5A00]">
                          Sem sugestão · toque para escolher
                        </span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 text-sm font-bold ${linha.amountCents > 0 ? "text-[#0E9A63]" : "text-[#3D4943]"}`}
                    >
                      {linha.amountCents > 0 ? "+" : ""}
                      {reais(linha.amountCents)}
                    </span>
                  </button>
                  {podeConfirmar && (
                    <button
                      type="button"
                      onClick={() => confirmarUma(linha)}
                      disabled={ocupado}
                      aria-label={`Confirmar ${linha.suggestion && "categoryName" in linha.suggestion ? linha.suggestion.categoryName : ""} para ${linha.title}`}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#E6F6EE] font-bold text-[#0A7D50] disabled:opacity-50"
                    >
                      ✓
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {cursor && (
            <button
              type="button"
              onClick={() => void carregar(filtro, cursor)}
              className="mt-3 min-h-11 w-full rounded-xl bg-white font-semibold text-[#0A7D50]"
            >
              Ver mais
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
