import { GreenTop } from "@/components/ui/green-top";
import { useBreakpoint } from "../../app/useBreakpoint";
import { colunasDasSecoes, SETTINGS_SECTIONS, type SettingsSection } from "./sections";

// Colunas por largura (classes estáticas, para o Tailwind achar): 1 no celular, 2 no tablet, 3 no desktop.
const COLUNAS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
};

// Configurações (/configuracoes, aba do menu, sem seta de voltar): as seções registradas em sections.ts.
// Uma seção = um título em caixa alta e o que ela mostra. A largura vem do useBreakpoint.
export function Configuracoes({ secoes = SETTINGS_SECTIONS }: { secoes?: SettingsSection[] }) {
  const largura = useBreakpoint();
  const colunas = colunasDasSecoes(secoes, largura);

  return (
    <section className="flex min-h-dvh flex-col bg-bg">
      <GreenTop variant="tab" title="Configurações" />
      <div
        className={`mx-auto grid w-full max-w-[1120px] items-start gap-5 px-4 pt-6 pb-8 tablet:px-6 ${COLUNAS[colunas.length] ?? "grid-cols-1"}`}
      >
        {colunas.map((coluna) => (
          <div key={coluna.map((secao) => secao.id).join("+")} className="flex min-w-0 flex-col gap-6">
            {coluna.map((secao) => (
              <section key={secao.id} aria-labelledby={`secao-${secao.id}`} className="flex flex-col gap-3">
                <h2
                  id={`secao-${secao.id}`}
                  className="px-1 text-[13px] font-extrabold uppercase tracking-[1px] text-ink-2"
                >
                  {secao.title}
                </h2>
                <secao.Component />
              </section>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
