import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import { brand } from "../../../shared/brand";
import type { MembersResponse, MembroDaLista } from "../../../shared/members";
import { diaEMes } from "../../access/convite-textos";
import { SettingsRow } from "../../components/settings/SettingsRow";
import { apiFetch } from "../../lib/api";

// Seção Casal (TASK-0107): uma linha por pessoa do lar, o convite aguardando e o atalho para adicionar o cônjuge.
// Os dados vêm de GET /api/members. As telas de aparelhos e do convite são as das TASK-0105 e 0106.
export function SectionCasal() {
  const [dados, setDados] = useState<MembersResponse | null>(null);
  const [falhou, setFalhou] = useState(false);

  const carregar = useCallback(async () => {
    setFalhou(false);
    try {
      setDados(await apiFetch<MembersResponse>("/api/members"));
    } catch {
      setFalhou(true);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (dados === null) {
    return falhou ? (
      <ErrorState title="Não deu para carregar o casal." onRetry={() => void carregar()} />
    ) : (
      <SkeletonCard />
    );
  }

  const temConjuge = dados.members.some((pessoa) => pessoa.role === "conjuge");
  const convite = dados.pendingInvite;

  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-[13px] leading-normal text-ink-2">
        {brand.name} é de vocês dois. Cada um entra com a própria passkey.
      </p>
      <Card className="flex flex-col overflow-hidden p-0 [&>*+*]:border-t [&>*+*]:border-field-border">
        {dados.members.map((pessoa) => (
          <SettingsRow
            key={pessoa.id}
            inicio={<InicialDaPessoa nome={pessoa.name} />}
            titulo={
              <>
                {pessoa.name}
                {pessoa.isMe && <Selo>você</Selo>}
              </>
            }
            subtitulo={subtituloDaPessoa(pessoa)}
            valor={<Selo>{pessoa.role === "titular" ? "Titular" : "Cônjuge"}</Selo>}
            para="/configuracoes/casal"
          />
        ))}

        {convite && (
          <SettingsRow
            inicio={<InicialDaPessoa nome={convite.email ?? convite.name ?? "Cônjuge"} />}
            titulo={convite.email ?? convite.name ?? "Cônjuge"}
            subtitulo={`Aguardando entrar · vence ${diaEMes(convite.expiresAt)}`}
            para="/configuracoes/casal/adicionar-conjuge"
          />
        )}

        {!temConjuge && !convite && (
          <SettingsRow titulo="+ Adicionar cônjuge" para="/configuracoes/casal/adicionar-conjuge" />
        )}
      </Card>

      <p className="px-1 text-[13px] leading-normal text-ink-2">
        Os dois entram com passkey. Se alguém perder o aparelho, o outro libera o acesso em Casal e aparelhos.
      </p>
    </div>
  );
}

// "Criou a conta" (titular); o e-mail, ou "Entrou pelo convite" (cônjuge sem e-mail); e o número de aparelhos.
function subtituloDaPessoa(pessoa: MembroDaLista): string {
  const aparelhos = `${pessoa.devicesCount} ${pessoa.devicesCount === 1 ? "aparelho" : "aparelhos"}`;
  if (pessoa.role === "titular") return `Criou a conta · ${aparelhos}`;
  const quem = pessoa.email ?? "Entrou pelo convite";
  return `${quem} · ${aparelhos}`;
}

function InicialDaPessoa({ nome }: { nome: string }) {
  const inicial = nome.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-[18px] font-extrabold text-white"
    >
      {inicial}
    </span>
  );
}

function Selo({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-field px-2.5 py-[3px] text-[12px] font-extrabold text-ink-2">
      {children}
    </span>
  );
}
