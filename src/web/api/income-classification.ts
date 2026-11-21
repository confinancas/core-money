import type { IncomeOption } from "../../shared/income";
import { apiEnviar, apiFetch } from "../lib/api";

// Pix recebido (TASK-0903): leitura, prévia e gravação da classificação de uma entrada. O cliente manda a escolha; a
// chave, a renda e a regra saem do servidor.

export type RendaDaEscolha = { id: string; name: string; currency: string };

export type ClassificacaoDaTela = {
  option: IncomeOption;
  fixedIncomeId: string | null;
  incomeSubtype: string | null;
};

export type RespostaDaClassificacao = {
  transaction: {
    id: string;
    movement: string;
    amountCents: number;
    occurredAt: string;
    localDate: string;
    counterpartyName: string | null;
    counterpartyDocMasked: string | null;
    counterpartyBank: string | null;
    pixKeyMasked: string | null;
    institutionName: string | null;
    connectionLabel: string | null;
    originalDescription: string;
    cycleKey: string | null;
    cycleStartsOn: string | null;
    cycleEndsOn: string | null;
  };
  classification: ClassificacaoDaTela | null;
  aiSuggestion: (ClassificacaoDaTela & { confidence: string | null; reason: string | null }) | null;
  fixedIncomes: RendaDaEscolha[];
  rule: (ClassificacaoDaTela & { id: string }) | null;
  canRemember: boolean;
  cycleIncomeCents: number;
};

export type PreviaDaClassificacao = { cycleKey: string | null; beforeCents: number; afterCents: number };

export type EscolhaDaTela = {
  option: IncomeOption;
  fixedIncomeId?: string;
  incomeSubtype?: string;
};

export function fetchIncomeClassification(transactionId: string): Promise<RespostaDaClassificacao> {
  return apiFetch<RespostaDaClassificacao>(`/api/transactions/${transactionId}/income-classification`);
}

export function previewIncomeClassification(
  transactionId: string,
  escolha: EscolhaDaTela,
): Promise<PreviaDaClassificacao> {
  return apiEnviar<PreviaDaClassificacao>(
    `/api/transactions/${transactionId}/income-classification/preview`,
    "POST",
    escolha,
  );
}

export function saveIncomeClassification(
  transactionId: string,
  escolha: EscolhaDaTela & { remember: boolean },
): Promise<{
  classification: ClassificacaoDaTela;
  rule: { id: string } | null;
  cycleIncomeCents: number;
  alsoResolved: string[];
}> {
  return apiFetch(`/api/transactions/${transactionId}/income-classification`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(escolha),
  });
}
