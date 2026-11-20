import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { INCOME_OPTIONS, INCOME_SUBTYPES, type IncomeOption } from "../../../shared/income";
import { formatMoney } from "../../../shared/money";
import {
  type EscolhaDaTela,
  fetchIncomeClassification,
  type PreviaDaClassificacao,
  previewIncomeClassification,
  type RespostaDaClassificacao,
  saveIncomeClassification,
} from "../../api/income-classification";
import { ApiError } from "../../lib/api";
import { iniciais, rotuloDoDocumento, textoDaData, textoDeEstado, textoDoImpacto } from "./format";

// Pix recebido (TASK-0903): a pessoa diz como o Pix conta. A prévia do impacto na renda do ciclo vem do servidor, e nada
// é gravado até "Salvar classificação". ?voltar=<caminho> e ?opcao=salario|variavel|reembolso|transferencia.

const OPCOES: { valor: IncomeOption; titulo: string; descricao: string }[] = [
  {
    valor: "salario",
    titulo: "Parte do salário",
    descricao: "Soma na renda fixa do ciclo. Use para o salário em dólar que chega via Pix dos amigos.",
  },
  {
    valor: "variavel",
    titulo: "Renda variável",
    descricao: "Entrou e não é salário: uma venda, rendimento, cashback.",
  },
  {
    valor: "reembolso",
    titulo: "Reembolso de terceiros",
    descricao:
      "Alguém devolvendo o que vocês pagaram por ela, como a parcela de algo no seu cartão. Sai dos cálculos.",
  },
  {
    valor: "transferencia",
    titulo: "Transferência entre vocês",
    descricao: "Dinheiro passando de uma conta do casal para a outra. Não é renda.",
  },
];

const ROTULO_DO_SUBTIPO: Record<string, string> = {
  venda: "Venda",
  rendimento: "Rendimento",
  cashback: "Cashback",
  outro: "Outro",
};

const ehOpcao = (valor: string | null): valor is IncomeOption =>
  valor !== null && (Object.keys(INCOME_OPTIONS) as string[]).includes(valor);

type Estado =
  | { fase: "carregando" }
  | { fase: "erro"; motivo: "nao_encontrado" | "falha" }
  | { fase: "pronto"; dados: RespostaDaClassificacao };

