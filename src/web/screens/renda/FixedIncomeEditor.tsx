import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import {
  ARRIVAL_CHIP_LABELS,
  ARRIVAL_HELP,
  ARRIVALS,
  type Arrival,
  type Currency,
  type FixedIncomeDto,
  type FixedIncomeField,
  validateFixedIncomeInput,
} from "../../../shared/fixed-incomes";
import { formatMoneyInput, parseMoneyInput } from "../../../shared/money-input";
import { createFixedIncome, deleteFixedIncome, updateFixedIncome } from "../../api/fixed-incomes";
import { MoneyInput } from "../../components/MoneyInput";
import { ApiError } from "../../lib/api";
import { UltimaCotacaoFrase } from "./UltimaCotacaoFrase";

// Editor de uma renda fixa (TASK-0901): a renda nova (renda null) ou a que está selecionada na lista. O pai põe uma
// chave por renda, então cada seleção começa com os valores dela. A validação é a da shared; o servidor confere de novo.

const MENSAGEM_DE_ERRO = "Não deu para salvar agora. Tente de novo.";
const DIA_DA_RENDA_NOVA = 5;
const OPCOES_DE_MOEDA = [
  { value: "BRL", label: "Real" },
  { value: "USD", label: "Dólar" },
];

type Props = {
  renda: FixedIncomeDto | null;
  // As rendas ativas do lar: o nome não pode repetir uma delas (a própria fica de fora na edição).
  existentes: FixedIncomeDto[];
  // Salvou: criada diz se foi uma renda nova.
  aoSalvar: (renda: FixedIncomeDto, criada: boolean) => void;
  aoExcluir: (renda: FixedIncomeDto) => void;
  // A renda não existe mais (outra pessoa excluiu, ou o lar não é o dela): a tela recarrega a lista.
  aoNaoEncontrar: () => void;
};

