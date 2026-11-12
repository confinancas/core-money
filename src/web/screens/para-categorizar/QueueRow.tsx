import { Link } from "react-router";
import { type AiConfidence, suggestionText } from "../../../shared/categorization";
import { linhaDeDetalhe, textoDaSugestaoDeEntrada } from "../../../shared/para-categorizar";
import type { LinhaDaFila } from "../../api/categorization";
import { IconeCaixa, IconeCartao, IconeCheck } from "../../components/icons";
import { Money } from "../../components/ui/money";

// Uma linha da fila (TASK-0304): ícone por tipo, título e valor, linha de detalhe, sugestão (ou "Sem sugestão") e o ✓
// quando há sugestão de saída. A linha inteira leva ao detalhe. Os textos seguem o protótipo ParaCategorizar.dc.html.

export type Sugestao = { texto: string; cor: string | null };

// Texto da sugestão da linha: categoria (saída) ou renda (entrada). Null quando não há sugestão utilizável.
export function textoDaSugestao(linha: LinhaDaFila): Sugestao | null {
  const s = linha.suggestion;
  if (!s) return null;
  if ("categoryName" in s) {
    const certeza = suggestionText(s.confidence as AiConfidence | null, s.reason);
    if (!s.categoryName) return null;
    return { texto: certeza ? `${s.categoryName} · ${certeza}` : s.categoryName, cor: s.categoryColor };
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

// Nome da categoria da sugestão de saída (para o ✓ e para o aria-label), vazio em entrada.
export function categoriaDaSugestao(linha: LinhaDaFila): string {
  const s = linha.suggestion;
  return s && "categoryName" in s ? (s.categoryName ?? "") : "";
}

const COR_DO_TIPO: Record<LinhaDaFila["kind"], { fundo: string; texto: string }> = {
  pix: { fundo: "#FFF5E4", texto: "#C27400" },
  cartao: { fundo: "#F1E9FD", texto: "#7C4DFF" },
  entrada: { fundo: "#E6F6EE", texto: "#0A7D50" },
  outro: { fundo: "#EEF1F4", texto: "#3D4943" },
};

const SETA_PARA_FORA = "M7 17L17 7M9 7h8v8";
const SETA_PARA_DENTRO = "M17 7L7 17M15 17H7V9";

function IconeDaLinha({ tipo }: { tipo: LinhaDaFila["kind"] }) {
  const cor = COR_DO_TIPO[tipo];
  let icone: React.ReactNode;
  if (tipo === "cartao") icone = <IconeCartao size={18} />;
  else if (tipo === "outro") icone = <IconeCaixa size={18} />;
  else
    icone = (
      <svg
        width={18}
        height={18}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={tipo === "entrada" ? SETA_PARA_DENTRO : SETA_PARA_FORA} />
      </svg>
    );
  return (
    <span
      className="grid size-[38px] shrink-0 place-items-center rounded-[12px]"
      style={{ background: cor.fundo, color: cor.texto }}
    >
      {icone}
    </span>
  );
}

type Props = {
  linha: LinhaDaFila;
  hoje: string;
  iaAtiva: boolean;
  ocupado: boolean;
  aoConfirmar: (linha: LinhaDaFila) => void;
};

export function QueueRow({ linha, hoje, iaAtiva, ocupado, aoConfirmar }: Props) {
  // Sem a chave do Claude a linha não mostra sugestão nem ✓, mesmo que já haja sugestões gravadas (cenário 26).
  const sugestao = iaAtiva ? textoDaSugestao(linha) : null;
  const entrada = linha.kind === "entrada";
  const podeConfirmar = !entrada && sugestao !== null;
  const detalhe = linhaDeDetalhe({
    dataLocal: linha.localDate,
    hoje,
    movement: linha.movement,
    cartao: linha.kind === "cartao",
    banco: linha.institutionName,
  });

  return (
    <li className="flex items-center gap-3 border-b border-divider py-3.5 last:border-b-0">
      <Link
        to={linha.detailPath}
        className="flex min-h-11 min-w-0 flex-1 items-start gap-3 text-ink no-underline"
      >
        <IconeDaLinha tipo={linha.kind} />
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-[15px] font-bold">{linha.title}</span>
            <Money
              cents={entrada ? linha.amountCents : Math.abs(linha.amountCents)}
              sign={entrada ? "always" : "none"}
              className={`shrink-0 text-[15px] font-extrabold ${entrada ? "text-primary" : ""}`}
            />
          </span>
          <span className="text-[12px] text-ink-2">{detalhe}</span>
          {sugestao ? (
            <span className="inline-flex max-w-full items-center gap-[5px] self-start rounded-full bg-primary-soft px-[9px] py-[3px] text-[12px] font-extrabold text-primary-ink">
              {sugestao.cor && (
                <span
                  aria-hidden="true"
                  className="size-[7px] shrink-0 rounded-full"
                  style={{ background: sugestao.cor }}
                />
              )}
              <span className="min-w-0">{sugestao.texto}</span>
            </span>
          ) : (
            <span className="text-[12px] font-extrabold text-warn">Sem sugestão · toque para escolher</span>
          )}
        </span>
      </Link>
      {podeConfirmar && (
        <button
          type="button"
          onClick={() => aoConfirmar(linha)}
          disabled={ocupado}
          aria-label={`Confirmar ${categoriaDaSugestao(linha)} para ${linha.title}`}
          className="grid size-11 shrink-0 place-items-center rounded-full border-[1.5px] border-chip-border bg-card text-primary disabled:opacity-50"
        >
          <IconeCheck size={20} />
        </button>
      )}
    </li>
  );
}
