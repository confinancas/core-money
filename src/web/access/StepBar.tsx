// Barra de passos das telas de acesso: "Passo N de T · rótulo", com um segmento por passo.
export type Passos = { current: number; total: number; label: string };

export function StepBar({ current, total, label }: Passos) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-semibold text-ink-2">
        Passo {current} de {total} · {label}
      </p>
      <div className="flex gap-1.5" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => i + 1).map((passo) => (
          <span
            key={passo}
            className={
              passo <= current
                ? "h-1.5 flex-1 rounded-full bg-primary"
                : "h-1.5 flex-1 rounded-full bg-divider"
            }
          />
        ))}
      </div>
    </div>
  );
}