export function PixRecebido() {
  const { transactionId = "" } = useParams();
  const [params] = useSearchParams();
  const navegar = useNavigate();
  const voltar = params.get("voltar") ?? "/renda";
  const opcaoPedida = params.get("opcao");

  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [opcao, setOpcao] = useState<IncomeOption | null>(null);
  const [rendaId, setRendaId] = useState<string | null>(null);
  const [subtipo, setSubtipo] = useState<string | null>(null);
  const [lembrar, setLembrar] = useState(false);
  const [previa, setPrevia] = useState<PreviaDaClassificacao | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [erroAoSalvar, setErroAoSalvar] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const sequencia = useRef(0);

  useEffect(() => {
    let cancelado = false;
    setEstado({ fase: "carregando" });
    fetchIncomeClassification(transactionId)
      .then((dados) => {
        if (cancelado) return;
        const atual = dados.classification;
        const sugestao = dados.aiSuggestion;
        const base = atual ?? sugestao;
        const preferida = ehOpcao(opcaoPedida) ? opcaoPedida : null;
        setOpcao(preferida ?? base?.option ?? null);
        setRendaId(base?.fixedIncomeId ?? null);
        setSubtipo(base?.incomeSubtype ?? null);
        setLembrar(dados.rule !== null || (atual === null && dados.canRemember));
        setEstado({ fase: "pronto", dados });
      })
      .catch((erro: unknown) => {
        if (cancelado) return;
        const motivo = erro instanceof ApiError && erro.status === 404 ? "nao_encontrado" : "falha";
        setEstado({ fase: "erro", motivo });
      });
    return () => {
      cancelado = true;
    };
  }, [transactionId, opcaoPedida]);

  // A prévia é pedida a cada mudança da escolha; a resposta antiga é descartada.
  useEffect(() => {
    if (estado.fase !== "pronto" || opcao === null) return;
    const config = INCOME_OPTIONS[opcao];
    if (config.exigeRenda && !rendaId) return;
    if (config.exigeSubtipo && !subtipo) return;
    const minha = ++sequencia.current;
    const escolha: EscolhaDaTela = {
      option: opcao,
      ...(config.exigeRenda && rendaId ? { fixedIncomeId: rendaId } : {}),
      ...(config.exigeSubtipo && subtipo ? { incomeSubtype: subtipo } : {}),
    };
    previewIncomeClassification(transactionId, escolha)
      .then((resposta) => {
        if (minha === sequencia.current) setPrevia(resposta);
      })
      .catch(() => {
        if (minha === sequencia.current) setPrevia(null);
      });
  }, [estado.fase, opcao, rendaId, subtipo, transactionId]);

  if (estado.fase === "carregando") {
    return <p className="p-6 text-ink-2">Carregando…</p>;
  }
  if (estado.fase === "erro") {
    if (estado.motivo === "nao_encontrado") {
      return <p className="p-6 text-ink-2">Este Pix não foi encontrado.</p>;
    }
    return (
      <div className="p-6">
        <p className="text-ink-2">Não deu para carregar este Pix.</p>
        <button type="button" className="mt-3 font-bold text-primary" onClick={() => navegar(0)}>
          Tentar de novo
        </button>
      </div>
    );
  }

  const dados = estado.dados;
  const t = dados.transaction;
  const entrada = dados.classification;
  const estadoAtual = textoDeEstado(entrada);
  const reembolso = entrada?.option === "reembolso";
  const transferencia = entrada?.option === "transferencia";
  const impacto = previa ? textoDoImpacto(previa.beforeCents, previa.afterCents) : null;
  const titulo = t.movement === "ted_recebida" ? "TED recebida" : "Pix recebido";
  const rotuloDoDoc = rotuloDoDocumento(t.counterpartyDocMasked);
  const contraparte = t.counterpartyName;
  const podeSalvar =
    opcao !== null &&
    (!INCOME_OPTIONS[opcao].exigeRenda || rendaId !== null) &&
    (!INCOME_OPTIONS[opcao].exigeSubtipo || subtipo !== null) &&
    !salvando;

  async function salvar() {
    if (opcao === null) return;
    setSalvando(true);
    setErroAoSalvar(null);
    setCampos({});
    const config = INCOME_OPTIONS[opcao];
    try {
      await saveIncomeClassification(transactionId, {
        option: opcao,
        ...(config.exigeRenda && rendaId ? { fixedIncomeId: rendaId } : {}),
        ...(config.exigeSubtipo && subtipo ? { incomeSubtype: subtipo } : {}),
        remember: lembrar && dados.canRemember,
      });
      navegar(voltar);
    } catch (erro) {
      if (erro instanceof ApiError && erro.status === 422 && erro.fields) {
        setCampos(erro.fields);
      } else {
        setErroAoSalvar("Não deu para salvar. Tente de novo.");
      }
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-5 px-4 pb-28 pt-4 md:max-w-[834px] lg:max-w-[1440px]">
      <header className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Voltar"
          className="min-h-11 min-w-11 text-primary"
          onClick={() => navegar(voltar)}
        >
          ←
        </button>
        <div className="flex flex-col">
          <h1 className="text-[18px] font-extrabold">{titulo}</h1>
          <span className="text-[12px] text-ink-2">{entrada ? "Classificado" : "Para classificar"}</span>
        </div>
        <span className="ml-auto rounded-full bg-primary-soft px-2 py-1 text-[11px] font-extrabold text-primary-ink">
          {t.movement === "ted_recebida" ? "TED" : "PIX"}
        </span>
      </header>

      <section className="flex flex-col items-center gap-2 rounded-[18px] bg-card p-5 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-primary-soft font-extrabold text-primary-ink">
          {iniciais(contraparte)}
        </span>
        {reembolso && (
          <span className="rounded-full bg-divider px-3 py-1 text-[12px] font-bold">
            Reembolso de terceiros · fora dos cálculos
          </span>
        )}
        {transferencia && (
          <span className="rounded-full bg-divider px-3 py-1 text-[12px] font-bold">
            Transferência entre vocês · não é renda
          </span>
        )}
        <p className="text-[15px] font-bold">
          {contraparte ? `Pix de ${contraparte}` : t.originalDescription}
        </p>
        <p
          className={`text-[26px] font-extrabold ${reembolso ? "text-ink-2 line-through" : transferencia ? "text-ink-2" : "text-primary"}`}
        >
          +{formatMoney(t.amountCents)}
        </p>
        <p className="text-[12px] text-ink-2">
          {textoDaData(t.localDate, t.occurredAt)}
          {t.institutionName ? ` · caiu no ${t.institutionName}` : ""}
        </p>
      </section>

      <section className="flex flex-col gap-2 rounded-[18px] bg-card p-4">
        <h2 className="text-[13px] font-bold text-ink-2">Como conta</h2>
        <p className={`text-[15px] font-bold ${estadoAtual.aviso ? "text-amber-700" : ""}`}>
          {estadoAtual.texto}
        </p>
        {dados.aiSuggestion && !entrada && (
          <p className="text-[12px] text-ink-2">
            Sugestão da IA · {dados.aiSuggestion.confidence ?? "sem certeza"}
            {dados.aiSuggestion.reason ? ` · ${dados.aiSuggestion.reason}` : ""}
          </p>
        )}
      </section>

      <fieldset className="flex flex-col gap-2 rounded-[18px] bg-card p-4">
        <legend className="mb-1 text-[13px] font-bold text-ink-2">Como este Pix conta</legend>
        {OPCOES.map((item) => (
          <label
            key={item.valor}
            className="flex cursor-pointer items-start gap-3 rounded-[12px] border border-divider p-3"
          >
            <input
              type="radio"
              name="opcao"
              value={item.valor}
              checked={opcao === item.valor}
              onChange={() => setOpcao(item.valor)}
              className="mt-1"
            />
            <span className="flex flex-col">
              <span className="font-bold">{item.titulo}</span>
              <span className="text-[12px] text-ink-2">{item.descricao}</span>
            </span>
          </label>
        ))}
        {campos.option && <p className="text-[12px] text-red-600">{campos.option}</p>}
      </fieldset>

      {opcao === "salario" && (
        <section className="flex flex-col gap-2 rounded-[18px] bg-card p-4">
          <h2 className="text-[13px] font-bold text-ink-2">Ligar a qual renda fixa</h2>
          {dados.fixedIncomes.length === 0 ? (
            <p className="text-[13px]">
              Nenhuma renda fixa cadastrada.{" "}
              <a className="font-bold text-primary" href="/renda/fixa?nova=1">
                Cadastrar renda fixa
              </a>
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {dados.fixedIncomes.map((renda) => (
                <button
                  key={renda.id}
                  type="button"
                  aria-pressed={rendaId === renda.id}
                  onClick={() => setRendaId(renda.id)}
                  className={`rounded-full px-3 py-2 text-[13px] font-bold ${rendaId === renda.id ? "bg-primary text-white" : "bg-divider"}`}
                >
                  {renda.name}
                </button>
              ))}
            </div>
          )}
          {campos.fixedIncomeId && <p className="text-[12px] text-red-600">{campos.fixedIncomeId}</p>}
        </section>
      )}

      {opcao === "variavel" && (
        <section className="flex flex-col gap-2 rounded-[18px] bg-card p-4">
          <h2 className="text-[13px] font-bold text-ink-2">Que tipo de entrada</h2>
          <div className="flex flex-wrap gap-2">
            {INCOME_SUBTYPES.map((tipo) => (
              <button
                key={tipo}
                type="button"
                aria-pressed={subtipo === tipo}
                onClick={() => setSubtipo(tipo)}
                className={`rounded-full px-3 py-2 text-[13px] font-bold ${subtipo === tipo ? "bg-primary text-white" : "bg-divider"}`}
              >
                {ROTULO_DO_SUBTIPO[tipo]}
              </button>
            ))}
          </div>
          {campos.incomeSubtype && <p className="text-[12px] text-red-600">{campos.incomeSubtype}</p>}
        </section>
      )}

      {impacto && (
        <section className="rounded-[18px] bg-card p-4">
          <p className="text-[13px] text-ink-2">Renda de {previa?.cycleKey ?? "o ciclo"}</p>
          <p className="text-[18px] font-extrabold">{impacto}</p>
        </section>
      )}

      <section className="flex flex-col gap-2 rounded-[18px] bg-card p-4 text-[13px]">
        {contraparte && <Dado rotulo="De" valor={contraparte} />}
        {t.counterpartyDocMasked && rotuloDoDoc && (
          <Dado rotulo={rotuloDoDoc} valor={t.counterpartyDocMasked} />
        )}
        {t.counterpartyBank && <Dado rotulo="Banco de quem enviou" valor={t.counterpartyBank} />}
        {t.pixKeyMasked && <Dado rotulo="Chave usada" valor={t.pixKeyMasked} />}
        {t.institutionName && (
          <Dado
            rotulo="Caiu em"
            valor={`${t.institutionName}${t.connectionLabel ? ` · ${t.connectionLabel}` : ""}`}
          />
        )}
        {t.cycleKey && t.cycleStartsOn && t.cycleEndsOn && (
          <Dado rotulo="Conta no ciclo" valor={`${t.cycleKey} · ${t.cycleStartsOn} – ${t.cycleEndsOn}`} />
        )}
        <Dado rotulo="Descrição do banco" valor={t.originalDescription} />
      </section>

      {dados.canRemember && (
        <section className="flex items-center justify-between gap-3 rounded-[18px] bg-card p-4">
          <div className="flex flex-col">
            <span className="font-bold">{`Lembrar para os próximos Pix de ${contraparte ?? ""}`.trim()}</span>
            <span className="text-[12px] text-ink-2">
              A escolha vira regra para esse remetente. Dá para desfazer em Configurações › Regras.
            </span>
          </div>
          <input
            type="checkbox"
            role="switch"
            aria-label={`Lembrar para os próximos Pix de ${contraparte ?? ""}`.trim()}
            checked={lembrar}
            onChange={(evento) => setLembrar(evento.target.checked)}
          />
        </section>
      )}

      {erroAoSalvar && <p className="text-[13px] text-red-600">{erroAoSalvar}</p>}

      <div className="fixed inset-x-0 bottom-0 bg-card p-4 shadow-md md:static md:bg-transparent md:p-0 md:shadow-none">
        <button
          type="button"
          disabled={!podeSalvar}
          onClick={salvar}
          className="mx-auto block w-full max-w-[560px] rounded-full bg-primary py-3 font-extrabold text-white disabled:opacity-50"
        >
          Salvar classificação
        </button>
      </div>
    </div>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-2">{rotulo}</span>
      <span className="text-right font-bold">{valor}</span>
    </div>
  );
}
