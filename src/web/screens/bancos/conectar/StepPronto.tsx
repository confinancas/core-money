import { Button } from "@/components/ui/button";
import { IconeCheck } from "../../../components/icons";
import { textoDoPassoPronto } from "./view-model";

type Props = {
  rotulo: string;
  quantidade: number;
  aoIrParaInicio: () => void;
  aoVerEmConfiguracoes: () => void;
};

// Passo 4 (TASK-0203): a conta está conectada; os dois botões levam para o início ou para Configurações.
export function StepPronto({ rotulo, quantidade, aoIrParaInicio, aoVerEmConfiguracoes }: Props) {
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <span
        aria-hidden="true"
        className="flex size-16 items-center justify-center rounded-full bg-success-bg text-success ring-[9px] ring-success-bg/60"
      >
        <IconeCheck size={30} strokeWidth={2.5} />
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="text-[24px] font-extrabold tracking-[-0.3px]">{rotulo} conectada</h2>
        <p className="text-[14px] leading-normal text-ink-2">{textoDoPassoPronto(quantidade)}</p>
      </div>
      <div className="flex w-full flex-col gap-3">
        <Button full onClick={aoIrParaInicio}>
          Ir para o início
        </Button>
        <Button variant="secondary" full onClick={aoVerEmConfiguracoes}>
          Ver em Configurações
        </Button>
      </div>
    </div>
  );
}
