import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  createPasskey,
  type EntradaDaPasskey,
  type MensagemDaPasskey,
  mensagemDaPasskey,
  navegadorTemPasskey,
  PasskeyIndisponivelError,
} from "./passkey-client";

const MENSAGEM_SEM_PASSKEY = mensagemDaPasskey(new PasskeyIndisponivelError()).mensagem;

// Passo "Crie sua passkey" (TASK-0103 no cadastro; TASK-0105 no aceite do convite; TASK-0106 na recuperação e no
// "adicionar este aparelho"). A entrada (as duas rotas e o corpo) é de quem usa a tela. Cada toque é uma cerimônia só
// (trava); o erro vira a mensagem da tabela. traduzErro, quando a tela tem mensagens próprias, vem antes da tabela.
export function PasskeyStep({
  entrada,
  titulo = "Crie sua passkey",
  aoCriar,
  aoVoltar,
  traduzErro,
}: {
  entrada: EntradaDaPasskey;
  titulo?: string;
  aoCriar: () => void;
  aoVoltar: () => void;
  traduzErro?: (erro: unknown) => MensagemDaPasskey | null;
}) {
  const navegar = useNavigate();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<{ mensagem: string; entrar: boolean } | null>(null);
  const travado = useRef(false);
  const semPasskey = !navegadorTemPasskey();

  async function criar() {
    if (travado.current) return;
    travado.current = true;
    setEnviando(true);
    setErro(null);
    try {
      await createPasskey(entrada);
      aoCriar();
    } catch (falha) {
      const tratado = traduzErro?.(falha) ?? mensagemDaPasskey(falha);
      if (tratado.acao === "configuracao") {
        navegar("/configuracao-inicial", { replace: true });
        return;
      }
      setErro({ mensagem: tratado.mensagem, entrar: tratado.acao === "entrar" });
    } finally {
      travado.current = false;
      setEnviando(false);
    }
  }

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[32px] font-extrabold tracking-[-0.5px]">{titulo}</h1>
        <p className="text-[14px] leading-normal text-ink-2">
          Em vez de senha, você entra com a digital, o rosto ou o PIN deste aparelho. Nada para decorar, nada
          para vazar.
        </p>
      </div>

      <section className="rounded-card border border-primary/20 bg-primary-soft p-4 text-[13px] leading-normal text-ink-2">
        A passkey fica guardada no aparelho (ou no iCloud, na conta Google ou no seu gerenciador de senhas) e
        só vale neste endereço: {window.location.hostname}.
      </section>

      {semPasskey && (
        <p role="alert" className="text-[13px] text-danger">
          {MENSAGEM_SEM_PASSKEY}
        </p>
      )}

      {erro && (
        <p role="alert" className="text-[13px] text-danger">
          {erro.mensagem}
        </p>
      )}

      {erro?.entrar ? (
        <Button full onClick={() => navegar("/entrar")}>
          Ir para entrar
        </Button>
      ) : (
        <Button full loading={enviando} disabled={semPasskey} onClick={criar}>
          Criar passkey
        </Button>
      )}
      <Button variant="secondary" full onClick={aoVoltar} disabled={enviando}>
        Voltar
      </Button>
    </Card>
  );
}
