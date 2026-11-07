// Sonda da TASK-0201. Confere, na conta real (ou no servidor de fixtures, com PLUGGY_BASE_URL), o que a documentação
// do Pluggy deixa em aberto. Imprime só um JSON de formas e contagens: nada de valor, descrição, nome, documento ou id.
// Entradas só do ambiente do terminal, nunca de arquivo:
//   PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_ITEM_IDS (separados por vírgula) e, opcional, PLUGGY_BASE_URL.
// Uso: npm run pluggy:sonda

import { pathToFileURL } from "node:url";
import { createPluggyClient, type PluggyClient } from "../../src/worker/pluggy/client";
import { PluggyError } from "../../src/worker/pluggy/errors";
import type { PluggyAccount, PluggyConnector, PluggyTransaction } from "../../src/worker/pluggy/types";

const JANELA_DIAS = 60;
const DIA_MS = 86_400_000;
const MES_MS = 30.4375 * DIA_MS;

// Bancos citados na TASK-0201. O rótulo é o que a saída mostra; a chave normalizada (sem acento) é o que casa com o nome.
const BANCOS = [
  { rotulo: "Itaú", chave: "itau" },
  { rotulo: "Bradesco", chave: "bradesco" },
  { rotulo: "Inter", chave: "inter" },
  { rotulo: "Nubank", chave: "nubank" },
];

type Erro = { kind: string; status: number; code: string };
type Contagem = Record<string, number>;
type Etapa<T> = { ok: true; valor: T } | { ok: false; erro: Erro };

export type OpcoesSonda = { fetch?: typeof fetch; now?: () => number };
export type ResultadoSonda = { codigo: 0 | 1; saida: string };

type Agregado = {
  total: number;
  horaDeDate: Contagem;
  porTipoDeConta: Record<string, Record<string, Contagem>>;
  campos: Contagem;
  status: Contagem;
  operationType: Contagem;
  pendentes: Record<string, { total: number; comDataFutura: number }>;
  formaDaParcela: Contagem;
  erros: Erro[];
};

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function rotuloDeBanco(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const alvo = normalizar(texto);
  for (const banco of BANCOS) {
    if (new RegExp(`\\b${banco.chave}\\b`).test(alvo)) return banco.rotulo;
  }
  return null;
}

function presente(valor: unknown): boolean {
  return valor !== null && valor !== undefined;
}

function contar(mapa: Contagem, chave: string): void {
  mapa[chave] = (mapa[chave] ?? 0) + 1;
}

function nomeDoErro(erro: unknown): string {
  return typeof erro === "object" && erro !== null && "name" in erro && typeof erro.name === "string"
    ? erro.name
    : "";
}

async function etapa<T>(operacao: () => Promise<T>): Promise<Etapa<T>> {
  try {
    return { ok: true, valor: await operacao() };
  } catch (erro) {
    if (erro instanceof PluggyError) {
      return { ok: false, erro: { kind: erro.kind, status: erro.status, code: erro.code } };
    }
    throw erro;
  }
}

function formaDoConector(conector: PluggyConnector) {
  return {
    id: conector.id,
    type: conector.type ?? null,
    nomeEhMeuPluggy: conector.name === "MeuPluggy",
    bancoNoNome: rotuloDeBanco(conector.name),
  };
}

function formaDoConsentimento(valor: string | null, agora: number) {
  if (!presente(valor)) return { presente: false, mesesAteVencer: null };
  const fim = Date.parse(valor as string);
  return { presente: true, mesesAteVencer: Number.isNaN(fim) ? null : Math.floor((fim - agora) / MES_MS) };
}

function formaDasContas(contas: PluggyAccount[]) {
  const porTipo: Contagem = {};
  const bancos: Contagem = {};
  let comLimiteUsado = 0;
  let comFechamento = 0;
  let comVencimento = 0;
  for (const conta of contas) {
    contar(porTipo, `${conta.type}/${conta.subtype ?? "(nulo)"}`);
    const rotulo = rotuloDeBanco(`${conta.name ?? ""} ${conta.marketingName ?? ""}`);
    if (rotulo !== null) contar(bancos, rotulo);
    if (presente(conta.bankData?.overdraftUsedLimit)) comLimiteUsado += 1;
    if (presente(conta.creditData?.balanceCloseDate)) comFechamento += 1;
    if (presente(conta.creditData?.balanceDueDate)) comVencimento += 1;
  }
  return {
    total: contas.length,
    porTipo,
    bancoNoNome: bancos,
    comOverdraftUsedLimit: comLimiteUsado,
    comBalanceCloseDate: comFechamento,
    comBalanceDueDate: comVencimento,
  };
}

