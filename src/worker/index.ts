import dadosDaMarca from "../../dev/marca.json";
import pkg from "../../package.json";
import type { BrandConfig } from "../shared/brand/types";
import { criarWorker } from "./criar-worker";

// Entrada de desenvolvimento (wrangler dev). Cada app tem a dele, no próprio repositório.
// O JSON chega com os valores alargados para string; o formato é o do BrandConfig.
const marca = dadosDaMarca as BrandConfig;

export default criarWorker({ marca, versao: pkg.version });
