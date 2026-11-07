import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
};

// Chave de 52 × 32 (Radix Switch). A área de toque vai a 44 px de altura, sem mudar o desenho.
export function Switch({ checked, onCheckedChange, label, disabled = false, className }: Props) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "relative inline-flex h-8 w-[52px] shrink-0 cursor-pointer items-center rounded-[16px] border border-switch-off-border bg-switch-off transition-colors",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50",
        "before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']",
        className,
      )}
    >
      <SwitchPrimitive.Thumb className="block size-6 translate-x-[3px] rounded-full bg-white transition-transform data-[state=checked]:translate-x-[23px]" />
    </SwitchPrimitive.Root>
  );
}
