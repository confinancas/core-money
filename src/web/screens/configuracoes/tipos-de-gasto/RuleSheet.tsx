import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/text-field";
import type { RegraAutomatica } from "../../../api/spend-types";
import { TEXTO_DA_FOLHA_DA_REGRA, textoDaRegra } from "./view-model";

// Folha da regra automática (corretora ou caixinha): o texto que o app procura, os destinos recentes (toque preenche),
// salvar, e remover quando já existe. Sem confirm(): a remoção é reversível pela própria regra (ver a lista).
export function RuleSheet({
  kind,
  regra,
  texto,
  destinos,
  salvando,
  erro,
  onTexto,
  onSalvar,
  onRemover,
  onFechar,
}: {
  kind: RegraAutomatica["kind"] | null;
  regra: RegraAutomatica | undefined;
  texto: string;
  destinos: { name: string; bank: string | null }[];
  salvando: boolean;
  erro: string | null;
  onTexto: (valor: string) => void;
  onSalvar: () => void;
  onRemover: () => void;
  onFechar: () => void;
}) {
  const titulo = kind === null ? "" : textoDaRegra(regra, kind).titulo;
  return (
    <Dialog open={kind !== null} onOpenChange={(proximo) => !proximo && onFechar()}>
      <DialogContent className="inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-card tablet:inset-x-auto tablet:bottom-auto tablet:left-1/2 tablet:top-1/2 tablet:w-[520px] tablet:-translate-x-1/2 tablet:-translate-y-1/2 tablet:rounded-card">
        <DialogTitle>{titulo}</DialogTitle>
        <DialogDescription className="mt-2">{TEXTO_DA_FOLHA_DA_REGRA}</DialogDescription>

        <div className="mt-5">
          <TextField
            label="Texto do extrato ou nome de quem recebe"
            value={texto}
            onChange={(evento) => onTexto(evento.target.value)}
            maxLength={60}
            autoComplete="off"
          />
        </div>

        {destinos.length > 0 && (
          <div className="mt-5 flex flex-col gap-2">
            <span className="text-[13px] font-bold text-ink-2">Destinos recentes</span>
            <div className="flex flex-wrap gap-2">
              {destinos.map((destino) => (
                <Chip key={destino.name} onClick={() => onTexto(destino.name)}>
                  {destino.name}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {erro && (
          <p role="alert" className="mt-4 text-[13px] text-danger">
            {erro}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3 tablet:flex-row tablet:justify-end">
          {regra !== undefined && (
            <Button variant="secondary" onClick={onRemover} disabled={salvando}>
              Remover regra
            </Button>
          )}
          <Button onClick={onSalvar} loading={salvando}>
            Salvar regra
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
