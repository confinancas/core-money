// biome-ignore-all lint/a11y/useSemanticElements: o trilho pede botões em pílula com role radio (spec), não o radio nativo
import { type KeyboardEvent, useRef } from "react";
import { cn } from "@/lib/utils";

type Opcao = { value: string; label: string };

type Props = {
  options: readonly Opcao[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
};

// Seletor de uma opção entre poucas. Setas ← e → trocam a opção (e o foco), com volta no fim.
export function Segmented({ options, value, onChange, label, className }: Props) {
  const botoes = useRef<(HTMLButtonElement | null)[]>([]);
  const indiceAtual = Math.max(
    0,
    options.findIndex((opcao) => opcao.value === value),
  );

  function aoTeclar(evento: KeyboardEvent<HTMLDivElement>) {
    if (evento.key !== "ArrowRight" && evento.key !== "ArrowLeft") return;
    evento.preventDefault();
    const passo = evento.key === "ArrowRight" ? 1 : -1;
    const proximo = (indiceAtual + passo + options.length) % options.length;
    onChange(options[proximo].value);
    botoes.current[proximo]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={aoTeclar}
      className={cn("flex gap-1 rounded-full bg-divider p-1", className)}
    >
      {options.map((opcao, indice) => {
        const ativo = opcao.value === value;
        return (
          <button
            key={opcao.value}
            ref={(elemento) => {
              botoes.current[indice] = elemento;
            }}
            type="button"
            role="radio"
            aria-checked={ativo}
            tabIndex={ativo ? 0 : -1}
            onClick={() => onChange(opcao.value)}
            className={cn(
              "h-11 flex-1 whitespace-nowrap rounded-full px-3 text-[14px] font-extrabold transition-colors",
              ativo ? "bg-card text-primary shadow-segment" : "text-ink-2",
            )}
          >
            {opcao.label}
          </button>
        );
      })}
    </div>
  );
}
