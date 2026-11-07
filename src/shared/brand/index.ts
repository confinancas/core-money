import type { BrandConfig } from "./types";

// Definida pelo preset (preset/vite.mjs) a partir do marca.json do app. Único ponto de leitura da marca no front.
// Só o front lê este arquivo: o Worker importa apenas ./types (um teste confere).
declare const __BRAND__: BrandConfig;

export const brand: BrandConfig = __BRAND__;
