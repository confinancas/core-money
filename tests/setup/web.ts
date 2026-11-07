import "@testing-library/jest-dom/vitest";

// Radix (Switch) usa ResizeObserver, que o jsdom não tem.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverSimulado {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", { value: ResizeObserverSimulado });
}
