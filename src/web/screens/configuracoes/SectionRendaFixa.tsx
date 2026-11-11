import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Money } from "@/components/ui/money";
import { SkeletonCard } from "@/components/ui/skeleton";
import { ARRIVAL_SETTINGS_LABELS, type FixedIncomesResponse } from "../../../shared/fixed-incomes";
import { fetchFixedIncomes } from "../../api/fixed-incomes";
import { SettingsRow } from "../../components/settings/SettingsRow";

// Seção Renda fixa (TASK-0901): uma linha por renda ativa, que abre o editor dela na tela de Renda fixa, e a linha
// "Adicionar renda fixa" (verde, com +, como no protótipo), que abre o editor vazio. As linhas têm divisória (TASK-0902).
export function SectionRendaFixa() {
  const [dados, setDados] = useState<FixedIncomesResponse | null>(null);
  const [falhou, setFalhou] = useState(false);

  const carregar = useCallback(() => {
    setFalhou(false);
    void fetchFixedIncomes().then(setDados, () => setFalhou(true));
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (dados === null) {
    return falhou ? (
      <ErrorState title="Não deu para carregar a renda fixa." onRetry={carregar} />
    ) : (
      <SkeletonCard />
    );
  }

  return (
    <Card className="flex flex-col overflow-hidden p-0 [&>*+*]:border-t [&>*+*]:border-field-border">
      {dados.fixedIncomes.map((renda) => {
        const dolar = renda.currency === "USD";
        return (
          <SettingsRow
            key={renda.id}
            titulo={renda.name}
            subtitulo={`${ARRIVAL_SETTINGS_LABELS[renda.arrival]}${dolar ? " · cotação do dia em que cair" : ""}`}
            valor={
              dolar ? (
                <>
                  US$ <Money cents={renda.amountCents} />
                </>
              ) : (
                <Money cents={renda.amountCents} />
              )
            }
            para={`/renda/fixa?id=${encodeURIComponent(renda.id)}`}
          />
        );
      })}
      <Link
        to="/renda/fixa?nova=1"
        className="flex min-h-14 items-center gap-2.5 px-4 py-3 text-[15px] font-semibold text-primary-ink transition-colors hover:bg-field"
      >
        <span aria-hidden="true" className="text-[18px] leading-none">
          +
        </span>
        Adicionar renda fixa
      </Link>
    </Card>
  );
}
