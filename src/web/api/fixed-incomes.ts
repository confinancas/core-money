import type { FixedIncomeDto, FixedIncomesResponse, FixedIncomeValues } from "../../shared/fixed-incomes";
import { apiEnviar, apiFetch } from "../lib/api";

// Rendas fixas (TASK-0901): a tela RendaFixa e a seção de Configurações. Os contratos são os da spec; a validação
// é a mesma nos dois lados (src/shared/fixed-incomes.ts), e o servidor confere de novo.

const JSON_HEADERS = { "content-type": "application/json" };

export function fetchFixedIncomes(): Promise<FixedIncomesResponse> {
  return apiFetch<FixedIncomesResponse>("/api/fixed-incomes");
}

export function createFixedIncome(valores: FixedIncomeValues): Promise<FixedIncomeDto> {
  return apiEnviar<{ fixedIncome: FixedIncomeDto }>("/api/fixed-incomes", "POST", valores).then(
    (resposta) => resposta.fixedIncome,
  );
}

export function updateFixedIncome(id: string, valores: FixedIncomeValues): Promise<FixedIncomeDto> {
  return apiFetch<{ fixedIncome: FixedIncomeDto }>(`/api/fixed-incomes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(valores),
  }).then((resposta) => resposta.fixedIncome);
}

export function deleteFixedIncome(id: string): Promise<void> {
  return apiFetch<void>(`/api/fixed-incomes/${encodeURIComponent(id)}`, { method: "DELETE" });
}
