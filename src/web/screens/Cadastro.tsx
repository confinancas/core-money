import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { TextField } from "@/components/ui/text-field";
import { brand } from "../../shared/brand";
import { memberEmailSchema, memberNameSchema } from "../../shared/household";
import type { SetupStatus } from "../../shared/setup";
import { AccessLayout } from "../access/AccessLayout";
import { type DadosDoCadastro, PasskeyStep } from "../access/PasskeyStep";
import { apiFetch } from "../lib/api";
import { SpouseStep } from "./cadastro/SpouseStep";

const MENSAGEM_NOME = "Digite seu nome (até 40 letras).";
const MENSAGEM_EMAIL = "Confira o e-mail.";

// Criar conta do casal (/criar-conta, TASK-0103): você (nome e e-mail), sua passkey e, depois, o cônjuge.
// Antes de tudo, consulta o status: só entra com o código de primeiro acesso já liberado e sem lar criado.
export function Cadastro() {
  const navegar = useNavigate();
  const [situacao, setSituacao] = useState<"carregando" | "liberado" | "falha">("carregando");
  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});
  const [dados, setDados] = useState<DadosDoCadastro | null>(null);

  const consultarStatus = useCallback(async () => {
    setSituacao("carregando");
    try {
      const estado = await apiFetch<SetupStatus>("/api/setup/status");
      if (estado.mode === "pronto") {
        navegar("/", { replace: true });
        return;
      }
      if (!estado.unlocked || estado.mode === "configuracao" || estado.hasMembers) {
        navegar("/configuracao-inicial", { replace: true });
        return;
      }
      setSituacao("liberado");
    } catch {
      setSituacao("falha");
    }
  }, [navegar]);

  useEffect(() => {
    void consultarStatus();
  }, [consultarStatus]);

  // Nome e e-mail conferidos aqui, com os mesmos schemas do servidor: um e-mail inválido não chega a ser enviado.
  function continuar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const nomeLido = memberNameSchema.safeParse(nome);
    const emailLido = memberEmailSchema.safeParse(email);
    const novosErros: Record<string, string> = {};
    if (!nomeLido.success) novosErros.name = MENSAGEM_NOME;
    if (!emailLido.success) novosErros.email = MENSAGEM_EMAIL;
    setErros(novosErros);
    if (!nomeLido.success || !emailLido.success) return;
    setDados({ name: nomeLido.data, email: emailLido.data });
    setPasso(2);
  }

  if (situacao === "carregando") {
    return (
      <AccessLayout>
        <div aria-hidden="true" className="mm-esqueleto h-40 rounded-card" />
      </AccessLayout>
    );
  }

  if (situacao === "falha") {
    return (
      <AccessLayout>
        <ErrorState onRetry={() => void consultarStatus()} />
      </AccessLayout>
    );
  }

  if (passo === 1) {
    return (
      <AccessLayout steps={{ current: 1, total: 3, label: "Você" }}>
        <Card className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[32px] font-extrabold tracking-[-0.5px]">Criar conta do casal</h1>
            <p className="text-[14px] leading-normal text-ink-2">
              Primeiro você. Depois, se quiser, você adiciona seu cônjuge.
            </p>
          </div>
          <form onSubmit={continuar} className="flex flex-col gap-5" noValidate>
            <TextField
              label="Seu nome"
              placeholder="Seu primeiro nome"
              autoComplete="given-name"
              value={nome}
              onChange={(evento) => setNome(evento.target.value)}
              error={erros.name}
            />
            <TextField
              label="Seu e-mail (opcional)"
              placeholder="nome@email.com"
              type="email"
              autoComplete="email"
              inputMode="email"
              hint={`Só para identificar você no app. O ${brand.name} não manda e-mails.`}
              value={email}
              onChange={(evento) => setEmail(evento.target.value)}
              error={erros.email}
            />
            <Button type="submit" full disabled={nome.trim() === ""}>
              Continuar
            </Button>
          </form>
        </Card>
      </AccessLayout>
    );
  }

  if (passo === 2 && dados) {
    return (
      <AccessLayout steps={{ current: 2, total: 3, label: "Sua passkey" }}>
        <PasskeyStep dados={dados} aoCriar={() => setPasso(3)} aoVoltar={() => setPasso(1)} />
      </AccessLayout>
    );
  }

  return (
    <AccessLayout steps={{ current: 3, total: 3, label: "Seu cônjuge" }}>
      <SpouseStep />
    </AccessLayout>
  );
}
