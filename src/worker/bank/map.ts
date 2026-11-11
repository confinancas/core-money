import { bankNameFromCode } from "../../shared/bank-codes";
import { daysBetween } from "../../shared/cycle";
import { establishmentKey } from "../../shared/establishment-key";
import { toSaoPauloDate } from "../../shared/sao-paulo-date";

// Funções puras: o JSON do Pluggy vira linhas das tabelas (dinheiro em centavos, datas de São Paulo).
// Os tipos abaixo são só os campos que o mapeamento usa. As linhas usam os nomes das colunas (snake_case).

export type AccountKind = "corrente" | "caixinha" | "poupanca" | "outra";
export type BillStatus = "aberta" | "fechada" | "paga" | "futura";
export type Movement =
  | "compra"
  | "estorno"
  | "pix_enviado"
  | "pix_recebido"
  | "ted_enviada"
  | "ted_recebida"
  | "pagamento_fatura"
  | "transferencia_interna"
  | "rendimento"
  | "debito"
  | "boleto"
  | "outro";

type PluggyParty = {
  name?: string | null;
  documentNumber?: { type?: string; value?: string | null } | null;
  routingNumber?: string | null;
  routingNumberISPB?: string | null;
};

export type PluggyAccount = {
  id: string;
  type: "BANK" | "CREDIT";
  subtype?: string | null;
  number?: string | null;
  name: string;
  marketingName?: string | null;
  balance: number;
  bankData?: { overdraftUsedLimit?: number | null } | null;
  creditData?: {
    balanceCloseDate?: string | null;
    balanceDueDate?: string | null;
    creditLimit?: number | null;
    availableCreditLimit?: number | null;
  } | null;
};

export type PluggyInvestment = {
  id: string;
  name: string;
  type?: string | null;
  status?: string | null;
  balance: number;
};

export type PluggyBill = {
  id: string;
  dueDate: string;
  billClosingDate?: string | null;
  totalAmount: number;
  payments?: { amount: number; paymentDate: string }[] | null;
};

export type PluggyTransaction = {
  id: string;
  date: string;
  description: string;
  descriptionRaw?: string | null;
  amount: number;
  type: "DEBIT" | "CREDIT";
  category?: string | null;
  operationType?: string | null;
  paymentData?: {
    paymentMethod?: string | null;
    payer?: PluggyParty | null;
    receiver?: PluggyParty | null;
  } | null;
  creditCardMetadata?: {
    installmentNumber?: number | null;
    totalInstallments?: number | null;
    billId?: string | null;
    billForecastDate?: string | null;
  } | null;
};

// Linhas: nomes das colunas. Valores em centavos; datas de calendário AAAA-MM-DD.
export type AccountRow = {
  id: string;
  kind: AccountKind;
  name: string;
  balance_cents: number;
  overdraft_used_cents: number;
};

export type CardRow = {
  id: string;
  last4: string;
  name: string;
  limit_cents: number | null;
  available_cents: number | null;
};

export type BillRow = {
  id: string;
  closes_on: string;
  due_on: string | null;
  amount_cents: number | null;
  status: BillStatus;
  paid_on: string | null;
};

// Fatura sintética futura que a linha precisa. A gravação (ingestTransactions) cria a linha antes dos movimentos.
export type FuturaRow = { id: string; card_id: string; closes_on: string };

export type MappedTransaction = {
  external_id: string;
  account_id: string | null;
  card_id: string | null;
  bill_id: string | null;
  futura: FuturaRow | null;
  movement: Movement;
  occurred_at: string;
  local_date: string;
  amount_cents: number;
  original_description: string;
  establishment_key: string | null;
  counterparty_name: string | null;
  counterparty_doc_masked: string | null;
  counterparty_bank: string | null;
  installment_number: number | null;
  installment_total: number | null;
  provider_category: string | null;
  provider_operation_type: string | null;
};

