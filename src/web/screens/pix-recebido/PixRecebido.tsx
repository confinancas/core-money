// biome-ignore-all lint/a11y/useSemanticElements: o desenho pede cartões com role radio (protótipo), não o radio nativo
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { INCOME_OPTIONS, INCOME_SUBTYPES, type IncomeOption } from "../../../shared/income";
import {
  type EscolhaDaTela,
  fetchIncomeClassification,
  type PreviaDaClassificacao,
  previewIncomeClassification,
  type RespostaDaClassificacao,
  saveIncomeClassification,
} from "../../api/income-classification";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { GreenTop } from "../../components/ui/green-top";
import { Money } from "../../components/ui/money";
import { SkeletonCard } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import { ApiError } from "../../lib/api";
import { cn } from "../../lib/utils";
import { caminhoSeguro } from "../categorias/voltar";
import {
  destinoDaVolta,
  estadoDaEscolha,
  iniciais,
  linhaDaSugestao,
  mesDoCiclo,
  rotuloDoDocumento,
  textoDaData,
  textoDoCiclo,
} from "./format";

// Pix recebido (TASK-0903): a pessoa diz como o Pix conta. A prévia do impacto na renda do ciclo vem do servidor, e nada
// é gravado até "Salvar classificação". ?voltar=<caminho> e ?opcao=salario|variavel|reembolso|transferencia.
// Celular: uma coluna; tablet: destaque e escolha à esquerda, dados e lembrar à direita; desktop: três colunas.

