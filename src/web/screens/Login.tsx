import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { brand } from "../../shared/brand";
import type { SessionResponse } from "../../shared/session";
import type { SetupStatus } from "../../shared/setup";
import { AccessLayout } from "../access/AccessLayout";
import { AddThisDevicePrompt } from "../access/AddThisDevicePrompt";
import {
  mensagemDoLogin,
  navegadorTemPasskey,
  PasskeyIndisponivelError,
  signInWithPasskey,
} from "../access/passkey-client";
import { useAtualizarFeatures } from "../app/features";
import { apiFetch } from "../lib/api";
import { useSessaoAposEntrar } from "../session/SessionProvider";

// Entrar (/entrar, TASK-0104): a passkey do aparelho ou o QR code do celular. Ao abrir, com a configuração pendente
// vai para a configuração inicial, e com sessão já aberta vai para o início.
export function Login() {
  const navegar = useNavigate();
  const aposEntrar = useSessaoAposEntrar();
  const atualizarFeatures = useAtualizarFeatures();
  const [verificando, setVerificando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [perdeuAcesso, setPerdeuAcesso] = useState(false);
  // Entrou pelo QR code (o celular confirmou): antes de ir ao início, sugere a passkey deste computador (TASK-0106).
  const [sugereAparelho, setSugereAparelho] = useState(false);
  const travado = useRef(false);
  const semPasskey = !navegadorTemPasskey();

  useEffect(() => {
    let cancelado = false;
    async function verificar() {
      try {
        const estado = await apiFetch<SetupStatus>("/api/setup/status");
        if (cancelado) return;
        if (estado.mode !== "pronto") {
          navegar("/configuracao-inicial", { replace: true });
          return;
        }
        await apiFetch<SessionResponse>("/api/auth/session");
        if (cancelado) return;
        navegar("/inicio", { replace: true });
      } catch {
        // Sem sessão (401) ou sem resposta: a tela de entrar fica aberta.
        if (!cancelado) setVerificando(false);
      }
    }
    void verificar();
    return () => {
      cancelado = true;
    };
  }, [navegar]);

  async function entrar() {
    if (travado.current) return;
    travado.current = true;
    setEnviando(true);
    setMensagem(null);
    try {
      const entrada = await signInWithPasskey();
      if (entrada.crossDevice) {
        setSugereAparelho(true);
        return;
      }
      atualizarFeatures();
      aposEntrar();
    } catch (falha) {
      setMensagem(mensagemDoLogin(falha));
    } finally {
      travado.current = false;
      setEnviando(false);
    }
  }

  if (verificando) {
    return (
      <AccessLayout>
        <div aria-hidden="true" className="mm-esqueleto h-40 rounded-card" />
      </AccessLayout>
    );
  }

  if (sugereAparelho) {
    return (
      <AccessLayout>
        <AddThisDevicePrompt
          aoConcluir={() => {
            atualizarFeatures();
            aposEntrar();
          }}
        />
      </AccessLayout>
    );
  }

  return (
    <AccessLayout>
      <Card className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[32px] font-extrabold tracking-[-0.5px]">Entrar</h1>
          <p className="text-[14px] leading-normal text-ink-2">
            Cada um de vocês entra com a própria passkey: a digital, o rosto ou o PIN do aparelho.
          </p>
        </div>

        {(semPasskey || mensagem) && (
          <p role="alert" className="text-[13px] text-danger">
            {semPasskey ? mensagemDoLogin(new PasskeyIndisponivelError()) : mensagem}
          </p>
        )}

        <Button full loading={enviando} disabled={semPasskey || enviando} onClick={entrar}>
          <IconeDeDigital />
          {enviando ? "Aguardando a passkey…" : "Entrar com passkey"}
        </Button>

        <p className="text-[13px] leading-normal text-ink-2">
          No computador sem passkey, o navegador mostra um QR code: aponte a câmera do celular e confirme
          nele. O Bluetooth do computador precisa estar ligado.
        </p>
      </Card>

      <div className="mt-5 flex flex-col items-center gap-3">
        <button
          type="button"
          aria-expanded={perdeuAcesso}
          onClick={() => setPerdeuAcesso((aberto) => !aberto)}
          className="inline-flex min-h-11 items-center px-3 text-[14px] font-semibold text-primary underline-offset-4 hover:underline"
        >
          Perdeu o acesso ao aparelho?
        </button>
        {perdeuAcesso && (
          <p className="max-w-[460px] text-center text-[13px] leading-normal text-ink-2">
            Peça a quem divide o {brand.name} com você um link de recuperação, em Configurações › Casal e
            aparelhos. Se ninguém consegue entrar, quem instalou roda npm run recuperar-acesso no computador.
          </p>
        )}
      </div>
    </AccessLayout>
  );
}

// Ícone de digital do protótipo (Login.dc.html), em traço.
function IconeDeDigital() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M6.5 11.5a5.5 5.5 0 0 1 11 0v1.2" />
      <path d="M9 12.5v-1a3 3 0 0 1 6 0v3.5" />
      <path d="M12 12v4.5a2.5 2.5 0 0 1-2.5 2.5" />
      <path d="M4.5 9.5a7.5 7.5 0 0 1 15 0" />
      <path d="M15 18.5c-.8.8-1.7 1.3-3 1.5" />
    </svg>
  );
}