// Faturas conhecidas de um cartão: a aberta (só o fechamento importa) e as reais já gravadas.
export type CardBillContext = {
  cardId: string;
  openClosesOn: string | null;
  knownBills: { id: string; closes_on: string }[];
};

export type ContaDaTransacao =
  | { kind: "BANK"; accountId: string }
  | { kind: "CREDIT"; cardId: string; faturas: CardBillContext };

const CAIXINHA = /caixinha|cofrinho|porquinho|reserva/i;
const TED_OPERACOES = new Set(["TED", "DOC", "TRANSFERENCIA_MESMA_INSTITUICAO"]);
const TED_METODOS = new Set(["TED", "DOC", "TEV"]);
const BOLETO_OPERACOES = new Set(["BOLETO", "CONVENIO_ARRECADACAO"]);
const DEBITO_OPERACOES = new Set([
  "CARTAO",
  "SAQUE",
  "PACOTE_TARIFA_SERVICOS",
  "TARIFA_SERVICOS_AVULSOS",
  "ENCARGOS_JUROS_CHEQUE_ESPECIAL",
  "OPERACAO_CREDITO",
]);

// Dinheiro: sinal × arredondamento do valor absoluto, para o arredondamento ser simétrico (-2,5 e 2,5 viram ±3).
// Zero nunca sai como -0.
export function toCents(valor: number): number {
  if (!Number.isFinite(valor)) throw new TypeError("valor monetário precisa ser um número finito");
  const centavos = Math.round(Math.abs(valor) * 100);
  return valor < 0 && centavos !== 0 ? -centavos : centavos;
}

const negativo = (centavos: number): number => (centavos === 0 ? 0 : -centavos);

const centavosOuNulo = (valor: number | null | undefined): number | null =>
  valor === null || valor === undefined ? null : toCents(valor);

// Campos de data só de calendário do Pluggy (dueDate, billClosingDate, balanceCloseDate): os 10 primeiros caracteres.
const dataDeCalendario = (texto: string): string => texto.slice(0, 10);

