import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PasskeyStep } from "./PasskeyStep";

// Sugestão depois de entrar pelo QR code (TASK-0106): o celular confirmou a entrada no computador, e o computador
// pode ganhar a própria passkey. "Criar passkey aqui" usa as rotas de aparelho; "Agora não" segue para o início.
export function AddThisDevicePrompt({ aoConcluir }: { aoConcluir: () => void }) {
  const [etapa, setEtapa] = useState<"pergunta" | "criar">("pergunta");

  if (etapa === "criar") {
    return (
      <PasskeyStep
        entrada={{ optionsUrl: "/api/devices/options", verifyUrl: "/api/devices/verify", body: {} }}
        titulo="Crie sua passkey"
        aoCriar={aoConcluir}
        aoVoltar={() => setEtapa("pergunta")}
      />
    );
  }

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-extrabold tracking-[-0.5px]">Quer deixar este computador pronto?</h1>
        <p className="text-[14px] leading-normal text-ink-2">
          Você entrou com o celular. Quer criar uma passkey neste computador para entrar direto da próxima
          vez?
        </p>
      </div>
      <Button full onClick={() => setEtapa("criar")}>
        Criar passkey aqui
      </Button>
      <Button variant="secondary" full onClick={aoConcluir}>
        Agora não
      </Button>
    </Card>
  );
}
