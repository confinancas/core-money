import { useId } from "react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  id?: string;
  value: string;
  onChange: (texto: string) => void;
  onBlur?: () => void;
  // Texto antes do número, como "US$" no dólar. Não entra no valor digitado.
  prefixo?: string;
  hint?: string;
  error?: string;
};

// Campo de valor em reais (52 px, como o TextField). Digita-se com vírgula; quem lê o texto é parseMoneyInput.
export function MoneyInput({ label, id, value, onChange, onBlur, prefixo, hint, error }: Props) {
  const gerado = useId();
  const campoId = id ?? gerado;
  const dicaId = `${campoId}-dica`;
  const erroId = `${campoId}-erro`;
  const descritores = [hint && !error ? dicaId : null, error ? erroId : null].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={campoId} className="text-[13px] text-ink-2">
        {label}
      </label>
      <div
        className={cn(
          "flex h-[52px] items-center gap-2 rounded-field border border-field-border bg-field px-4 transition-colors",
          "focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/14",
          error && "border-danger",
        )}
      >
        {prefixo && <span className="shrink-0 text-[15px] font-bold text-ink-2">{prefixo}</span>}
        <input
          id={campoId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(evento) => onChange(evento.target.value)}
          onBlur={onBlur}
          aria-invalid={error ? true : undefined}
          aria-describedby={descritores || undefined}
          className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none"
        />
      </div>
      {hint && !error && (
        <p id={dicaId} className="text-[13px] text-ink-2">
          {hint}
        </p>
      )}
      {error && (
        <p id={erroId} className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