function somaDias(dataIso: string, dias: number): string {
  const data = new Date(`${dataIso}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function proximoMes(ym: string): string {
  const [ano, mes] = ym.split("-").map(Number);
  return new Date(Date.UTC(ano ?? 0, mes ?? 0, 1)).toISOString().slice(0, 7);
}

// Fechamento de um mês ("AAAA-MM") no dia do cartão, limitado ao último dia do mês.
function fechamentoNoMes(ym: string, dia: number): string {
  const [ano, mes] = ym.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano ?? 0, mes ?? 0, 0)).getUTCDate();
  return `${ym}-${String(Math.min(dia, ultimoDia)).padStart(2, "0")}`;
}

// Primeiro fechamento no dia do cartão que não é antes da data local.
function proximoFechamento(dataLocal: string, dia: number): string {
  const mes = dataLocal.slice(0, 7);
  const neste = fechamentoNoMes(mes, dia);
  return neste >= dataLocal ? neste : fechamentoNoMes(proximoMes(mes), dia);
}

export function sintetica(cardId: string, closesOn: string): string {
  return `sint:${cardId}:${closesOn}`;
}

export function mapAccount(conta: PluggyAccount): AccountRow | null {
  if (conta.type !== "BANK") return null;
  const kind: AccountKind =
    conta.subtype === "CHECKING_ACCOUNT"
      ? "corrente"
      : conta.subtype === "SAVINGS_ACCOUNT"
        ? "poupanca"
        : "outra";
  return {
    id: conta.id,
    kind,
    name: conta.marketingName ?? conta.name,
    balance_cents: toCents(conta.balance),
    overdraft_used_cents: Math.abs(toCents(conta.bankData?.overdraftUsedLimit ?? 0)),
  };
}

// Caixinhas e cofrinhos vêm de /investments. Investimento resgatado por inteiro não entra.
export function mapInvestmentAccount(investimento: PluggyInvestment): AccountRow | null {
  if (investimento.status === "TOTAL_WITHDRAWAL") return null;
  const kind: AccountKind =
    investimento.type === "FIXED_INCOME" && CAIXINHA.test(investimento.name) ? "caixinha" : "outra";
  return {
    id: investimento.id,
    kind,
    name: investimento.name,
    balance_cents: toCents(investimento.balance),
    overdraft_used_cents: 0,
  };
}

export function mapCard(conta: PluggyAccount): CardRow {
  const digitos = (conta.number ?? "").replace(/\D/g, "");
  return {
    id: conta.id,
    last4: digitos.slice(-4),
    name: conta.marketingName ?? conta.name,
    limit_cents: centavosOuNulo(conta.creditData?.creditLimit),
    available_cents: centavosOuNulo(conta.creditData?.availableCreditLimit),
  };
}

// Fatura aberta sintética, com o fechamento que o Pluggy informa. Sem a data de fechamento, null.
export function openBillFromCard(conta: PluggyAccount): BillRow | null {
  const fechamento = conta.creditData?.balanceCloseDate;
  if (!fechamento) return null;
  const vencimento = conta.creditData?.balanceDueDate;
  const closesOn = dataDeCalendario(fechamento);
  return {
    id: sintetica(conta.id, closesOn),
    closes_on: closesOn,
    due_on: vencimento ? dataDeCalendario(vencimento) : null,
    amount_cents: toCents(conta.balance),
    status: "aberta",
    paid_on: null,
  };
}

// Fatura real do Pluggy. Sem data de fechamento, usa o vencimento menos gapDays. Paga quando os pagamentos cobrem o total.
export function mapBill(fatura: PluggyBill, gapDays: number): BillRow {
  const due_on = dataDeCalendario(fatura.dueDate);
  const closes_on = fatura.billClosingDate
    ? dataDeCalendario(fatura.billClosingDate)
    : somaDias(due_on, -gapDays);
  const total = toCents(fatura.totalAmount);
  const pagamentos = fatura.payments ?? [];
  const pago = pagamentos.reduce((soma, pagamento) => soma + toCents(pagamento.amount), 0);
  const quitada = pago >= total;
  const datas = pagamentos.map((pagamento) => dataDeCalendario(pagamento.paymentDate)).sort();
  return {
    id: fatura.id,
    closes_on,
    due_on,
    amount_cents: total,
    status: quitada ? "paga" : "fechada",
    paid_on: quitada && datas.length > 0 ? (datas[datas.length - 1] ?? null) : null,
  };
}

// Monta o contexto de faturas de um cartão a partir das linhas já conhecidas.
export function faturasDoCartao(cardId: string, aberta: BillRow | null, reais: BillRow[]): CardBillContext {
  return {
    cardId,
    openClosesOn: aberta?.closes_on ?? null,
    knownBills: reais.map((fatura) => ({ id: fatura.id, closes_on: fatura.closes_on })),
  };
}

type Resolucao = { billId: string; closesOn: string; futura: boolean };

// Dia de fechamento do cartão: o da aberta, ou o da fatura real mais recente.
function diaDeFechamento(cartao: CardBillContext): number | null {
  const referencia =
    cartao.openClosesOn ??
    cartao.knownBills.reduce<string | null>(
      (maior, fatura) => (maior === null || fatura.closes_on > maior ? fatura.closes_on : maior),
      null,
    );
  return referencia === null ? null : Number(referencia.slice(8, 10));
}

// Um fechamento conhecido: real, aberta, futura (sintética) ou nenhuma (fechamento passado sem fatura real).
function daFechamento(closesOn: string, cartao: CardBillContext): Resolucao | null {
  const real = cartao.knownBills.find((fatura) => fatura.closes_on === closesOn);
  if (real) return { billId: real.id, closesOn, futura: false };
  if (cartao.openClosesOn === closesOn) {
    return { billId: sintetica(cartao.cardId, closesOn), closesOn, futura: false };
  }
  if (cartao.openClosesOn !== null && closesOn < cartao.openClosesOn) return null;
  return { billId: sintetica(cartao.cardId, closesOn), closesOn, futura: true };
}

// Teto do fechamento conhecido (TASK-0204, R10): só vale se estiver a até 35 dias da compra. Mais longe, a compra vai para
// o fechamento calculado do ciclo dela. Sem o teto, as compras de meses sem fatura real caíam todas na primeira fatura
// conhecida, ou na aberta.
const DIAS_MAXIMOS_DO_FECHAMENTO_CONHECIDO = 35;

// Primeiro fechamento conhecido (real ou da aberta) que não é antes da data local. null se não há nenhum.
// Com uma real a cobrir a compra, a releitura não a leva para a aberta de um mês depois (TASK-0202, correção).
function primeiroFechamentoConhecido(dataLocal: string, cartao: CardBillContext): string | null {
  const candidatos = cartao.knownBills.map((fatura) => fatura.closes_on);
  if (cartao.openClosesOn !== null) candidatos.push(cartao.openClosesOn);
  let menor: string | null = null;
  for (const fechamento of candidatos) {
    if (fechamento >= dataLocal && (menor === null || fechamento < menor)) menor = fechamento;
  }
  return menor;
}

// Previsão do Pluggy no formato AAAA-MM. O campo não está na documentação: o que não casa é ignorado.
const FORMATO_DA_PREVISAO = /^\d{4}-\d{2}$/;

// Ordem: (1) fatura do Pluggy conhecida; (2) previsão do mês; (3) primeiro fechamento conhecido (real ou aberta) a partir
// da data; (4) sem nenhum, o próximo fechamento calculado.
function resolverFatura(tx: PluggyTransaction, cartao: CardBillContext): Resolucao | null {
  const conhecida = tx.creditCardMetadata?.billId;
  if (conhecida) {
    const real = cartao.knownBills.find((fatura) => fatura.id === conhecida);
    if (real) return { billId: real.id, closesOn: real.closes_on, futura: false };
  }
  const dia = diaDeFechamento(cartao);
  const previsao = tx.creditCardMetadata?.billForecastDate;
  if (previsao && FORMATO_DA_PREVISAO.test(previsao) && dia !== null) {
    return daFechamento(fechamentoNoMes(previsao, dia), cartao);
  }
  const dataLocal = toSaoPauloDate(tx.date);
  const conhecido = primeiroFechamentoConhecido(dataLocal, cartao);
  if (conhecido !== null && daysBetween(dataLocal, conhecido) <= DIAS_MAXIMOS_DO_FECHAMENTO_CONHECIDO) {
    return daFechamento(conhecido, cartao);
  }
  if (dia !== null) return daFechamento(proximoFechamento(dataLocal, dia), cartao);
  return null;
}

// Fatura de uma compra do cartão, ou null quando o cartão não tem dia de fechamento conhecido.
export function resolveCardBill(
  tx: PluggyTransaction,
  cartao: CardBillContext,
): { billId: string; closesOn: string } | null {
  const resolucao = resolverFatura(tx, cartao);
  return resolucao ? { billId: resolucao.billId, closesOn: resolucao.closesOn } : null;
}

// Parcelas só quando o total passa de uma.
function parcelas(tx: PluggyTransaction): {
  installment_number: number | null;
  installment_total: number | null;
} {
  const total = tx.creditCardMetadata?.totalInstallments ?? null;
  if (total === null || total <= 1) return { installment_number: null, installment_total: null };
  return { installment_number: tx.creditCardMetadata?.installmentNumber ?? null, installment_total: total };
}

// CPF de 11 dígitos vira ***.456.789-** (os 6 do meio). CNPJ de 14 vai formatado inteiro. Outro tamanho: null.
export function mascararDocumento(valor: string | null | undefined): string | null {
  const digitos = (valor ?? "").replace(/\D/g, "");
  if (digitos.length === 11) return `***.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-**`;
  if (digitos.length === 14) {
    return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12, 14)}`;
  }
  return null;
}

