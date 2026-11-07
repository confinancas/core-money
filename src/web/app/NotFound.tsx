import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GreenTop } from "@/components/ui/green-top";

// Rota que não existe: mostra dentro da moldura e leva ao início.
export function NotFound() {
  const navegar = useNavigate();

  return (
    <>
      <GreenTop
        variant="detail"
        title="Página não encontrada"
        back={{ to: "/inicio", label: "Voltar" }}
        overlap
      />
      <div className="px-4 tablet:px-6">
        <Card overlap className="flex flex-col items-center gap-4 text-center">
          <p className="text-[15px] text-ink-2">O endereço não existe ou mudou de lugar.</p>
          <Button onClick={() => navegar("/inicio")}>Ir para o início</Button>
        </Card>
      </div>
    </>
  );
}
