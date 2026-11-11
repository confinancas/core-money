import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { brand } from "../../shared/brand";

export const LINK_DOS_PRECOS_DA_CLOUDFLARE = "https://developers.cloudflare.com/workers/platform/pricing/";

// Como fazer o upgrade (TASK-0109): um painel na própria tela, com os três passos e o link dos preços oficiais.
// Os passos seguem o painel da Cloudflare; a conferência deles no painel é um roteiro manual, fora do código.
export function UpgradeHelp({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  return (
    <Dialog open={aberto} onOpenChange={(proximo) => !proximo && onFechar()}>
      <DialogContent
        className={cn(
          "inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-card",
          "tablet:inset-x-auto tablet:bottom-auto tablet:left-1/2 tablet:top-1/2 tablet:w-[520px] tablet:-translate-x-1/2 tablet:-translate-y-1/2 tablet:rounded-card",
        )}
      >
        <DialogTitle>Como fazer o upgrade</DialogTitle>
        <DialogDescription className="mt-2">Plano pago da Cloudflare: US$ 5 por mês.</DialogDescription>
        <div className="mt-5 flex flex-col gap-3 text-[14px] leading-normal text-ink">
          <p>1. Entre em dash.cloudflare.com com a conta onde o {brand.name} está instalado.</p>
          <p>2. Abra Workers e Pages › Planos e escolha o Workers Paid (US$ 5 por mês).</p>
          <p>3. Volte aqui e ligue "Estou no plano pago" em Configurações › Plano da Cloudflare.</p>
          <p className="text-ink-2">O app não descobre o plano sozinho. Nada muda no código nem nos dados.</p>
        </div>
        <a
          href={LINK_DOS_PRECOS_DA_CLOUDFLARE}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex min-h-11 items-center text-[14px] font-bold text-primary underline"
        >
          Preços oficiais da Cloudflare
        </a>
        <div className="mt-6 flex justify-end">
          <Button variant="secondary" onClick={onFechar}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
