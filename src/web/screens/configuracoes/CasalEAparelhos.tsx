import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ErrorState } from "@/components/ui/error-state";
import { GreenTop } from "@/components/ui/green-top";
import { SkeletonCard } from "@/components/ui/skeleton";
import { brand } from "../../../shared/brand";
import type { AparelhoDaPessoa, ListaDeAparelhos, PessoaComAparelhos } from "../../../shared/devices";
import type { LinkDeRecuperacao } from "../../../shared/recovery";
import { dicaDaRecuperacao } from "../../access/convite-textos";
import { createPasskey, mensagemDaPasskey } from "../../access/passkey-client";
import { ShareLink } from "../../access/ShareLink";
import { dataDoAparelho, horaDoLink } from "../../devices/datas";
import { textoDeRemocao } from "../../devices/remove-device-warning";
import { ApiError, apiEnviar, apiFetch, mensagemDoErro } from "../../lib/api";
import { useSession } from "../../session/SessionProvider";

// Casal e aparelhos (/configuracoes/casal, TASK-0106): cada pessoa com os aparelhos dela. Em "Adicionar este aparelho",
// cria a passkey deste aparelho. Em "Liberar acesso", gera o link de recuperação do parceiro (15 min, uma vez).
// Remover um aparelho encerra as sessões dele; remover o próprio aparelho em uso manda para entrar.
export function CasalEAparelhos() {
  const navegar = useNavigate();
  const { signOut, member } = useSession();
  const confirmar = useConfirm();
  const [pessoas, setPessoas] = useState<PessoaComAparelhos[] | null>(null);
  const [falhaNaLista, setFalhaNaLista] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [adicionando, setAdicionando] = useState(false);
  const [painelAberto, setPainelAberto] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [linkGerado, setLinkGerado] = useState<{
    pessoaId: string;
    nome: string;
    link: string;
    expiresAt: string;
  } | null>(null);
  const travado = useRef(false);

  const carregar = useCallback(async () => {
    setFalhaNaLista(false);
    try {
      const lista = await apiFetch<ListaDeAparelhos>("/api/devices");
      setPessoas(lista.members);
    } catch {
      setFalhaNaLista(true);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // "Adicionar este aparelho": a passkey deste navegador entra na conta, e a sessão passa a depender dela.
  async function adicionarEsteAparelho() {
    if (travado.current) return;
    travado.current = true;
    setAdicionando(true);
    setErro(null);
    setAviso(null);
    try {
      await createPasskey({ optionsUrl: "/api/devices/options", verifyUrl: "/api/devices/verify", body: {} });
      setAviso("Este aparelho entrou na lista.");
      await carregar();
    } catch (falha) {
      setErro(mensagemDeAdicionar(falha));
    } finally {
      travado.current = false;
      setAdicionando(false);
    }
  }

  // Remover: a confirmação é desta tela (useConfirm), com o texto do caso. O aparelho em uso manda para entrar.
  async function remover(pessoa: PessoaComAparelhos, aparelho: AparelhoDaPessoa) {
    const confirmado = await confirmar(
      textoDeRemocao({
        nome: pessoa.name,
        aparelho: aparelho.deviceName || "este aparelho",
        ehAtual: aparelho.isCurrent,
        ehUltimo: pessoa.devices.length === 1,
      }),
    );
    if (!confirmado) return;
    setErro(null);
    setAviso(null);
    try {
      const resposta = await apiFetch<{ endedCurrentSession: boolean }>(`/api/devices/${aparelho.id}`, {
        method: "DELETE",
      });
      if (resposta.endedCurrentSession) {
        await signOut().catch(() => undefined);
        navegar("/entrar", { replace: true });
        return;
      }
      setAviso("Aparelho removido. A sessão dele terminou.");
      await carregar();
    } catch (falha) {
      setErro(mensagemDoErro(falha));
      await carregar();
    }
  }

  // Liberar acesso: o link de 15 minutos da pessoa. Um link novo cancela o anterior.
  async function geraLink(pessoa: PessoaComAparelhos) {
    if (travado.current) return;
    travado.current = true;
    setGerando(true);
    setErro(null);
    try {
      const novo = await apiEnviar<LinkDeRecuperacao>("/api/recovery-invites", "POST", {
        memberId: pessoa.id,
      });
      setLinkGerado({ pessoaId: pessoa.id, nome: pessoa.name, link: novo.link, expiresAt: novo.expiresAt });
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      travado.current = false;
      setGerando(false);
    }
  }

  const cabecalho = (
    <GreenTop variant="detail" title="Casal e aparelhos" back={{ to: "/configuracoes", label: "Voltar" }} />
  );

  if (pessoas === null) {
    return (
      <div className="flex min-h-dvh flex-col bg-bg">
        {cabecalho}
        <div className="mx-auto w-full max-w-[720px] px-4 pt-6 tablet:px-6">
          {falhaNaLista ? (
            <ErrorState title="Não deu para carregar os aparelhos." onRetry={() => void carregar()} />
          ) : (
            <SkeletonCard />
          )}
        </div>
      </div>
    );
  }

  const temConjuge = pessoas.some((pessoa) => pessoa.role === "conjuge");

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      {cabecalho}
      <main className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-4 pt-6 pb-8 tablet:max-w-[1040px] tablet:px-6">
        {erro && (
          <p role="alert" className="text-[13px] text-danger">
            {erro}
          </p>
        )}
        {aviso && (
          <p role="status" className="text-[13px] text-ink-2">
            {aviso}
          </p>
        )}

        <div className="grid gap-5 tablet:grid-cols-2 tablet:items-start">
          {pessoas.map((pessoa) => {
            const inicial = pessoa.name.trim().charAt(0).toUpperCase() || "?";
            const aberto = painelAberto === pessoa.id;
            const link = linkGerado?.pessoaId === pessoa.id ? linkGerado : null;
            return (
              <Card key={pessoa.id} className="flex flex-col gap-4">
                <div className="flex items-center gap-3.5">
                  <span
                    aria-hidden="true"
                    className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-[18px] font-extrabold text-white"
                  >
                    {inicial}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <h2 className="truncate text-[17px] font-extrabold">{pessoa.name}</h2>
                    <div className="flex flex-wrap gap-2">
                      {pessoa.isMe && <Selo>você</Selo>}
                      <Selo>{pessoa.role === "titular" ? "Titular" : "Cônjuge"}</Selo>
                    </div>
                  </div>
                </div>

                <ul className="flex flex-col gap-3">
                  {pessoa.devices.length === 0 && (
                    <li className="text-[13px] text-ink-2">Nenhum aparelho cadastrado.</li>
                  )}
                  {pessoa.devices.map((aparelho) => (
                    <li key={aparelho.id} className="flex flex-col gap-1.5 rounded-card bg-field p-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-[15px] font-bold">
                          {aparelho.deviceName || "Aparelho"}
                        </span>
                        <button
                          type="button"
                          onClick={() => void remover(pessoa, aparelho)}
                          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center px-2 text-[14px] font-bold text-danger"
                        >
                          Remover
                        </button>
                      </div>
                      {(aparelho.isCurrent || aparelho.addedVia === "recuperacao") && (
                        <div className="flex flex-wrap gap-2">
                          {aparelho.isCurrent && <Selo>este aparelho</Selo>}
                          {aparelho.addedVia === "recuperacao" && <Selo>por recuperação</Selo>}
                        </div>
                      )}
                      <span className="text-[12px] text-ink-2">{linhaDeDatas(aparelho)}</span>
                    </li>
                  ))}
                </ul>

                {pessoa.isMe ? (
                  <div className="flex flex-col gap-2">
                    <Button
                      variant="secondary"
                      full
                      loading={adicionando}
                      onClick={() => void adicionarEsteAparelho()}
                    >
                      Adicionar este aparelho
                    </Button>
                    <p className="text-[13px] leading-normal text-ink-2">
                      Cria uma passkey neste aparelho para entrar direto, sem o celular.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <Button
                      variant="secondary"
                      full
                      onClick={() => setPainelAberto(aberto ? null : pessoa.id)}
                    >
                      Liberar acesso de {pessoa.name}
                    </Button>
                    <p className="text-[13px] leading-normal text-ink-2">
                      Para quando {pessoa.name} perder o aparelho: gera um link de uso único, válido por 15
                      minutos.
                    </p>
                    {aberto && (
                      <div className="flex flex-col gap-3 rounded-card border border-field-border p-4">
                        {link ? (
                          <>
                            <ShareLink
                              link={link.link}
                              shareTitle={`Recuperar o acesso ao ${brand.name}`}
                              shareText={`${member.name} liberou um aparelho novo para ${link.nome} no ${brand.name}. Abra o link para criar a passkey (vale até ${horaDoLink(link.expiresAt)}):`}
                              dica={dicaDaRecuperacao(link.nome)}
                            />
                            <p className="text-[13px] leading-normal text-ink-2">
                              Vale até {horaDoLink(link.expiresAt)}. {pessoa.name} cria uma passkey nova, e os
                              outros aparelhos de {pessoa.name} recebem um aviso.
                            </p>
                          </>
                        ) : (
                          <Button full loading={gerando} onClick={() => void geraLink(pessoa)}>
                            Gerar link
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {!temConjuge && (
          <Card className="flex flex-col gap-3">
            <span className="text-[16px] font-extrabold">Adicionar cônjuge</span>
            <p className="text-[13px] leading-normal text-ink-2">
              Quando a outra pessoa entrar pelo link, ela cria a passkey dela. Os dois ficam na mesma conta.
            </p>
            <Button
              variant="secondary"
              full
              onClick={() => navegar("/configuracoes/casal/adicionar-conjuge")}
            >
              Adicionar cônjuge
            </Button>
          </Card>
        )}

        <p className="px-1 text-[13px] leading-normal text-ink-2">
          Os dois entram com passkey. Se alguém perder o aparelho, o outro libera o acesso aqui. Se os dois
          perderem, quem instalou roda npm run recuperar-acesso no computador.
        </p>
      </main>
    </div>
  );
}

function Selo({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-card px-2.5 py-[3px] text-[12px] font-extrabold text-ink-2">
      {children}
    </span>
  );
}

// "Adicionado em DD/MM/AAAA · último uso DD/MM/AAAA", ou "ainda não usado".
function linhaDeDatas(aparelho: AparelhoDaPessoa): string {
  const adicionado = aparelho.createdAt
    ? `Adicionado em ${dataDoAparelho(aparelho.createdAt)}`
    : "Adicionado";
  const uso = aparelho.lastUsedAt ? `último uso ${dataDoAparelho(aparelho.lastUsedAt)}` : "ainda não usado";
  return `${adicionado} · ${uso}`;
}

// Erro de adicionar o aparelho: o aparelho que já tem uma passkey da conta, ou a tabela de passkeys.
function mensagemDeAdicionar(falha: unknown): string {
  if (falha instanceof ApiError && falha.code === "aparelho_ja_cadastrado") {
    return "Este aparelho já tem uma passkey sua.";
  }
  if (typeof falha === "object" && falha !== null) {
    const { name, cause } = falha as { name?: unknown; cause?: { name?: unknown } };
    if (name === "InvalidStateError" || cause?.name === "InvalidStateError") {
      return "Este aparelho já tem uma passkey sua.";
    }
  }
  return mensagemDaPasskey(falha).mensagem;
}
