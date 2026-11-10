import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Preset dos apps: React, Tailwind, PWA, marca e saída em dist/client, com a API no wrangler dev (porta 8787).
// Caminhos da marca e dos arquivos públicos são do app: relativos à pasta de onde o Vite roda (process.cwd()).
// O alias @ sai do próprio arquivo: num app, o núcleo está em node_modules e o caminho muda.
// __DEV_ROUTES__ depende do mode: as rotas de desenvolvimento (o catálogo) não entram no build de produção.
export function presetVite({ marca = "marca.json", publicDir = "public" } = {}) {
  const dadosDaMarca = JSON.parse(readFileSync(resolve(process.cwd(), marca), "utf8"));
  // A versão do app é a do package.json do app (TASK-0107: a tela Configurações mostra "Versão …").
  const versaoDoApp = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")).version;

  return ({ mode }) => ({
    plugins: [react(), tailwindcss(), brandHtml(dadosDaMarca), VitePWA(opcoesDoPwa(dadosDaMarca))],
    publicDir: resolve(process.cwd(), publicDir),
    resolve: {
      alias: { "@": fileURLToPath(new URL("../src/web", import.meta.url)) },
    },
    define: {
      __DEV_ROUTES__: JSON.stringify(mode !== "production"),
      __BRAND__: JSON.stringify(dadosDaMarca),
      __APP_VERSION__: JSON.stringify(versaoDoApp),
    },
    build: { outDir: "dist/client", emptyOutDir: true },
    server: {
      port: 5173,
      strictPort: true,
      // 127.0.0.1, não localhost: o wrangler escuta em IPv4 e o Node pode resolver localhost para ::1.
      proxy: { "/api": "http://127.0.0.1:8787" },
    },
  });
}

// Preenche os marcadores do index.html com os dados da marca do app.
function brandHtml(marca) {
  return {
    name: "marca-no-html",
    transformIndexHtml(html) {
      return html
        .replaceAll("%BRAND_NAME%", escaparHtml(marca.name))
        .replaceAll("%BRAND_SHORT_NAME%", escaparHtml(marca.shortName))
        .replaceAll("%BRAND_THEME%", escaparHtml(marca.colors.theme));
    },
  };
}

function escaparHtml(texto) {
  return String(texto).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

// O registro do service worker é chamado pelo montarApp (virtual:pwa-register), por isso injectRegister: false.
// Workbox: /api/* nunca vem do cache; a navegação sem rede cai no index.html para abrir a moldura offline.
function opcoesDoPwa(marca) {
  return {
    registerType: "autoUpdate",
    injectRegister: false,
    includeAssets: ["icons/apple-touch-icon.png", "icons/icon.svg"],
    manifest: {
      id: "/",
      start_url: "/",
      scope: "/",
      name: marca.name,
      short_name: marca.shortName,
      description: marca.texts.tagline,
      lang: "pt-BR",
      display: "standalone",
      theme_color: marca.colors.theme,
      background_color: marca.colors.background,
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    workbox: {
      navigateFallback: "/index.html",
      navigateFallbackDenylist: [/^\/api\//],
      globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      // Com injectRegister: false, o plugin não liga estas duas opções: sem elas, uma versão nova fica em waiting.
      skipWaiting: true,
      clientsClaim: true,
    },
  };
}
