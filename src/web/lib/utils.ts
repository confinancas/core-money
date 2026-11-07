import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Junta classes e resolve conflitos do Tailwind (a última vence).
export function cn(...entradas: ClassValue[]): string {
  return twMerge(clsx(entradas));
}
