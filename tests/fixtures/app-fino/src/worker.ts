import { type CriarWorkerOptions, criarWorker } from "@confinancas/core-money/worker";
import marca from "../marca.json";
import pkg from "../package.json";

// O JSON chega com os tipos alargados (id e wordmark como string): o formato é o do BrandConfig do núcleo.
const marcaDoApp = marca as CriarWorkerOptions["marca"];

export default criarWorker({
  marca: marcaDoApp,
  versao: pkg.version,
  rotasDoApp: (app) => {
    // O app registra antes das rotas do núcleo: /api/health troca a do núcleo; /api/fixture é nova.
    app.get("/health", (c) => c.json({ ok: true, origem: "app-fino-de-teste", versao: pkg.version }));
    app.get("/fixture", (c) => c.json({ origem: "app-fino-de-teste", rota: "/api/fixture" }));
  },
});
