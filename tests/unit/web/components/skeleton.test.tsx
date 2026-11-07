import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkeletonCard, useDelayedFlag } from "@/components/ui/skeleton";

function Carga({ carregando }: { carregando: boolean }) {
  const mostrar = useDelayedFlag(carregando, 300);
  return mostrar ? <SkeletonCard /> : <p>Pronto</p>;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("esqueleto com atraso", () => {
  it("com carga de 100 ms, o esqueleto não aparece", () => {
    const { rerender } = render(<Carga carregando />);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender(<Carga carregando={false} />);
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.queryByRole("status", { name: "Carregando" })).toBeNull();
    expect(screen.getByText("Pronto")).toBeInTheDocument();
  });

  it("com carga de 500 ms, o esqueleto aparece", () => {
    render(<Carga carregando />);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByRole("status", { name: "Carregando" })).toBeInTheDocument();
  });
});
