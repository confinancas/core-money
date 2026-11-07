// Tipos das respostas do Pluggy que o cliente usa. Só os campos que o app lê; o resto da resposta é ignorado.
// Fonte: docs.pluggy.ai (páginas citadas na TASK-0201). Campos opcionais seguem a spec, não a doc.

export type PluggyConnector = {
  id: number;
  name: string;
  primaryColor?: string;
  type?: string;
  isSandbox?: boolean;
};

export type PluggyItemStatus = "UPDATED" | "UPDATING" | "OUTDATED" | "LOGIN_ERROR" | "WAITING_USER_INPUT";

export type PluggyItem = {
  id: string;
  connector: PluggyConnector;
  status: PluggyItemStatus;
  executionStatus: string;
  error: { code: string; providerMessage?: string } | null;
  lastUpdatedAt: string | null;
  consentExpiresAt: string | null;
  products?: string[];
};

// subtype: a spec lista CHECKING_ACCOUNT, SAVINGS_ACCOUNT e CREDIT_CARD; o tipo fica string para não recusar outro valor.
export type PluggyAccount = {
  id: string;
  itemId: string;
  type: "BANK" | "CREDIT";
  subtype: string;
  number: string;
  name: string;
  marketingName?: string | null;
  balance: number;
  currencyCode: string;
  bankData?: { overdraftUsedLimit?: number | null; closingBalance?: number | null } | null;
  creditData?: {
    balanceCloseDate?: string | null;
    balanceDueDate?: string | null;
    availableCreditLimit?: number | null;
    creditLimit?: number | null;
    brand?: string | null;
  } | null;
};

export type PluggyParty = {
  name?: string | null;
  documentNumber?: { type: "CPF" | "CNPJ"; value: string } | null;
  routingNumber?: string | null;
  routingNumberISPB?: string | null;
};

export type PluggyTransaction = {
  id: string;
  accountId: string;
  // ISO 8601 em UTC. A convenção de hora é conferida pela sonda (verificação (c)).
  date: string;
  description: string;
  descriptionRaw?: string | null;
  amount: number;
  currencyCode: string;
  type: "DEBIT" | "CREDIT";
  status: "POSTED" | "PENDING";
  category: string | null;
  categoryId?: string | null;
  operationType: string | null;
  providerId?: string | null;
  paymentData?: {
    payer?: PluggyParty | null;
    receiver?: PluggyParty | null;
    paymentMethod?: "PIX" | "TED" | "DOC" | "TEV" | "BOLETO" | null;
  } | null;
  creditCardMetadata?: {
    installmentNumber?: number | null;
    totalInstallments?: number | null;
    billId?: string | null;
    // AAAA-MM. A doc não documenta o campo: a sonda confere (verificação (e)).
    billForecastDate?: string | null;
    purchaseDate?: string | null;
  } | null;
};

export type PluggyBill = {
  id: string;
  dueDate: string;
  billClosingDate: string | null;
  totalAmount: number;
  payments?: { amount: number; paymentDate: string }[] | null;
};

export type PluggyIdentity = {
  document?: string | null;
  documentType?: string | null;
};

export type PluggyInvestment = {
  id: string;
  name: string;
  type: string;
  subtype?: string | null;
  balance: number;
  status?: string | null;
};

// Resposta paginada por página (accounts, bills, investments).
export type PluggyPage<T> = {
  page: number;
  total: number;
  totalPages: number;
  results: T[];
};

// Resposta por cursor de GET /v2/transactions. next é uma query string pronta ("?accountId=...&after=...") ou null.
export type PluggyTransactionsPage = {
  results: PluggyTransaction[];
  next: string | null;
};