// Movimento pela conta e pelo sinal. Conta BANK: DEBIT é saída, CREDIT é entrada. Cartão: valor do Pluggy negativo é pagamento.
export function mapMovement(tx: PluggyTransaction, kind: "BANK" | "CREDIT"): Movement {
  const operacao = tx.operationType ?? "";
  const metodo = tx.paymentData?.paymentMethod ?? "";

  if (kind === "CREDIT") {
    if (tx.amount >= 0) return "compra";
    // PAGAMENTO (TASK-0207): o valor negativo do cartão com essa operação é pagamento, e não estorno.
    if (
      operacao === "PAGAMENTO_FATURA" ||
      operacao === "PAGAMENTO" ||
      tx.category === "Credit card payment"
    ) {
      return "pagamento_fatura";
    }
    if (operacao === "ESTORNO") return "estorno";
    if (operacao === "CASHBACK") return "outro";
    return "estorno";
  }

  if (tx.type !== "CREDIT") {
    if (operacao === "PIX" || metodo === "PIX") return "pix_enviado";
    if (TED_OPERACOES.has(operacao) || TED_METODOS.has(metodo)) return "ted_enviada";
    if (BOLETO_OPERACOES.has(operacao) || metodo === "BOLETO") return "boleto";
    if (DEBITO_OPERACOES.has(operacao)) return "debito";
    return "outro";
  }

  if (operacao === "PIX" || metodo === "PIX") return "pix_recebido";
  if (TED_OPERACOES.has(operacao) || TED_METODOS.has(metodo)) return "ted_recebida";
  if (operacao === "RENDIMENTO_APLIC_FINANCEIRA") return "rendimento";
  if (operacao === "FOLHA_PAGAMENTO" || operacao === "PORTABILIDADE_SALARIO") return "ted_recebida";
  return "outro";
}

