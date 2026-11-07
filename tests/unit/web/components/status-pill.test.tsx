import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusPill } from "@/components/ui/status-pill";

afterEach(cleanup);

describe("StatusPill", () => {
  it.each([
    ["aviso", "text-warn", "bg-warn-bg"],
    ["falta", "text-danger", "bg-danger-bg"],
    ["sucesso", "text-success-ink", "bg-success-bg"],
  ] as const)("o tom %s usa as cores do manual", (tone, texto, fundo) => {
    render(<StatusPill tone={tone}>Estado</StatusPill>);

    const pilula = screen.getByText("Estado");
    expect(pilula).toHaveClass(texto);
    expect(pilula).toHaveClass(fundo);
  });
});