function novoAgregado(): Agregado {
  return {
    total: 0,
    horaDeDate: {},
    porTipoDeConta: {},
    campos: {
      paymentData: 0,
      payerDocumentNumber: 0,
      receiverDocumentNumber: 0,
      billId: 0,
      billForecastDate: 0,
      installmentNumber: 0,
      category: 0,
      providerId: 0,
    },
    status: {},
    operationType: {},
    pendentes: { BANK: { total: 0, comDataFutura: 0 }, CREDIT: { total: 0, comDataFutura: 0 } },
    formaDaParcela: {},
    erros: [],
  };
}

// Hora de date: meia-noite UTC, 03h UTC (meia-noite de São Paulo) ou outra.
function horaDeDate(date: string): string {
  if (date.endsWith("T00:00:00.000Z")) return "T00:00:00.000Z";
  if (date.endsWith("T03:00:00.000Z")) return "T03:00:00.000Z";
  return "outra";
}

function sinal(valor: number): "amountNegativo" | "amountPositivo" | "amountZero" {
  if (valor < 0) return "amountNegativo";
  if (valor > 0) return "amountPositivo";
  return "amountZero";
}

// Forma do fim da descrição: letra vira A, dígito vira 9, o resto fica. Não sai nenhum texto da descrição.
function formaDeCaractere(caractere: string): string {
  if (/\p{L}/u.test(caractere)) return "A";
  if (/\d/.test(caractere)) return "9";
  return caractere;
}

function formaDoFim(descricao: string): string {
  return [...descricao].slice(-12).map(formaDeCaractere).join("");
}

function acumular(agregado: Agregado, transacao: PluggyTransaction, tipoConta: string, hoje: string): void {
  agregado.total += 1;
  contar(agregado.horaDeDate, horaDeDate(transacao.date ?? ""));

  if (agregado.porTipoDeConta[tipoConta] === undefined) agregado.porTipoDeConta[tipoConta] = {};
  const porTipo = agregado.porTipoDeConta[tipoConta] as Record<string, Contagem>;
  if (porTipo[transacao.type] === undefined) porTipo[transacao.type] = {};
  contar(porTipo[transacao.type] as Contagem, sinal(transacao.amount));

  const meta = transacao.creditCardMetadata;
  const campos: Record<keyof Agregado["campos"], boolean> = {
    paymentData: presente(transacao.paymentData),
    payerDocumentNumber: presente(transacao.paymentData?.payer?.documentNumber),
    receiverDocumentNumber: presente(transacao.paymentData?.receiver?.documentNumber),
    billId: presente(meta?.billId),
    billForecastDate: presente(meta?.billForecastDate),
    installmentNumber: presente(meta?.installmentNumber),
    category: presente(transacao.category),
    providerId: presente(transacao.providerId),
  };
  for (const [nome, tem] of Object.entries(campos)) {
    if (tem) agregado.campos[nome] = (agregado.campos[nome] ?? 0) + 1;
  }

  contar(agregado.status, transacao.status ?? "(nulo)");
  contar(agregado.operationType, transacao.operationType ?? "(nulo)");

  if (transacao.status === "PENDING") {
    if (agregado.pendentes[tipoConta] === undefined)
      agregado.pendentes[tipoConta] = { total: 0, comDataFutura: 0 };
    const pendentes = agregado.pendentes[tipoConta] as { total: number; comDataFutura: number };
    pendentes.total += 1;
    if ((transacao.date ?? "").slice(0, 10) > hoje) pendentes.comDataFutura += 1;
  }

  if (presente(meta?.installmentNumber)) {
    contar(
      agregado.formaDaParcela,
      formaDoFim(transacao.descriptionRaw?.trim() || transacao.description || ""),
    );
  }
}

async function sondarTransacoes(
  cliente: PluggyClient,
  contas: PluggyAccount[],
  hoje: string,
  inicio: string,
): Promise<Agregado> {
  const agregado = novoAgregado();
  for (const conta of contas) {
    // Só a primeira página de cada conta, nos últimos 60 dias.
    const pagina = await etapa(() =>
      cliente.listTransactions({ accountId: conta.id, dateFrom: inicio, dateTo: hoje }),
    );
    if (!pagina.ok) {
      agregado.erros.push(pagina.erro);
      continue;
    }
    for (const transacao of pagina.valor.results) acumular(agregado, transacao, conta.type, hoje);
  }
  return agregado;
}

async function sondarFaturas(cliente: PluggyClient, contas: PluggyAccount[]) {
  const cartoes = contas.filter((conta) => conta.type === "CREDIT");
  const saida = { cartoes: cartoes.length, total: 0, comBillClosingDate: 0, erros: [] as Erro[] };
  for (const cartao of cartoes) {
    const faturas = await etapa(() => cliente.listBills(cartao.id));
    if (!faturas.ok) {
      saida.erros.push(faturas.erro);
      continue;
    }
    saida.total += faturas.valor.length;
    saida.comBillClosingDate += faturas.valor.filter((fatura) => presente(fatura.billClosingDate)).length;
  }
  return saida;
}