// Um movimento do Pluggy vira uma linha. Conta BANK: contraparte (saída: recebedor; entrada: pagador).
export function mapTransaction(tx: PluggyTransaction, conta: ContaDaTransacao): MappedTransaction {
  const original_description = tx.descriptionRaw?.trim() || tx.description;
  const base = {
    external_id: tx.id,
    occurred_at: tx.date,
    local_date: toSaoPauloDate(tx.date),
    original_description,
    establishment_key: establishmentKey(original_description),
    provider_category: tx.category ?? null,
    provider_operation_type: tx.operationType ?? null,
    ...parcelas(tx),
  };

  if (conta.kind === "BANK") {
    const valor = Math.abs(toCents(tx.amount));
    const entrada = tx.type === "CREDIT";
    const parte = entrada ? tx.paymentData?.payer : tx.paymentData?.receiver;
    return {
      ...base,
      account_id: conta.accountId,
      card_id: null,
      bill_id: null,
      futura: null,
      movement: mapMovement(tx, "BANK"),
      amount_cents: entrada ? valor : negativo(valor),
      counterparty_name: parte?.name || null,
      counterparty_doc_masked: mascararDocumento(parte?.documentNumber?.value),
      counterparty_bank: bankNameFromCode(parte?.routingNumber, parte?.routingNumberISPB),
    };
  }

  const resolucao = resolverFatura(tx, conta.faturas);
  return {
    ...base,
    account_id: null,
    card_id: conta.cardId,
    bill_id: resolucao?.billId ?? null,
    futura: resolucao?.futura
      ? { id: resolucao.billId, card_id: conta.cardId, closes_on: resolucao.closesOn }
      : null,
    movement: mapMovement(tx, "CREDIT"),
    amount_cents: negativo(toCents(tx.amount)),
    counterparty_name: null,
    counterparty_doc_masked: null,
    counterparty_bank: null,
  };
}
