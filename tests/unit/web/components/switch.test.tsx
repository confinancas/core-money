import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Switch } from "@/components/ui/switch";

function Harness() {
  const [ligado, setLigado] = useState(false);
  return <Switch label="Avisar no limite" checked={ligado} onCheckedChange={setLigado} />;
}

afterEach(cleanup);

describe("Switch", () => {
  it("alterna aria-checked a cada clique", async () => {
    const usuario = userEvent.setup();
    render(<Harness />);

    const chave = screen.getByRole("switch", { name: "Avisar no limite" });
    expect(chave).toHaveAttribute("aria-checked", "false");

    await usuario.click(chave);
    expect(chave).toHaveAttribute("aria-checked", "true");

    await usuario.click(chave);
    expect(chave).toHaveAttribute("aria-checked", "false");
  });
});
