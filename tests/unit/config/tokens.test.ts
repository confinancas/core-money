import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SPEND_TYPES } from "../../../src/shared/spend-types";

const css = readFileSync(new URL("../../../src/web/styles/global.css", import.meta.url), "utf8");

const escapar = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Valores do manual (processo: a spec da TASK-0004 é a fonte).
const tokens: [string, string][] = [
  ["color-bg", "#F2F5F3"],
  ["color-card", "#FFFFFF"],
  ["color-primary", "#0E9A63"],
  ["color-primary-ink", "#0A7D50"],
  ["color-primary-soft", "#E6F6EE"],
  ["color-primary-soft-2", "#C8EBD8"],
  ["color-chip-border", "#C9E9D8"],
  ["color-ink", "#18221E"],
  ["color-ink-2", "#66756E"],
  ["color-ink-3", "#5C6B64"],
  ["color-nav-idle", "#9FABA5"],
  ["color-divider", "#EDF1EF"],
  ["color-field", "#F4F7F5"],
  ["color-field-border", "#E7ECE9"],
  ["color-tile-border", "#E1E7E4"],
  ["color-switch-off", "#DBE3DF"],
  ["color-switch-off-border", "#D2DAD6"],
  ["color-warn", "#C27400"],
  ["color-warn-bg", "#FFF5E4"],
  ["color-danger", "#E5484D"],
  ["color-danger-bg", "#FFF0F1"],
  ["color-success", "#1E9E63"],
  ["color-success-ink", "#17804F"],
  ["color-success-bg", "#E7F7EF"],
  ["color-insight", "#10261E"],
  ["color-hidden-a", "#F7F9F8"],
  ["color-hidden-b", "#EDF1EF"],
  ["color-hidden-border", "#D2DAD6"],
  ["color-hidden-ink", "#98A39D"],
  ["color-badge", "#FF5A5F"],
  ["color-badge-ring", "#1AA571"],
  ["shadow-card", "0 8px 24px rgba(22, 60, 45, 0.07)"],
  ["shadow-primary", "0 8px 18px rgba(14, 154, 99, 0.24)"],
  ["shadow-top", "0 12px 30px rgba(11, 140, 90, 0.25)"],
  ["radius-card", "24px"],
  ["radius-top", "34px"],
  ["radius-field", "16px"],
  ["radius-tile", "14px"],
  ["radius-glass", "22px"],
  ["font-sans", '"Nunito Variable", system-ui, sans-serif'],
  ["breakpoint-tablet", "768px"],
  ["breakpoint-desktop", "1200px"],
];

describe("tokens do design system no global.css", () => {
  it.each(tokens)("tem --%s com o valor do manual (%s)", (nome, valor) => {
    const padrao = new RegExp(`--${escapar(nome)}:\\s*${escapar(valor)}\\s*;`, "i");
    expect(css).toMatch(padrao);
  });

  it("tem o gradiente do topo fora do @theme", () => {
    expect(css).toMatch(/--gradient-top:\s*linear-gradient\(150deg,\s*#22b47a 0%,\s*#0b8c5a 100%\)/i);
  });

  it("as sete --color-st-* são iguais às cores de SPEND_TYPES", () => {
    for (const tipo of SPEND_TYPES) {
      const padrao = new RegExp(`--color-st-${tipo.id}:\\s*${escapar(tipo.color)}\\s*;`, "i");
      expect(css, `--color-st-${tipo.id}`).toMatch(padrao);
    }
    const definidas = [...css.matchAll(/--color-st-([a-z]+):/g)].map((m) => m[1]);
    expect(definidas.sort()).toEqual(SPEND_TYPES.map((tipo) => tipo.id).sort());
  });
});
