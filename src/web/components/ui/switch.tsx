import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
};

// Chave de 52 × 32 (Radix Switch). O botão tem 44 px de altura, que é o alvo de toque medido pelo navegador: a faixa de
// 32 px fica centrada dentro dele, e o desenho não muda. A área de toque de 46 px continua como pseudo-elemento, para
// quem toca perto da borda.
export function Switch({ checked, onCheckedChange, label, disabled = false, className }: Props) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "group relative inline-flex h-11 w-[52px] shrink-0 cursor-pointer items-center disabled:cursor-not-allowed disabled:opacity-50",
        "before:absolute before:inset-x-0 before:-inset-y-2 before:content-['']",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 rounded-[16px] border border-switch-off-border bg-switch-off transition-colors group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary"
      />
      <SwitchPrimitive.Thumb className="relative block size-6 translate-x-[3px] rounded-full bg-white transition-transform data-[state=checked]:translate-x-[23px]" />
    </SwitchPrimitive.Root>
  );
}
