import marca from "../../dev/marca.json";
import pkg from "../../package.json";
import { criarWorker } from "./criar-worker";

// Entrada de desenvolvimento (wrangler dev). Cada app tem a dele, no próprio repositório.
export default criarWorker({ marca, versao: pkg.version });
