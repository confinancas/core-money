import { Card } from "@/components/ui/card";
import { GreenTop } from "@/components/ui/green-top";
import { destinoDeVoltar } from "./frame/aba";
import { useRotaAtual } from "./rota-atual";

// Tela provisória: cada épico troca pelo conteúdo de verdade. Mantém a moldura e a aba marcada da rota.
// overlap reserva a faixa de baixo do topo: o cartão sobe nela, e não sobre o título.
export function PlaceholderScreen() {
  const { meta, aba } = useRotaAtual();
  const titulo = meta?.title ?? "";
  const destino = destinoDeVoltar(aba);

  return (
    <>
      {meta?.frame === "detail" ? (
        <GreenTop variant="detail" title={titulo} back={{ to: destino, label: "Voltar" }} overlap />
      ) : meta?.frame === "full" ? (
        <GreenTop variant="form" title={titulo} close={{ to: destino, label: "Fechar" }} overlap />
      ) : meta?.frame === "bare" ? (
        <GreenTop variant="form" title={titulo} overlap />
      ) : (
        <GreenTop variant="tab" title={titulo} overlap />
      )}
      <div className="px-4 tablet:px-6">
        <Card overlap>Esta tela chega numa próxima versão.</Card>
      </div>
    </>
  );
}
