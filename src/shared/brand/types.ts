import type { BrandId } from "../household";

// Dados da marca de um app (o marca.json do app). O núcleo lê só daqui: src/worker importa só este arquivo.
export type BrandConfig = {
  id: BrandId;
  workerName: string;
  repositorio: string;
  name: string;
  shortName: string;
  wordmark: [string, string];
  colors: { theme: string; background: string; wordmarkA: string; wordmarkB: string };
  texts: { tagline: string; assistantCta: string; householdLabel: string };
};
