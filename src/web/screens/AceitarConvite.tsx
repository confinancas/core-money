import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextField } from "@/components/ui/text-field";
import { brand } from "../../shared/brand";
import { memberNameSchema } from "../../shared/household";
import type { ConviteParaAbrir } from "../../shared/invites";
import type { SessionResponse } from "../../shared/session";
import { AccessLayout } from "../access/AccessLayout";
import { diaEMes } from "../access/convite-textos";
import { PasskeyStep } from "../access/PasskeyStep";
import { useAtualizarFeatures } from "../app/features";
import { ApiError, apiEnviar, apiFetch } from "../lib/api";
import { useSessaoAposEntrar } from "../session/SessionProvider";

// Aceitar convite (/convite/:token, TASK-0105): quem recebeu o link cria o próprio acesso. Passo 1: o nome no app
// (e o e-mail do convite, travado). Passo 2: a passkey, e o início. Quem já tem sessão aqui é avisado, não entra de novo.
type Situacao =
  | { tipo: "carregando" }
  | { tipo: "com_sessao"; nome: string }
  | { tipo: "convite"; convite: ConviteParaAbrir }
  | { tipo: "indisponivel"; erro: ApiError | null };

const MENSAGEM_NOME = "Digite seu nome (até 40 letras).";

// Situações que não mudam com nova tentativa: o convite não vale mais, então a tela não oferece tentar de novo.
const CODIGOS_DEFINITIVOS = [
  "convite_vencido",
  "convite_usado",
  "convite_cancelado",
  "convite_invalido",
  "conjuge_ja_existe",
];

