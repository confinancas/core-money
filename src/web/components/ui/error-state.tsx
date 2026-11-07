import { IconeAlerta, IconeSemConexao } from "@/components/icons";
import { Button } from "./button";
import { Card } from "./card";

type Props = {
  title?: string;
  description?: string;
  onRetry: () => void;
  // Sem conexão: outro texto e outro ícone. Nunca mostra detalhe técnico nem código de erro.
  offline?: boolean;
};

export function ErrorState({ title, description, onRetry, offline = false }: Props) {
  const titulo = title ?? (offline ? "Sem conexão" : "Não foi possível carregar");
  const texto =
    description ??
    (offline ? "Os dados aparecem quando a internet voltar." : "Confira a internet e tente de novo.");
  const Icone = offline ? IconeSemConexao : IconeAlerta;

  return (
    <Card role="alert" className="flex flex-col items-center gap-3 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-danger-bg text-danger">
        <Icone size={26} />
      </div>
      <h2 className="text-[16px] font-extrabold text-ink">{titulo}</h2>
      <p className="text-[14px] text-ink-2">{texto}</p>
      <Button variant="secondary" onClick={onRetry}>
        Tentar de novo
      </Button>
    </Card>
  );
}
