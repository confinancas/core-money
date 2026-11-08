import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SkeletonCard } from "@/components/ui/skeleton";
import { brand } from "../../shared/brand";
import type { RecuperacaoParaAbrir } from "../../shared/recovery";
import { AccessLayout } from "../access/AccessLayout";
import { PasskeyStep } from "../access/PasskeyStep";
import type { MensagemDaPasskey } from "../access/passkey-client";
import { useAtualizarFeatures } from "../app/features";
import { horaDoLink } from "../devices/datas";
import { ApiError, apiEnviar } from "../lib/api";
import { useSessaoAposEntrar } from "../session/SessionProvider";

// Recuperar o acesso (/recuperar/:token, TASK-0106): o link de uso único (15 min pelo parceiro, 60 min pelo comando).
// A pessoa cadastra uma passkey neste aparelho e entra. O token fica só na memória da tela: a barra do navegador
// sai de /recuperar/:token antes de qualquer resposta (a avaliação da TASK-0105 pediu isso).
type Situacao =
  | { tipo: "carregando" }
  | { tipo: "pronto"; link: RecuperacaoParaAbrir }
  | { tipo: "indisponivel"; mensagem: string; definitivo: boolean };

// Códigos de link que não mudam com nova tentativa: a tela oferece voltar para entrar, não tentar de novo.
const CODIGOS_DO_LINK = ["link_vencido", "link_usado", "link_cancelado", "link_invalido", "ja_conectado"];

// Mensagens da tela para cada situação do link (a API diz o código; o vencimento vem no corpo).
export function mensagemDoLink(falha: unknown, quem: string | null): string {
  if (falha instanceof ApiError) {
    switch (falha.code) {
      case "link_vencido": {
        const quando = typeof falha.corpo?.expiresAt === "string" ? falha.corpo.expiresAt : null;
        return quando
          ? `Este link venceu às ${horaDoLink(quando)}. Peça um novo.`
          : "Este link venceu. Peça um novo.";
      }
      case "link_usado":
        return "Este link já foi usado.";
      case "link_cancelado":
        return "Este link foi trocado por um mais novo.";
      case "link_invalido":
        return "Link de recuperação inválido. Confira se copiou o link inteiro.";
      case "ja_conectado":
        return `Você já está no ${brand.name} neste navegador. Este link é para ${quem ?? "a pessoa"}: mande para a pessoa.`;
    }
  }
  return "Não deu para abrir o link agora. Tente de novo.";
}

export function Recuperar() {
  const { token: tokenDaUrl = "" } = useParams();
  const [token] = useState(tokenDaUrl);
  const navegar = useNavigate();
  const aposEntrar = useSessaoAposEntrar();
  const atualizarFeatures = useAtualizarFeatures();
  const [situacao, setSituacao] = useState<Situacao>({ tipo: "carregando" });
  const [recarga, setRecarga] = useState(0);

  // Tira o token da barra: a URL passa a ser /entrar, sem o token (o histórico também não o guarda mais).
  useEffect(() => {
    window.history.replaceState(window.history.state, "", "/entrar");
  }, []);

  // A recarga (Tentar de novo) refaz a consulta do link: a dependência existe só para isso.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a mudança de recarga refaz a consulta do link
  useEffect(() => {
    let cancelado = false;
    setSituacao({ tipo: "carregando" });
    apiEnviar<RecuperacaoParaAbrir>("/api/recovery/inspect", "POST", { token }).then(
      (link) => {
        if (!cancelado) setSituacao({ tipo: "pronto", link });
      },
      (falha: unknown) => {
        if (cancelado) return;
        const definitivo = falha instanceof ApiError && CODIGOS_DO_LINK.includes(falha.code);
        setSituacao({ tipo: "indisponivel", mensagem: mensagemDoLink(falha, null), definitivo });
      },
    );
    return () => {
      cancelado = true;
    };
  }, [token, recarga]);

  if (situacao.tipo === "carregando") {
    return (
      <AccessLayout>
        <SkeletonCard />
      </AccessLayout>
    );
  }

  if (situacao.tipo === "indisponivel") {
    return (
      <AccessLayout>
        <Card className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[28px] font-extrabold tracking-[-0.5px]">Link indisponível</h1>
            <p role="alert" className="text-[14px] leading-normal text-ink-2">
              {situacao.mensagem}
            </p>
          </div>
          {situacao.definitivo ? (
            <Button full onClick={() => navegar("/entrar", { replace: true })}>
              Ir para entrar
            </Button>
          ) : (
            <Button full onClick={() => setRecarga((n) => n + 1)}>
              Tentar de novo
            </Button>
          )}
        </Card>
      </AccessLayout>
    );
  }

  const { link } = situacao;
  const origem =
    link.source === "parceiro"
      ? `${link.createdByName ?? "Quem está no lar"} liberou um aparelho novo para você`
      : "Link gerado pelo comando de recuperação da instalação";

  return (
    <AccessLayout>
      <Card className="flex flex-col gap-4">
        <div className="flex items-start gap-3.5 rounded-card bg-field p-4">
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-[18px] font-extrabold text-white"
          >
            {(link.createdByName ?? "C").trim().charAt(0).toUpperCase() || "?"}
          </span>
          <span className="text-[15px] font-extrabold">{origem}</span>
        </div>
        <p className="text-[14px] leading-normal text-ink-2">
          Olá, {link.memberName}. Este link vale até {horaDoLink(link.expiresAt)} e serve uma vez só.
        </p>
      </Card>
      <PasskeyStep
        entrada={{ optionsUrl: "/api/recovery/options", verifyUrl: "/api/recovery/verify", body: { token } }}
        titulo="Cadastre uma passkey neste aparelho"
        aoCriar={() => {
          atualizarFeatures();
          aposEntrar();
        }}
        aoVoltar={() => navegar("/entrar", { replace: true })}
        traduzErro={traduzErroDoLink(link.memberName)}
      />
    </AccessLayout>
  );
}

// As mensagens do link vêm antes da tabela da passkey; os outros erros (a cerimônia) seguem a tabela.
function traduzErroDoLink(quem: string) {
  return (erro: unknown): MensagemDaPasskey | null => {
    if (!(erro instanceof ApiError) || !CODIGOS_DO_LINK.includes(erro.code)) return null;
    return { mensagem: mensagemDoLink(erro, quem), acao: null };
  };
}
