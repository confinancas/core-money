import { Button } from "@/components/ui/button";
import { ChoiceTile } from "@/components/ui/choice-tile";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type OpcaoDeEscolha<T extends string | number = number> = { valor: T; rotulo: string };

type Props<T extends string | number> = {
  aberto: boolean;
  titulo: string;
  descricao: string;
  // Nome do grupo de opções, para a leitura de tela.
  nomeDoGrupo: string;
  opcoes: OpcaoDeEscolha<T>[];
  escolhido: T;
  onEscolher: (valor: T) => void;
  onSalvar: () => void;
  onCancelar: () => void;
  salvando: boolean;
  erro: string | null;
};

// Painel de escolha dentro da tela (nunca confirm() nem prompt()): folha de baixo no celular, cartão no centro a
// partir do tablet. Radix Dialog, como o ConfirmDialog. O botão principal fica no rodapé (à direita no tablet).
export function ChoiceSheet<T extends string | number>({
  aberto,
  titulo,
  descricao,
  nomeDoGrupo,
  opcoes,
  escolhido,
  onEscolher,
  onSalvar,
  onCancelar,
  salvando,
  erro,
}: Props<T>) {
  return (
    <Dialog open={aberto} onOpenChange={(proximo) => !proximo && onCancelar()}>
      <DialogContent
        className={cn(
          "inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-card",
          "tablet:inset-x-auto tablet:bottom-auto tablet:left-1/2 tablet:top-1/2 tablet:w-[520px] tablet:-translate-x-1/2 tablet:-translate-y-1/2 tablet:rounded-card",
        )}
      >
        <DialogTitle>{titulo}</DialogTitle>
        <DialogDescription className="mt-2">{descricao}</DialogDescription>

        <div
          role="radiogroup"
          aria-label={nomeDoGrupo}
          className="mt-5 grid grid-cols-4 gap-2.5 tablet:grid-cols-7"
        >
          {opcoes.map((opcao) => (
            <ChoiceTile
              key={opcao.valor}
              label={opcao.rotulo}
              selected={opcao.valor === escolhido}
              onSelect={() => onEscolher(opcao.valor)}
              className="justify-center px-1 text-center"
            />
          ))}
        </div>

        {erro && (
          <p role="alert" className="mt-4 text-[13px] text-danger">
            {erro}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3 tablet:flex-row tablet:justify-end">
          <Button variant="secondary" onClick={onCancelar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={onSalvar} loading={salvando}>
            Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
