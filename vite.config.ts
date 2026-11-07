import { defineConfig } from "vite";
import { presetVite } from "./preset/vite.mjs";

// A marca e a pasta pública do núcleo ficam em dev/ (o núcleo não tem app próprio).
export default defineConfig(presetVite({ marca: "dev/marca.json", publicDir: "dev/public" }));
