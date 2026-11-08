import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ErrorState } from "@/components/ui/error-state";
import { GreenTop } from "@/components/ui/green-top";
import { SkeletonCard } from "@/components/ui/skeleton";
import { brand } from "../../shared/brand";
import type { ConviteCriado, ConviteDoLar } from "../../shared/invites";
import {
  DICA_DO_CONVITE,
  diaEMes,
  TITULO_DO_COMPARTILHAMENTO,
  textoDoCompartilhamento,
  VOCES_DOIS_VAO_PODER,
} from "../access/convite-textos";
import { ShareLink } from "../access/ShareLink";
import { ApiError, apiEnviar, apiFetch, mensagemDoErro } from "../lib/api";
import { useSession } from "../session/SessionProvider";
import { type DadosDoConjuge, SpouseForm } from "./cadastro/SpouseForm";

// Adicionar cônjuge (/configuracoes/casal/adicionar-conjuge, TASK-0105): o formulário, o link uma vez, o convite
// aguardando (com novo link e cancelar). Um cônjuge por lar: com ele, a tela só confirma que vocês já são dois.
export function AdicionarConjuge() {
  const navegar = useNavigate();
  const { member, members } = useSession();
  const confirmar = useConfirm();
  const [convites, setConvites] = useState<ConviteDoLar[] | null>(null);
  const [falhaNaLista, setFalhaNaLista] = useState(false);
  const [criado, setCriado] = useState<ConviteCriado | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [jaSaoDois, setJaSaoDois] = useState(members.some((pessoa) => pessoa.role === "conjuge"));
  const travado = useRef(false);

  const carregar = useCallback(async () => {
    setFalhaNaLista(false);
    try {
      const { invites } = await apiFetch<{ invites: ConviteDoLar[] }>("/api/invites");
      setConvites(invites);
    } catch {
      setFalhaNaLista(true);
    }
  }, []);

  useEffect(() => {
    if (!jaSaoDois) void carregar();
  }, [carregar, jaSaoDois]);

  const cabecalho = (
    <GreenTop variant="form" title="Adicionar cônjuge" close={{ to: "/configuracoes", label: "Fechar" }} />
  );

  if (jaSaoDois) {
    return (
      <div className="flex min-h-dvh flex-col bg-bg">
        {cabecalho}
        <main className="mx-auto flex w-full max-w-[520px] flex-col gap-5 px-4 pt-6 pb-8 tablet:px-0">
          <Card className="flex flex-col gap-5">
            <h1 className="text-[26px] font-extrabold tracking-[-0.4px]">
              Vocês já são dois no {brand.name}.
            </h1>
            <Button full onClick={() => navegar("/configuracoes")}>
              Concluir
            </Button>
          </Card>
        </main>
      </div>
    );
  }

  // Criar um convite novo (o formulário). Um clique por vez: a trava segura antes do re-render.
  async function adicionar(dados: DadosDoConjuge) {
    if (travado.current) return;
    travado.current = true;
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await apiEnviar<ConviteCriado>("/api/invites/conjuge", "POST", dados);
      setCriado(resposta);
    } catch (falha) {
      if (falha instanceof ApiError && falha.code === "conjuge_ja_existe") setJaSaoDois(true);
      else if (falha instanceof ApiError && falha.code === "convite_ativo") await carregar();
      else setErro(mensagemDoErro(falha));
    } finally {
      travado.current = false;
      setEnviando(false);
    }
  }

  // Gerar um link novo para o convite aguardando: o antigo deixa de valer.
  async function novoLink(convite: ConviteDoLar) {
    if (travado.current) return;
    travado.current = true;
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await apiEnviar<ConviteCriado>(`/api/invites/${convite.id}/renew`, "POST", {});
      setCriado(resposta);
    } catch (falha) {
      if (falha instanceof ApiError && falha.code === "conjuge_ja_existe") setJaSaoDois(true);
      else setErro(mensagemDoErro(falha));
      await carregar();
    } finally {
      travado.current = false;
      setEnviando(false);
    }
  }

  async function cancelar(convite: ConviteDoLar) {
    const confirmado = await confirmar({
      title: "Cancelar o convite?",
      description: "O link deixa de funcionar.",
      confirmLabel: "Cancelar convite",
      cancelLabel: "Manter",
      tone: "danger",
    });
    if (!confirmado) return;
    try {
      await apiFetch<{ ok: true }>(`/api/invites/${convite.id}`, { method: "DELETE" });
      setCriado(null);
      await carregar();
    } catch (falha) {
      setErro(mensagemDoErro(falha));
      await carregar();
    }
  }

  if (criado) {
    const { invite, link } = criado;
    return (
      <div className="flex min-h-dvh flex-col bg-bg">
        {cabecalho}
        <main className="mx-auto flex w-full max-w-[520px] flex-col gap-5 px-4 pt-6 pb-8 tablet:px-0">
          <Card className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <h1 className="text-[26px] font-extrabold tracking-[-0.4px]">Convite criado</h1>
              <p className="text-[14px] leading-normal text-ink-2">
                Envie o link para {invite.name ?? "seu cônjuge"}. Ele vale até {diaEMes(invite.expiresAt)} e
                serve uma vez só.
              </p>
            </div>
            <ShareLink
              link={link}
              shareTitle={TITULO_DO_COMPARTILHAMENTO}
              shareText={textoDoCompartilhamento(member.name, invite.expiresAt)}
              dica={DICA_DO_CONVITE}
            />
            <ConviteNaLista convite={invite} />
            <Button full onClick={() => navegar("/configuracoes")}>
              Concluir
            </Button>
          </Card>
        </main>
      </div>
    );
  }

  if (convites === null) {
    return (
      <div className="flex min-h-dvh flex-col bg-bg">
        {cabecalho}
        <div className="px-4 pt-4 tablet:px-6">
          {falhaNaLista ? (
            <ErrorState title="Não deu para carregar o convite." onRetry={() => void carregar()} />
          ) : (
            <SkeletonCard />
          )}
        </div>
      </div>
    );
  }

  const aguardando = convites[0];
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      {cabecalho}
      <main className="mx-auto flex w-full max-w-[520px] flex-col gap-5 px-4 pt-6 pb-8 tablet:px-0">
        {aguardando ? (
          <Card className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <h1 className="text-[26px] font-extrabold tracking-[-0.4px]">Convite aguardando</h1>
              <p className="text-[14px] leading-normal text-ink-2">
                Por segurança, o link só aparece quando é criado. Gere um novo para mandar de novo.
              </p>
            </div>
            <ConviteNaLista convite={aguardando} />
            {erro && (
              <p role="alert" className="text-[13px] text-danger">
                {erro}
              </p>
            )}
            <Button full loading={enviando} onClick={() => void novoLink(aguardando)}>
              Novo link
            </Button>
            <Button variant="secondary" full disabled={enviando} onClick={() => void cancelar(aguardando)}>
              Cancelar
            </Button>
          </Card>
        ) : (
          <>
            <Card className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <p className="text-[14px] leading-normal text-ink-2">
                  Seu cônjuge entra nesta mesma conta do {brand.name}, com a própria passkey, criada no
                  primeiro acesso.
                </p>
              </div>
              <SpouseForm enviando={enviando} erroGeral={erro} aoEnviar={adicionar} />
            </Card>
            <Card className="flex flex-col gap-3">
              <span className="text-[16px] font-extrabold">Vocês dois vão poder</span>
              {VOCES_DOIS_VAO_PODER.map((item) => (
                <span key={item} className="text-[13px] leading-normal text-ink-2">
                  {item}
                </span>
              ))}
            </Card>
            <p className="px-1 text-[13px] leading-normal text-ink-2">
              Cada conta tem um cônjuge. O link vale por 7 dias e serve uma vez só.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

// A linha do convite: quem é (o e-mail, ou o nome), a situação e o vencimento.
function ConviteNaLista({ convite }: { convite: ConviteDoLar }) {
  return (
    <span className="rounded-card border border-field-border bg-card px-4 py-3 text-[14px] text-ink">
      {convite.email ?? convite.name ?? "Cônjuge"} ·{" "}
      <span className="font-semibold text-primary">Aguardando entrar</span> · vence{" "}
      {diaEMes(convite.expiresAt)}
    </span>
  );
}
