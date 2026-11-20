import { Card } from "../../components/ui/card";
import { Switch } from "../../components/ui/switch";

// Lembrar para os próximos Pix (TASK-0404). Sem categoria, desligada e desabilitada. A regra só nasce pelo botão do
// rodapé (POST /api/rules, createdFrom "lembrar"); esta chave não grava sozinha.
export function RememberToggle({
  ligada,
  desabilitada,
  matchLabel,
  aviso,
  aoMudar,
}: {
  ligada: boolean;
  desabilitada: boolean;
  matchLabel: string;
  aviso: string;
  aoMudar: (ligada: boolean) => void;
}) {
  return (
    <Card className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-extrabold text-ink">
          Lembrar para os próximos Pix para {matchLabel}
        </h2>
        <p className="mt-1 text-[12px] leading-[1.5] text-ink-2">
          A categoria e o tipo escolhidos aqui viram regra para esse destinatário. Vocês podem desfazer em
          Configurações › Regras.
        </p>
        <p className="mt-1 text-[12px] leading-[1.5] text-ink-2">{aviso}</p>
      </div>
      <Switch
        checked={ligada}
        onCheckedChange={aoMudar}
        disabled={desabilitada}
        label={`Lembrar para os próximos Pix para ${matchLabel}`}
      />
    </Card>
  );
}
