import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

// Confirmação dentro do app. Substitui window.confirm, que o PWA instalado bloqueia.
export type OpcoesDeConfirmacao = {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

type Pendente = OpcoesDeConfirmacao & { resolver: (confirmado: boolean) => void };
type Confirmar = (opcoes: OpcoesDeConfirmacao) => Promise<boolean>;

const Contexto = createContext<Confirmar | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pendente, setPendente] = useState<Pendente | null>(null);
  // O foco volta a quem abriu a confirmação (o Radix só sabe voltar ao DialogTrigger, que não usamos).
  const gatilho = useRef<HTMLElement | null>(null);

  const confirmar = useCallback<Confirmar>(
    (opcoes) =>
      new Promise<boolean>((resolver) => {
        gatilho.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setPendente({ ...opcoes, resolver });
      }),
    [],
  );

  const valor = useMemo(() => confirmar, [confirmar]);

  function responder(confirmado: boolean) {
    pendente?.resolver(confirmado);
    setPendente(null);
  }

  return (
    <Contexto.Provider value={valor}>
      {children}
      <ConfirmDialog pendente={pendente} onResponder={responder} gatilho={gatilho} />
    </Contexto.Provider>
  );
}

// Resolve true se confirmar; false se cancelar, apertar Esc ou tocar fora.
export function useConfirm(): Confirmar {
  const confirmar = useContext(Contexto);
  if (!confirmar) throw new Error("useConfirm precisa de ConfirmProvider.");
  return confirmar;
}

function ConfirmDialog({
  pendente,
  onResponder,
  gatilho,
}: {
  pendente: Pendente | null;
  onResponder: (confirmado: boolean) => void;
  gatilho: { current: HTMLElement | null };
}) {
  const perigo = pendente?.tone === "danger";

  return (
    <Dialog open={pendente !== null} onOpenChange={(aberto) => !aberto && onResponder(false)}>
      <DialogContent
        onCloseAutoFocus={(evento) => {
          const alvo = gatilho.current;
          if (alvo) {
            evento.preventDefault();
            alvo.focus();
          }
        }}
        className={cn(
          "inset-x-0 bottom-0 rounded-t-card",
          "tablet:inset-x-auto tablet:bottom-auto tablet:left-1/2 tablet:top-1/2 tablet:w-[440px] tablet:-translate-x-1/2 tablet:-translate-y-1/2 tablet:rounded-card",
        )}
      >
        {pendente && (
          <>
            <DialogTitle>{pendente.title}</DialogTitle>
            <DialogDescription className="mt-2">{pendente.description}</DialogDescription>
            <div className="mt-6 flex flex-col gap-3 tablet:flex-row tablet:justify-end">
              <Button variant="secondary" onClick={() => onResponder(false)}>
                {pendente.cancelLabel ?? "Cancelar"}
              </Button>
              <Button className={cn(perigo && "bg-danger shadow-none")} onClick={() => onResponder(true)}>
                {pendente.confirmLabel}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