export function FixedIncomeEditor({ renda, existentes, aoSalvar, aoExcluir, aoNaoEncontrar }: Props) {
  const confirmar = useConfirm();
  const [nome, setNome] = useState(renda?.name ?? "");
  const [moeda, setMoeda] = useState<Currency>(renda?.currency ?? "BRL");
  const [valor, setValor] = useState(renda ? formatMoneyInput(renda.amountCents) : "");
  const [dia, setDia] = useState(renda?.usualDay ?? DIA_DA_RENDA_NOVA);
  const [forma, setForma] = useState<Arrival>(renda?.arrival ?? "auto");
  const [textoDoExtrato, setTextoDoExtrato] = useState(renda?.statementText ?? "");
  // Em dólar, o que fica entra como Investimento por padrão. Em real o valor não se aplica.
  const [ficaEmDolar, setFicaEmDolar] = useState(
    renda?.currency === "USD" ? renda.keptUsdIsInvestment : true,
  );
  const [erros, setErros] = useState<Partial<Record<FixedIncomeField, string>>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const dolar = moeda === "USD";

  // Ao sair do campo, o valor volta formatado ("2000,5" vira "2.000,50"), se for um valor lido.
  function arrumaValor() {
    const centavos = parseMoneyInput(valor);
    if (centavos !== null) setValor(formatMoneyInput(centavos));
  }

  async function salvar() {
    if (salvando) return;
    const validacao = validateFixedIncomeInput(
      {
        name: nome,
        currency: moeda,
        amountCents: parseMoneyInput(valor),
        usualDay: dia,
        arrival: forma,
        statementText: textoDoExtrato,
        keptUsdIsInvestment: ficaEmDolar,
      },
      existentes,
      renda?.id,
    );
    if (!validacao.ok) {
      setErros(validacao.fields);
      setErroGeral(null);
      return;
    }

    setErros({});
    setErroGeral(null);
    setSalvando(true);
    try {
      const salva =
        renda === null
          ? await createFixedIncome(validacao.values)
          : await updateFixedIncome(renda.id, validacao.values);
      aoSalvar(salva, renda === null);
    } catch (erro) {
      if (erro instanceof ApiError && erro.status === 404) aoNaoEncontrar();
      else if (erro instanceof ApiError && erro.status === 422 && erro.fields)
        setErros(erro.fields as Partial<Record<FixedIncomeField, string>>);
      else setErroGeral(MENSAGEM_DE_ERRO);
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (renda === null || excluindo) return;
    const confirmado = await confirmar({
      title: `Excluir ${renda.name}?`,
      description: "O que já foi recebido continua no histórico.",
      confirmLabel: "Excluir",
      cancelLabel: "Cancelar",
      tone: "danger",
    });
    if (!confirmado) return;

    setExcluindo(true);
    setErroGeral(null);
    try {
      await deleteFixedIncome(renda.id);
      aoExcluir(renda);
    } catch (erro) {
      if (erro instanceof ApiError && erro.status === 404) aoNaoEncontrar();
      else setErroGeral(MENSAGEM_DE_ERRO);
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(evento) => {
        evento.preventDefault();
        void salvar();
      }}
    >
      <Card className="flex flex-col gap-5 p-5 tablet:p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="shrink-0 text-[18px] font-extrabold text-ink">
            {renda ? "Editar" : "Nova renda fixa"}
          </h2>
          {renda && <p className="min-w-0 truncate text-[14px] font-bold text-ink-2">{renda.name}</p>}
        </div>

        <TextField
          label="Nome"
          placeholder="Ex.: Salário, Aluguel recebido, Pró-labore"
          value={nome}
          onChange={(evento) => setNome(evento.target.value)}
          error={erros.name}
        />

        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-ink-2">Moeda</span>
          <Segmented
            label="Moeda"
            options={OPCOES_DE_MOEDA}
            value={moeda}
            onChange={(escolhida) => setMoeda(escolhida as Currency)}
          />
        </div>

        <MoneyInput
          label="Valor por ciclo"
          prefixo={dolar ? "US$" : undefined}
          value={valor}
          onChange={setValor}
          onBlur={arrumaValor}
          error={erros.amountCents}
        />

        {dolar && (
          <div className="rounded-tile border border-tile-border bg-field px-4 py-3">
            <p className="text-[14px] font-bold text-ink">Cotação automática</p>
            <p className="mt-1 text-[13px] leading-normal text-ink-2">
              Usa a cotação do dia em que o salário cair. É só referência.
            </p>
            {renda && <UltimaCotacaoFrase renda={renda} />}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] text-ink-2">Costuma cair</span>
            <span className="text-[15px] font-bold text-ink">Todo dia {dia}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Dia anterior"
              onClick={() => setDia((atual) => (atual <= 1 ? 31 : atual - 1))}
              className="flex size-11 items-center justify-center rounded-full border-[1.5px] border-chip-border bg-card text-[18px] font-extrabold text-primary-ink"
            >
              −
            </button>
            <span className="w-9 text-center text-[16px] font-extrabold text-ink tabular-nums">{dia}</span>
            <button
              type="button"
              aria-label="Próximo dia"
              onClick={() => setDia((atual) => (atual >= 31 ? 1 : atual + 1))}
              className="flex size-11 items-center justify-center rounded-full border-[1.5px] border-chip-border bg-card text-[18px] font-extrabold text-primary-ink"
            >
              +
            </button>
          </div>
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-[13px] text-ink-2">Como chega</legend>
          <div className="flex flex-wrap gap-2">
            {ARRIVALS.map((opcao) => (
              // Chip de 44 px: o alvo de toque da spec (o chip padrão tem 40 px).
              <Chip key={opcao} className="h-11" selected={forma === opcao} onClick={() => setForma(opcao)}>
                {ARRIVAL_CHIP_LABELS[opcao]}
              </Chip>
            ))}
          </div>
          <p className="text-[13px] leading-normal text-ink-2">{ARRIVAL_HELP[forma]}</p>
        </fieldset>

        <TextField
          label="Texto que aparece no extrato"
          placeholder="Ex.: SALARIO EMPRESA X"
          value={textoDoExtrato}
          onChange={(evento) => setTextoDoExtrato(evento.target.value)}
          error={erros.statementText}
        />

        {dolar && (
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[15px] font-bold text-ink">O que ficar em dólar é Investimento</span>
              <span className="text-[13px] leading-normal text-ink-2">
                Previsto menos o que foi trazido para o Brasil entra como Investimento no ciclo.
              </span>
            </div>
            <Switch
              checked={ficaEmDolar}
              onCheckedChange={setFicaEmDolar}
              label="O que ficar em dólar é Investimento"
            />
          </div>
        )}

        {erroGeral && (
          <p role="alert" className="text-[13px] font-semibold text-danger">
            {erroGeral}
          </p>
        )}

        <Button type="submit" full loading={salvando}>
          {renda ? "Salvar alterações" : "Adicionar renda fixa"}
        </Button>

        {renda && (
          <button
            type="button"
            onClick={() => void excluir()}
            disabled={excluindo}
            className="min-h-11 self-center text-[15px] font-bold text-danger disabled:opacity-50"
          >
            Excluir esta renda fixa
          </button>
        )}
      </Card>
    </form>
  );
}
