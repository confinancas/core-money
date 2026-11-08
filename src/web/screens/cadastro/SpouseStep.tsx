import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { brand } from "../../../shared/brand";
import type { ConviteCriado } from "../../../shared/invites";
import {
  DICA_DO_CONVITE,
  diaEMes,
  TITULO_DO_COMPARTILHAMENTO,
  textoDoCompartilhamento,
  VOCES_DOIS_VAO_PODER,
} from "../../access/convite-textos";
import { ShareLink } from "../../access/ShareLink";
import { apiEnviar, mensagemDoErro } from "../../lib/api";
import { type DadosDoConjuge, SpouseForm } from "./SpouseForm";

// Passo 3 do cadastro (TASK-0103 com o formulário de TASK-0105): adicionar o cônjuge agora, com o link para mandar,
// ou depois, em Configurações › Casal. O convite nasce aqui; o link aparece uma vez.
export function SpouseStep({ nomeDoTitular }: { nomeDoTitular: string }) {
  const navegar = useNavigate();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criado, setCriado] = useState<{ nome: string; resposta: ConviteCriado } | null>(null);

  async function adicionar(dados: DadosDoConjuge) {
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await apiEnviar<ConviteCriado>("/api/invites/conjuge", "POST", dados);
      setCriado({ nome: dados.name, resposta });
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  if (criado) {
    const { resposta, nome } = criado;
    return (
      <Card className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[32px] font-extrabold tracking-[-0.5px]">Convite criado</h1>
          <p className="text-[14px] leading-normal text-ink-2">
            Envie o link para {nome}. Ele vale até {diaEMes(resposta.invite.expiresAt)} e serve uma vez só.
          </p>
        </div>

        <ShareLink
          link={resposta.link}
          shareTitle={TITULO_DO_COMPARTILHAMENTO}
          shareText={textoDoCompartilhamento(nomeDoTitular, resposta.invite.expiresAt)}
          dica={DICA_DO_CONVITE}
        />

        <span className="rounded-card border border-field-border bg-card px-4 py-3 text-[14px] text-ink">
          {nome} · cônjuge · <span className="font-semibold text-primary">Aguardando entrar</span>
        </span>

        <Button full onClick={() => navegar("/inicio")}>
          Entrar no {brand.name}
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[32px] font-extrabold tracking-[-0.5px]">Adicione seu cônjuge</h1>
        <p className="text-[14px] leading-normal text-ink-2">
          O {brand.name} é feito para dois. Seu cônjuge entra nesta mesma conta, com a própria passkey.
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-card bg-field p-4">
        <span className="text-[16px] font-extrabold">Vocês dois vão poder</span>
        {VOCES_DOIS_VAO_PODER.map((item) => (
          <span key={item} className="flex items-start gap-2.5 text-[13px] leading-normal text-ink-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-primary"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            {item}
          </span>
        ))}
      </section>

      <SpouseForm enviando={enviando} erroGeral={erro} aoEnviar={adicionar} />

      <Button variant="secondary" full onClick={() => navegar("/inicio")} disabled={enviando}>
        Adicionar depois
      </Button>
    </Card>
  );
}