function formatoDoDocumento(documento: string | null | undefined): string {
  if (!documento) return "ausente";
  if (/^\d{11}$/.test(documento)) return "11 dígitos";
  if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(documento)) return "formatado";
  return "outro";
}

async function sondarIdentidade(cliente: PluggyClient, itemId: string) {
  const identidade = await etapa(() => cliente.getIdentity(itemId));
  if (!identidade.ok) {
    return { disponivel: false, erro: identidade.erro, formatoDoDocumento: null, tipoDoDocumento: null };
  }
  if (identidade.valor === null) {
    return { disponivel: false, erro: null, formatoDoDocumento: null, tipoDoDocumento: null };
  }
  return {
    disponivel: true,
    erro: null,
    formatoDoDocumento: formatoDoDocumento(identidade.valor.document),
    tipoDoDocumento: identidade.valor.documentType ?? null,
  };
}

async function sondarInvestimentos(cliente: PluggyClient, itemId: string) {
  const investimentos = await etapa(() => cliente.listInvestments(itemId));
  if (!investimentos.ok) {
    return { erro: investimentos.erro, total: 0, porTipo: {}, comCaixinhaOuCofrinho: 0 };
  }
  const porTipo: Contagem = {};
  let caixinhas = 0;
  for (const investimento of investimentos.valor) {
    contar(porTipo, `${investimento.type}/${investimento.subtype ?? "(nulo)"}`);
    if (/caixinha|cofrinho/.test(normalizar(investimento.name ?? ""))) caixinhas += 1;
  }
  return { erro: null, total: investimentos.valor.length, porTipo, comCaixinhaOuCofrinho: caixinhas };
}

async function sondarItem(cliente: PluggyClient, itemId: string, posicao: number, agora: () => number) {
  const item = await etapa(() => cliente.getItem(itemId));
  const contas = await etapa(() => cliente.listAccounts(itemId));
  const hoje = new Date(agora()).toISOString().slice(0, 10);
  const inicio = new Date(agora() - JANELA_DIAS * DIA_MS).toISOString().slice(0, 10);

  return {
    item: posicao,
    erro: item.ok ? null : item.erro,
    conector: item.ok ? formaDoConector(item.valor.connector) : null,
    status: item.ok ? item.valor.status : null,
    executionStatus: item.ok ? item.valor.executionStatus : null,
    erroDoItem: item.ok ? (item.valor.error?.code ?? null) : null,
    products: item.ok ? (item.valor.products ?? null) : null,
    consentimento: item.ok ? formaDoConsentimento(item.valor.consentExpiresAt, agora()) : null,
    contas: contas.ok ? formaDasContas(contas.valor) : { erro: contas.erro },
    transacoes: contas.ok ? await sondarTransacoes(cliente, contas.valor, hoje, inicio) : null,
    faturas: contas.ok ? await sondarFaturas(cliente, contas.valor) : null,
    identidade: await sondarIdentidade(cliente, itemId),
    investimentos: await sondarInvestimentos(cliente, itemId),
  };
}

// Função pura do ponto de vista da saída: recebe o ambiente e devolve o JSON (ou código 1, sem valores).
export async function rodarSonda(
  env: Record<string, string | undefined>,
  opcoes: OpcoesSonda = {},
): Promise<ResultadoSonda> {
  const clientId = env.PLUGGY_CLIENT_ID ?? "";
  const clientSecret = env.PLUGGY_CLIENT_SECRET ?? "";
  const itemIds = (env.PLUGGY_ITEM_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  if (clientId === "" || clientSecret === "" || itemIds.length === 0) return { codigo: 1, saida: "" };

  const agora = opcoes.now ?? (() => Date.now());
  const baseUrl = env.PLUGGY_BASE_URL ? env.PLUGGY_BASE_URL : undefined;
  const cliente = createPluggyClient({
    clientId,
    clientSecret,
    cacheKey: "sonda",
    baseUrl,
    fetch: opcoes.fetch,
    now: agora,
  });

  const itens = [];
  for (const [indice, itemId] of itemIds.entries()) {
    itens.push(await sondarItem(cliente, itemId, indice + 1, agora));
  }
  return { codigo: 0, saida: `${JSON.stringify({ versao: 1, itens }, null, 2)}\n` };
}

async function principal(): Promise<void> {
  try {
    const resultado = await rodarSonda(process.env);
    if (resultado.codigo !== 0) {
      process.stderr.write("Defina PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET e PLUGGY_ITEM_IDS no terminal.\n");
      process.exitCode = 1;
      return;
    }
    process.stdout.write(resultado.saida);
  } catch (erro) {
    process.stderr.write(`Falha inesperada na sonda (${nomeDoErro(erro)}).\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await principal();
}