// Ícones das opções (traço de 2 px, 20 px), os do protótipo PixRecebido.dc.html.
const OPCOES: { valor: IncomeOption; titulo: string; descricao: string; icone: string }[] = [
  {
    valor: "salario",
    titulo: "Parte do salário",
    descricao: "Soma na renda fixa do ciclo. Use para o salário em dólar que chega via Pix dos amigos.",
    icone: "M4 7h16v12H4zM8 7V5h8v2M4 12h16",
  },
  {
    valor: "variavel",
    titulo: "Renda variável",
    descricao: "Entrou e não é salário: uma venda, rendimento, cashback.",
    icone: "M12 4v16M8 8h6a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h7",
  },
  {
    valor: "reembolso",
    titulo: "Reembolso de terceiros",
    descricao:
      "Alguém devolvendo o que vocês pagaram por ela, como a parcela de algo no seu cartão. Sai dos cálculos.",
    icone: "M9 14l-5-5 5-5M4 9h11a5 5 0 0 1 0 10h-3",
  },
  {
    valor: "transferencia",
    titulo: "Transferência entre vocês",
    descricao: "Dinheiro passando de uma conta do casal para a outra. Não é renda.",
    icone: "M7 7h13l-3-3M17 17H4l3 3",
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
  const localizacao = useLocation();
  const voltarPedido = caminhoSeguro(params.get("voltar"));
  const opcaoPedida = params.get("opcao");
  const temHistorico = localizacao.key !== "default";

  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  const [opcao, setOpcao] = useState<IncomeOption | null>(null);
  const [rendaId, setRendaId] = useState<string | null>(null);
  const [subtipo, setSubtipo] = useState<string | null>(null);
  const [lembrar, setLembrar] = useState(false);
  const [previa, setPrevia] = useState<PreviaDaClassificacao | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [erroAoSalvar, setErroAoSalvar] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const sequencia = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tentativa` só serve para pedir a carga de novo
  useEffect(() => {
    let cancelado = false;
    setEstado({ fase: "carregando" });
    fetchIncomeClassification(transactionId)
      .then((dados) => {
        if (cancelado) return;
        const atual = dados.classification;
        const base = atual ?? dados.aiSuggestion;
        const preferida = ehOpcao(opcaoPedida) ? opcaoPedida : null;
        setOpcao(preferida ?? base?.option ?? null);
        setRendaId(base?.fixedIncomeId ?? null);
        setSubtipo(base?.incomeSubtype ?? null);
        setLembrar(dados.rule !== null || (atual === null && dados.canRemember));
        setEstado({ fase: "pronto", dados });
      })
      .catch((erro: unknown) => {
        if (cancelado) return;
        // 404 (outro lar ou inexistente) e 422 nao_e_entrada (um Pix enviado) são o mesmo para a pessoa.
        const naoAcho =
          erro instanceof ApiError &&
          (erro.status === 404 || (erro.status === 422 && erro.code === "nao_e_entrada"));
        setEstado({ fase: "erro", motivo: naoAcho ? "nao_encontrado" : "falha" });
      });
    return () => {
      cancelado = true;
    };
  }, [transactionId, opcaoPedida, tentativa]);

  // A prévia é pedida a cada mudança da escolha, cancelando a anterior. Escolha incompleta limpa o impacto (e invalida
  // qualquer resposta que ainda esteja a caminho): a linha "→" de uma escolha velha nunca fica na tela.
  useEffect(() => {
    const minha = ++sequencia.current;
    if (estado.fase !== "pronto" || opcao === null) {
      setPrevia(null);
      return;
    }
    const config = INCOME_OPTIONS[opcao];
    if ((config.exigeRenda && !rendaId) || (config.exigeSubtipo && !subtipo)) {
      setPrevia(null);
      return;
    }
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

  function voltar() {
    const destino = destinoDaVolta(voltarPedido, temHistorico);
    if (destino === -1) navegar(-1);
    else navegar(destino);
  }

  const dados = estado.fase === "pronto" ? estado.dados : null;
  const t = dados?.transaction ?? null;
  const entrada = dados?.classification ?? null;
  const ted = t?.movement === "ted_recebida";
  const titulo = ted ? "TED recebida" : "Pix recebido";

  const topo = (
    <GreenTop
      variant="detail"
      title={titulo}
      subtitle={dados === null ? undefined : entrada ? "Classificado" : "Para classificar"}
      back={{ to: voltarPedido ?? "/renda", label: "Voltar", aoClicar: voltar }}
      actions={
        t === null ? undefined : (
          <span className="inline-flex h-[30px] min-w-11 items-center justify-center rounded-[15px] bg-white/18 px-2.5 text-[12px] font-extrabold">
            {ted ? "TED" : "PIX"}
          </span>
        )
      }
      overlap
    />
  );

  if (estado.fase === "carregando" || estado.fase === "erro" || dados === null || t === null) {
    return (
      <section className="flex min-h-dvh flex-col bg-bg">
        {topo}
        <div className="mx-auto -mt-11 w-full max-w-[1120px] px-4 tablet:px-6">
          {estado.fase === "carregando" && <SkeletonCard />}
          {estado.fase === "erro" && estado.motivo === "nao_encontrado" && (
            <EmptyState title="Este Pix não foi encontrado." />
          )}
          {estado.fase === "erro" && estado.motivo === "falha" && (
            <ErrorState title="Não deu para carregar este Pix." onRetry={() => setTentativa((n) => n + 1)} />
          )}
        </div>
      </section>
    );
  }

  // O selo, o riscado e o cinza seguem a escolha atual da tela, não a classificação salva.
  const reembolso = opcao === "reembolso";
  const transferencia = opcao === "transferencia";
  const status = estadoDaEscolha(opcao, subtipo);
  const haImpacto = previa !== null && previa.beforeCents !== previa.afterCents && previa.cycleKey !== null;
  const rotuloDoDoc = rotuloDoDocumento(t.counterpartyDocMasked);
  const contraparte = t.counterpartyName;
  const nomeParaLembrar = contraparte ?? "";
  const podeSalvar =
    opcao !== null &&
    (!INCOME_OPTIONS[opcao].exigeRenda || rendaId !== null) &&
    (!INCOME_OPTIONS[opcao].exigeSubtipo || subtipo !== null) &&
    !salvando;

  async function salvar() {
    if (opcao === null || dados === null) return;
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
      voltar();
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

  const dadosDoPix: { rotulo: string; valor: string }[] = [];
  if (contraparte) dadosDoPix.push({ rotulo: "De", valor: contraparte });
  if (t.counterpartyDocMasked && rotuloDoDoc)
    dadosDoPix.push({ rotulo: rotuloDoDoc, valor: t.counterpartyDocMasked });
  if (t.counterpartyBank) dadosDoPix.push({ rotulo: "Banco de quem enviou", valor: t.counterpartyBank });
  if (t.pixKeyMasked) dadosDoPix.push({ rotulo: "Chave usada", valor: t.pixKeyMasked });
  if (t.institutionName) {
    dadosDoPix.push({
      rotulo: "Caiu em",
      valor: `${t.institutionName}${t.connectionLabel ? ` · ${t.connectionLabel}` : ""}`,
    });
  }
  if (t.cycleKey && t.cycleStartsOn && t.cycleEndsOn) {
    dadosDoPix.push({
      rotulo: "Conta no ciclo",
      valor: textoDoCiclo(t.cycleKey, t.cycleStartsOn, t.cycleEndsOn),
    });
  }

  return (
    <section className="flex min-h-dvh flex-col bg-bg">
      {topo}
      <div className="mx-auto -mt-11 grid w-full max-w-[1120px] items-start gap-5 px-4 pb-8 tablet:grid-cols-2 tablet:px-6 desktop:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 tablet:col-start-1 tablet:row-start-1 desktop:col-start-1">
          <Card className="flex flex-col items-center gap-2 px-[22px] py-6 text-center">
            <span className="mb-0.5 grid size-[52px] place-items-center rounded-full bg-primary-soft text-[18px] font-black text-primary-ink">
              {iniciais(contraparte)}
            </span>
            {reembolso && (
              <span className="rounded-full border border-dashed border-hidden-border bg-[repeating-linear-gradient(135deg,var(--color-hidden-a)_0_7px,var(--color-hidden-b)_7px_14px)] px-3 py-[5px] text-[12px] font-extrabold text-ink-3">
                Reembolso de terceiros · fora dos cálculos
              </span>
            )}
            {transferencia && (
              <span className="rounded-full border border-tile-border bg-divider px-3 py-[5px] text-[12px] font-extrabold text-ink-3">
                Transferência entre vocês · não é renda
              </span>
            )}
            <p className="text-[20px] font-extrabold">
              {contraparte ? `Pix de ${contraparte}` : t.originalDescription}
            </p>
            <Money
              cents={t.amountCents}
              sign="always"
              struck={reembolso}
              className={cn(
                "text-[44px] font-extrabold tracking-[-1px]",
                !reembolso && (transferencia ? "text-ink-2" : "text-primary"),
              )}
            />
            <p className="text-[13px] text-ink-2">
              {textoDaData(t.localDate, t.occurredAt)}
              {t.institutionName ? ` · caiu no ${t.institutionName}` : ""}
            </p>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5 tablet:col-start-1 tablet:row-start-2 desktop:col-start-2 desktop:row-start-1">
          <Card className="flex flex-col gap-3 px-5 py-[18px]">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[16px] font-extrabold">Como conta</h2>
              <span
                className={cn("text-[13px] font-extrabold", status.aviso ? "text-warn" : "text-primary-ink")}
              >
                {status.texto}
              </span>
            </div>
            {dados.aiSuggestion && !entrada && (
              <p className="-mt-1 text-[12px] text-ink-2">
                {linhaDaSugestao(dados.aiSuggestion.confidence, dados.aiSuggestion.reason)}
              </p>
            )}
            <div role="radiogroup" aria-label="Como este Pix conta" className="flex flex-col gap-2">
              {OPCOES.map((item) => {
                const ligada = opcao === item.valor;
                return (
                  <button
                    key={item.valor}
                    type="button"
                    role="radio"
                    aria-checked={ligada}
                    onClick={() => setOpcao(item.valor)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[18px] border-[1.5px] p-3 text-left transition-colors",
                      ligada
                        ? "border-primary bg-[#F2FBF6] shadow-[0_6px_16px_rgba(14,154,99,0.14)]"
                        : "border-tile-border bg-card",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-[13px]",
                        ligada ? "bg-primary text-white" : "bg-primary-soft text-primary-ink",
                      )}
                    >
                      <IconeDaOpcao caminho={item.icone} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[15px] font-extrabold text-ink">{item.titulo}</span>
                      <span className="text-[12px] leading-[1.4] font-semibold text-ink-2">
                        {item.descricao}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-[22px] shrink-0 place-items-center rounded-full border-2",
                        ligada ? "border-primary" : "border-[#C6D0CB]",
                      )}
                    >
                      <span
                        className={cn("size-2.5 rounded-full", ligada ? "bg-primary" : "bg-transparent")}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
            {campos.option && <p className="text-[12px] font-semibold text-danger">{campos.option}</p>}

            {opcao === "salario" && (
              <Escolhas titulo="Ligar a qual renda fixa">
                {dados.fixedIncomes.length === 0 ? (
                  <p className="text-[13px] text-ink-2">
                    Nenhuma renda fixa cadastrada.{" "}
                    <Link className="font-extrabold text-primary-ink underline" to="/renda/fixa?nova=1">
                      Cadastrar renda fixa
                    </Link>
                  </p>
                ) : (
                  dados.fixedIncomes.map((renda) => (
                    <ChipDaEscolha
                      key={renda.id}
                      ligado={rendaId === renda.id}
                      aoEscolher={() => setRendaId(renda.id)}
                    >
                      {renda.name}
                    </ChipDaEscolha>
                  ))
                )}
                {campos.fixedIncomeId && (
                  <p className="w-full text-[12px] font-semibold text-danger">{campos.fixedIncomeId}</p>
                )}
              </Escolhas>
            )}
            {opcao === "variavel" && (
              <Escolhas titulo="Que tipo de entrada">
                {INCOME_SUBTYPES.map((tipo) => (
                  <ChipDaEscolha key={tipo} ligado={subtipo === tipo} aoEscolher={() => setSubtipo(tipo)}>
                    {ROTULO_DO_SUBTIPO[tipo]}
                  </ChipDaEscolha>
                ))}
                {campos.incomeSubtype && (
                  <p className="w-full text-[12px] font-semibold text-danger">{campos.incomeSubtype}</p>
                )}
              </Escolhas>
            )}

            {haImpacto && previa?.cycleKey && (
              <div className="flex items-center justify-between gap-2.5 rounded-[16px] bg-primary-soft px-3.5 py-3">
                <span className="text-[13px] font-bold text-primary-ink">
                  Renda de {mesDoCiclo(previa.cycleKey)}
                </span>
                <span className="text-[13px] font-bold whitespace-nowrap text-ink-3 tabular-nums">
                  <Money cents={previa.beforeCents} /> →{" "}
                  <Money cents={previa.afterCents} className="font-black text-primary-ink" />
                </span>
              </div>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5 tablet:col-start-2 tablet:row-span-2 tablet:row-start-1 desktop:col-start-3 desktop:row-span-1">
          <Card className="flex flex-col px-[22px] py-1.5">
            {dadosDoPix.map((linha) => (
              <div
                key={linha.rotulo}
                className="flex min-h-11 items-center justify-between gap-3 border-divider border-b py-2.5 text-[14px]"
              >
                <span className="shrink-0 text-ink-3">{linha.rotulo}</span>
                <span className="text-right font-semibold">{linha.valor}</span>
              </div>
            ))}
            <div className="flex flex-col gap-1 py-3">
              <span className="text-[14px] text-ink-3">Descrição do banco</span>
              <span className="break-words text-[13px] font-extrabold text-ink-3">
                {t.originalDescription}
              </span>
            </div>
          </Card>

          {dados.canRemember && (
            <Card className="flex items-center justify-between gap-4 px-[22px] py-[18px]">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[15px] font-bold">
                  {`Lembrar para os próximos Pix de ${nomeParaLembrar}`.trim()}
                </span>
                <span className="text-[12px] leading-[1.45] text-ink-2">
                  A escolha vira regra para esse remetente. Dá para desfazer em Configurações › Regras.
                </span>
              </div>
              <Switch
                checked={lembrar}
                onCheckedChange={setLembrar}
                label={`Lembrar para os próximos Pix de ${nomeParaLembrar}`.trim()}
              />
            </Card>
          )}

          {erroAoSalvar && (
            <p role="alert" className="rounded-2xl bg-danger-bg p-3 text-[13px] font-semibold text-danger">
              {erroAoSalvar}
            </p>
          )}
          <Button full disabled={!podeSalvar} loading={salvando} onClick={() => void salvar()}>
            Salvar classificação
          </Button>
        </div>
      </div>
    </section>
  );
}

function IconeDaOpcao({ caminho }: { caminho: string }) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={caminho} />
    </svg>
  );
}

function Escolhas({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 pt-1">
      <span className="text-[11px] font-extrabold tracking-[1.1px] text-ink-2 uppercase">{titulo}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// Chip do protótipo: ligado é verde cheio com texto branco; desligado, borda clara.
function ChipDaEscolha({
  ligado,
  aoEscolher,
  children,
}: {
  ligado: boolean;
  aoEscolher: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ligado}
      onClick={aoEscolher}
      className={cn(
        "relative inline-flex min-h-10 items-center rounded-full px-3.5 text-[13px] font-extrabold transition-colors",
        "before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
        ligado ? "bg-primary text-white" : "border-[1.5px] border-chip-border bg-card text-primary-ink",
      )}
    >
      {children}
    </button>
  );
}