export function AceitarConvite() {
  const { token: tokenDaUrl = "" } = useParams();
  // O token fica só na memória da tela. A barra do navegador sai de /convite/:token (TASK-0106, avaliação da TASK-0105).
  const [token] = useState(tokenDaUrl);
  const navegar = useNavigate();
  useEffect(() => {
    window.history.replaceState(window.history.state, "", "/entrar");
  }, []);
  const aposEntrar = useSessaoAposEntrar();
  const atualizarFeatures = useAtualizarFeatures();
  const [situacao, setSituacao] = useState<Situacao>({ tipo: "carregando" });
  const [recarga, setRecarga] = useState(0);
  const [passo, setPasso] = useState<1 | 2>(1);
  const [nome, setNome] = useState("");
  const [erroDoNome, setErroDoNome] = useState<string | undefined>(undefined);

  // A recarga (botão Tentar de novo) refaz a consulta: a dependência existe só para isso.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a mudança de recarga refaz a consulta do convite
  useEffect(() => {
    let cancelado = false;
    async function abrir() {
      setSituacao({ tipo: "carregando" });
      try {
        const sessao = await apiFetch<SessionResponse>("/api/auth/session");
        if (cancelado) return;
        setSituacao({ tipo: "com_sessao", nome: sessao.member.name });
        return;
      } catch {
        // Sem sessão neste aparelho: segue para o convite.
      }
      try {
        const convite = await apiEnviar<ConviteParaAbrir>("/api/invites/inspect", "POST", { token });
        if (cancelado) return;
        setNome(convite.name ?? "");
        setSituacao({ tipo: "convite", convite });
      } catch (falha) {
        if (cancelado) return;
        setSituacao({ tipo: "indisponivel", erro: falha instanceof ApiError ? falha : null });
      }
    }
    void abrir();
    return () => {
      cancelado = true;
    };
  }, [token, recarga]);

  if (situacao.tipo === "carregando") {
    return (
      <AccessLayout>
        <div aria-hidden="true" className="mm-esqueleto h-40 rounded-card" />
      </AccessLayout>
    );
  }

  if (situacao.tipo === "com_sessao") {
    return (
      <AccessLayout>
        <Card className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[28px] font-extrabold tracking-[-0.5px]">Você já está no {brand.name}</h1>
            <p className="text-[14px] leading-normal text-ink-2">
              Você já está no {brand.name} como {situacao.nome}. Este convite é para o seu cônjuge: mande o
              link para a pessoa.
            </p>
          </div>
          <Button full onClick={() => navegar("/inicio", { replace: true })}>
            Ir para o início
          </Button>
        </Card>
      </AccessLayout>
    );
  }

  if (situacao.tipo === "indisponivel") {
    const erro = situacao.erro;
    const mensagem = erro ? mensagemDeConvite(erro) : null;
    return (
      <AccessLayout>
        <Card className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[28px] font-extrabold tracking-[-0.5px]">Convite indisponível</h1>
            <p role="alert" className="text-[14px] leading-normal text-ink-2">
              {mensagem ?? "Não deu para abrir o convite agora. Tente de novo."}
            </p>
          </div>
          {erro?.code === "convite_usado" && (
            <Button full onClick={() => navegar("/entrar")}>
              Entrar
            </Button>
          )}
          {!erro || !CODIGOS_DEFINITIVOS.includes(erro.code) ? (
            <Button full onClick={() => setRecarga((n) => n + 1)}>
              Tentar de novo
            </Button>
          ) : null}
        </Card>
      </AccessLayout>
    );
  }

  const { convite } = situacao;
  const quemConvidou = convite.invitedBy;
  const inicial = quemConvidou.trim().charAt(0).toUpperCase() || "?";

  if (passo === 1) {
    function continuar() {
      const lido = memberNameSchema.safeParse(nome);
      if (!lido.success) {
        setErroDoNome(MENSAGEM_NOME);
        return;
      }
      setErroDoNome(undefined);
      setNome(lido.data);
      setPasso(2);
    }

    return (
      <AccessLayout steps={{ current: 1, total: 2, label: "Seu nome" }}>
        <Card className="flex flex-col gap-5">
          <div className="flex items-start gap-3.5 rounded-card bg-field p-4">
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-[18px] font-extrabold text-white"
            >
              {inicial}
            </span>
            <div className="flex flex-col gap-1">
              <span className="text-[15px] font-extrabold">
                {quemConvidou} adicionou você como cônjuge no {brand.name}
              </span>
              <span className="text-[13px] text-ink-2">Link válido até {diaEMes(convite.expiresAt)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <h1 className="text-[32px] font-extrabold tracking-[-0.5px]">Crie seu acesso</h1>
          </div>

          <form
            className="flex flex-col gap-5"
            noValidate
            onSubmit={(evento) => {
              evento.preventDefault();
              continuar();
            }}
          >
            {convite.email && (
              <TextField
                label="E-mail"
                value={convite.email}
                readOnly
                hint={`Foi o e-mail que ${quemConvidou} informou. Serve só para identificar você.`}
              />
            )}
            <TextField
              label="Seu nome no app"
              placeholder="Como você quer aparecer"
              autoComplete="off"
              value={nome}
              onChange={(evento) => setNome(evento.target.value)}
              error={erroDoNome}
            />
            <Button type="submit" full disabled={nome.trim() === ""}>
              Continuar
            </Button>
          </form>
        </Card>
      </AccessLayout>
    );
  }

  return (
    <AccessLayout steps={{ current: 2, total: 2, label: "Sua passkey" }}>
      <PasskeyStep
        entrada={{
          optionsUrl: "/api/invites/accept/options",
          verifyUrl: "/api/invites/accept/verify",
          body: { token, name: nome },
        }}
        titulo="Crie sua passkey"
        aoCriar={() => {
          atualizarFeatures();
          aposEntrar();
        }}
        aoVoltar={() => setPasso(1)}
      />
    </AccessLayout>
  );
}

// Mensagens da tela para cada situação do convite (a API já diz o código e, no vencido, quem convidou e o vencimento).
function mensagemDeConvite(erro: ApiError): string {
  switch (erro.code) {
    case "convite_vencido": {
      const quem = typeof erro.corpo?.invitedBy === "string" ? erro.corpo.invitedBy : "quem convidou";
      const vencimento = typeof erro.corpo?.expiresAt === "string" ? erro.corpo.expiresAt : null;
      return vencimento
        ? `Este convite venceu em ${diaEMes(vencimento)}. Peça a ${quem} um link novo.`
        : `Este convite venceu. Peça a ${quem} um link novo.`;
    }
    case "convite_usado":
      return "Este convite já foi usado. Se foi você, entre com sua passkey.";
    case "convite_cancelado":
      return "Este convite foi cancelado.";
    case "convite_invalido":
      return "Link de convite inválido. Confira se copiou o link inteiro.";
    case "conjuge_ja_existe":
      return "Este lar já tem um cônjuge.";
    default:
      return "Não deu para abrir o convite agora. Tente de novo.";
  }
}
