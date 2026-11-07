import { montarApp } from "@confinancas/core-money/web";

// A tela de /inicio é trocada pela do app; as outras rotas continuam as do núcleo.
montarApp({
  telas: {
    "/inicio": <p>Tela sobrescrita pela fixture do app fino</p>,
  },
});
