import { type InputHTMLAttributes, useId } from "react";
import { cn } from "@/lib/utils";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
};

// Campo de 52 px. Erro: borda de perigo, aria-invalid, e a mensagem ligada por aria-describedby.
export function TextField({ label, hint, error, id, className, ...rest }: Props) {
  const gerado = useId();
  const campoId = id ?? gerado;
  const dicaId = `${campoId}-dica`;
  const erroId = `${campoId}-erro`;
  const descritores = [hint ? dicaId : null, error ? erroId : null].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={campoId} className="text-[13px] text-ink-2">
        {label}
      </label>
      <input
        id={campoId}
        aria-invalid={error ? true : undefined}
        aria-describedby={descritores || undefined}
        className={cn(
          "h-[52px] rounded-field border border-field-border bg-field px-4 text-[16px] text-ink outline-none transition-colors",
          "focus:border-primary focus:ring-[3px] focus:ring-primary/14",
          error && "border-danger",
          className,
        )}
        {...rest}
      />
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
