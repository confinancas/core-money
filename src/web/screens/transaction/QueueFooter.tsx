import { Button } from "../../components/ui/button";

// Rodapé do modo fila (TASK-0404): "Salvar" fora da fila; "Salvar e ir para o próximo · faltam N" no meio; no último,
// "Salvar e voltar para a fila". Na compra, só navega (a compra já grava na hora).
export function QueueFooter({
  fila,
  salvando,
  aoClicar,
}: {
  fila: { faltam: number; ultimo: boolean } | null;
  salvando: boolean;
  aoClicar: () => void;
}) {
  if (fila === null) {
    return (
      <Button full loading={salvando} onClick={aoClicar}>
        Salvar
      </Button>
    );
  }
  if (fila.ultimo) {
    return (
      <Button full loading={salvando} onClick={aoClicar}>
        Salvar e voltar para a fila
      </Button>
    );
  }
  return (
    <Button full loading={salvando} onClick={aoClicar} className="whitespace-nowrap px-4">
      Salvar e ir para o próximo
      <span className="text-[12px] font-bold normal-case tracking-normal opacity-85">
        · faltam {fila.faltam}
      </span>
    </Button>
  );
}
