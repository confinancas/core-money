import type { ReactNode } from "react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { BrandWordmark } from "@/components/brand/BrandWordmark";
import { brand } from "../../shared/brand";
import { type Passos, StepBar } from "./StepBar";

// Moldura das telas de acesso (configuração inicial e, depois, entrar, cadastro e convite):
// celular, topo verde com o formulário sobreposto; tablet, formulário centralizado sobre a faixa verde;
// desktop, painel verde à esquerda (referência: Login.dc.html, LoginTablet.dc.html e LoginDesktop.dc.html).
export function AccessLayout({ steps, children }: { steps?: Passos; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink desktop:flex-row">
      <aside className="hidden desktop:flex desktop:w-[560px] desktop:shrink-0 desktop:flex-col desktop:justify-between desktop:gap-10 desktop:rounded-r-[44px] desktop:bg-(image:--gradient-top) desktop:px-[60px] desktop:py-14 desktop:text-white desktop:shadow-top">
        <div className="flex flex-col gap-5">
          <Marca />
          <h2 className="max-w-[420px] text-[44px] leading-[1.08] font-black tracking-[-1.2px]">
            {brand.texts.tagline}
          </h2>
        </div>
        <div className="flex flex-col gap-[18px]">
          {GARANTIAS.map((garantia) => (
            <div key={garantia.titulo} className="flex items-start gap-3.5">
              <span className="flex size-[42px] shrink-0 items-center justify-center rounded-[14px] border border-white/24 bg-white/16" />
              <span className="flex flex-col gap-0.5">
                <span className="text-[16px] font-extrabold">{garantia.titulo}</span>
                <span className="text-[14px] leading-[1.45] text-white/82">{garantia.texto}</span>
              </span>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-h-dvh flex-1 flex-col desktop:justify-center desktop:px-16 desktop:py-12">
        <header className="flex flex-col gap-5 rounded-b-[36px] bg-(image:--gradient-top) px-6 pt-10 pb-20 text-white tablet:pt-16 tablet:text-center desktop:hidden">
          <div className="flex flex-col gap-4 tablet:items-center">
            <Marca />
            <span className="text-[15px] leading-[1.45] font-semibold text-white/82">
              {brand.texts.tagline}
            </span>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col gap-[22px] px-4 pb-8 -mt-14 tablet:px-0 desktop:mt-0 desktop:max-w-[460px]">
          {steps && <StepBar {...steps} />}
          {children}
        </main>
      </div>
    </div>
  );
}

const GARANTIAS = [
  { titulo: "Só leitura", texto: "O app vê os bancos pelo Open Finance, mas nunca move dinheiro." },
  { titulo: "Feito para dois", texto: "Cada um entra com a própria passkey, na mesma conta do casal." },
  { titulo: "Sem senha", texto: "A digital, o rosto ou o PIN do aparelho protegem a entrada de vocês dois." },
];

// Pílula branca com o ícone e o nome da marca (brand.name e as cores vêm do marca.json, nunca literais).
function Marca() {
  return (
    <div className="flex items-center gap-2.5 self-start rounded-full bg-card py-1.5 pr-[18px] pl-1.5 shadow-[0_10px_24px_rgba(10,90,60,0.25)] tablet:self-center">
      <BrandIcon className="size-10" />
      <BrandWordmark className="text-[22px] text-ink" />
    </div>
  );
}
