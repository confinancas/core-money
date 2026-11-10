import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { brand } from "../../../shared/brand";
import { memberEmailSchema, memberNameSchema } from "../../../shared/household";

const MENSAGEM_NOME = "Digite o nome (até 40 letras).";
const MENSAGEM_EMAIL = "Confira o e-mail.";

export type DadosDoConjuge = { name: string; email: string | null };

// Nome e e-mail do cônjuge (TASK-0105), conferidos com os mesmos schemas do servidor antes de enviar.
// Usado no passo 3 do cadastro e em Configurações › Casal (AdicionarConjuge).
export function SpouseForm({
  enviando,
  erroGeral,
  textoDoBotao = "Adicionar cônjuge",
  aoEnviar,
  formId,
  semBotao = false,
  aoMudarNome,
}: {
  enviando: boolean;
  erroGeral: string | null;
  textoDoBotao?: string;
  aoEnviar: (dados: DadosDoConjuge) => void;
  // Com semBotao, o botão de envio fica num rodapé fora do cartão (TASK-0107): ele aponta para este formId.
  formId?: string;
  semBotao?: boolean;
  aoMudarNome?: (nome: string) => void;
}) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const nomeLido = memberNameSchema.safeParse(nome);
    const emailLido = memberEmailSchema.safeParse(email);
    const novosErros: Record<string, string> = {};
    if (!nomeLido.success) novosErros.name = MENSAGEM_NOME;
    if (!emailLido.success) novosErros.email = MENSAGEM_EMAIL;
    setErros(novosErros);
    if (!nomeLido.success || !emailLido.success) return;
    aoEnviar({ name: nomeLido.data, email: emailLido.data });
  }

  return (
    <form id={formId} onSubmit={enviar} className="flex flex-col gap-5" noValidate>
      <TextField
        label="Nome do cônjuge"
        placeholder="Como vocês chamam"
        autoComplete="off"
        value={nome}
        onChange={(evento) => {
          setNome(evento.target.value);
          aoMudarNome?.(evento.target.value);
        }}
        error={erros.name}
      />
      <TextField
        label="E-mail do cônjuge (opcional)"
        placeholder="nome@email.com"
        type="email"
        autoComplete="off"
        inputMode="email"
        hint={`Só para identificar. O ${brand.name} não manda e-mails.`}
        value={email}
        onChange={(evento) => setEmail(evento.target.value)}
        error={erros.email}
      />
      {erroGeral && (
        <p role="alert" className="text-[13px] text-danger">
          {erroGeral}
        </p>
      )}
      {!semBotao && (
        <Button type="submit" full loading={enviando} disabled={enviando || nome.trim() === ""}>
          {textoDoBotao}
        </Button>
      )}
    </form>
  );
}
