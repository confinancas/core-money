import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { IconeCheck } from "../../../components/icons";

type Props = {
  nome: string;
  aoMudar: (nome: string) => void;
  erro: string | null;
  aoContinuar: () => void;
};

const VANTAGENS = [
  "Só leitura: o app vê saldos, extratos e faturas, mas não move dinheiro",
  "Cada banco é autorizado no Meu Pluggy e vale por 12 meses",
  "Atualiza sozinho uma vez por dia",
];

// Passo 1 (TASK-0203): o nome da conexão, que é o mesmo para os dois.
export function StepNome({ nome, aoMudar, erro, aoContinuar }: Props) {
  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    aoContinuar();
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-[24px] font-extrabold tracking-[-0.3px]">De quem é esta conta?</h2>
        <p className="text-[14px] leading-normal text-ink-2">
          O Meu Pluggy é gratuito e junta os bancos de um CPF pelo Open Finance. Cada um de vocês pode ter o
          seu.
        </p>
      </div>

      <TextField
        label="Nome desta conexão"
        name="nome-da-conexao"
        autoComplete="off"
        maxLength={80}
        value={nome}
        onChange={(evento) => aoMudar(evento.target.value)}
        error={erro ?? undefined}
        hint="Aparece assim para os dois, não importa quem estiver usando o app."
      />

      <ul className="flex flex-col gap-2.5">
        {VANTAGENS.map((texto) => (
          <li key={texto} className="flex items-start gap-2.5 text-[13px] leading-normal text-ink-2">
            <IconeCheck size={16} className="mt-0.5 shrink-0 text-primary" />
            <span>{texto}</span>
          </li>
        ))}
      </ul>

      <Button type="submit" full>
        Continuar
      </Button>
    </form>
  );
}
