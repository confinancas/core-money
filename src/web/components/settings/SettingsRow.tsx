import type { ReactNode } from "react";
import { Link } from "react-router";
import { IconeSeta } from "@/components/icons";
import { cn } from "@/lib/utils";

type Props = {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  // À esquerda do texto (a inicial da pessoa, por exemplo).
  inicio?: ReactNode;
  // À direita do texto: o valor da linha ("Dia 11") ou um selo.
  valor?: ReactNode;
  // Com `para` (rota) ou `aoAbrir`, a linha é um link ou um botão e mostra a seta. Sem nenhum dos dois, só lê.
  para?: string;
  aoAbrir?: () => void;
};

// Linha de Configurações: no mínimo 64 px de altura, como a spec pede para os cartões da tela.
export function SettingsRow({ titulo, subtitulo, inicio, valor, para, aoAbrir }: Props) {
  const interativa = para !== undefined || aoAbrir !== undefined;
  const conteudo = (
    <>
      {inicio}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-ink">{titulo}</span>
        {subtitulo !== undefined && (
          <span className="text-[13px] leading-normal text-ink-2">{subtitulo}</span>
        )}
      </span>
      {valor !== undefined && <span className="shrink-0 text-[14px] font-bold text-ink">{valor}</span>}
      {interativa && <IconeSeta size={18} className="shrink-0 rotate-180 text-ink-2" />}
    </>
  );
  const classe = cn(
    "flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left",
    interativa && "transition-colors hover:bg-field",
  );

  if (para !== undefined) {
    return (
      <Link to={para} className={classe}>
        {conteudo}
      </Link>
    );
  }
  if (aoAbrir !== undefined) {
    return (
      <button type="button" onClick={aoAbrir} className={classe}>
        {conteudo}
      </button>
    );
  }
  return <div className={classe}>{conteudo}</div>;
}
