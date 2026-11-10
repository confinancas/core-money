import { useState } from "react";
import { Button } from "@/components/ui/button";
import { brand } from "../../shared/brand";
import type { MotivoDoLimite } from "./limite-store";
import { UpgradeHelp } from "./UpgradeHelp";

// Tela do limite atingido (TASK-0109): fica no lugar do conteúdo, dentro da moldura. As telas são estáticas e continuam
// abrindo; o casal nunca vê a página de erro da Cloudflare sem explicação.
export function LimitReached({
  motivo,
  aoTentarDeNovo,
}: {
  motivo: MotivoDoLimite;
  aoTentarDeNovo: () => void;
}) {
  const [ajudaAberta, setAjudaAberta] = useState(false);
  const causa =
    motivo === "requisicoes"
      ? `O ${brand.name} usou hoje todas as requisições do plano gratuito da Cloudflare.`
      : `O banco do ${brand.name} chegou ao limite diário de leituras ou escritas do plano gratuito da Cloudflare.`;

  return (
    <section
      aria-labelledby="limite-titulo"
      className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 pt-10 pb-10 tablet:px-6"
    >
      <h1 id="limite-titulo" className="text-[22px] font-extrabold leading-tight text-ink">
        Limite do plano gratuito atingido
      </h1>
      <p className="text-[15px] leading-normal text-ink">{causa}</p>
      <p className="text-[15px] leading-normal text-ink-2">
        Os dados voltam às 21h (horário de Brasília), quando a Cloudflare zera os contadores. Nada foi
        perdido.
      </p>
      <div className="flex flex-col gap-3 tablet:flex-row">
        <Button variant="secondary" onClick={() => setAjudaAberta(true)}>
          Como fazer o upgrade
        </Button>
        <Button onClick={aoTentarDeNovo}>Tentar de novo</Button>
      </div>
      <UpgradeHelp aberto={ajudaAberta} onFechar={() => setAjudaAberta(false)} />
    </section>
  );
}
