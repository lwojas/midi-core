import { describe, expect, it, vi } from "vitest";
import { createSurfaceNavigation } from "./navigation.js";
import type { SurfaceNavigationState } from "./types/navigation.js";

describe("createSurfaceNavigation", () => {
  it("starts at the given initial state", () => {
    const initial: SurfaceNavigationState = { mode: "mixer" };
    const navigation = createSurfaceNavigation(initial);
    expect(navigation.state).toEqual(initial);
  });

  it("setMode changes the mode and notifies listeners", () => {
    const navigation = createSurfaceNavigation({ mode: "mixer" });
    const listener = vi.fn();
    navigation.onChange(listener);

    navigation.setMode("step-grid");

    expect(navigation.state.mode).toBe("step-grid");
    expect(listener).toHaveBeenCalledWith({ from: { mode: "mixer" }, to: { mode: "step-grid" } });
  });

  it("setMode to the current mode is a no-op (no notification)", () => {
    const navigation = createSurfaceNavigation({ mode: "mixer" });
    const listener = vi.fn();
    navigation.onChange(listener);

    navigation.setMode("mixer");

    expect(listener).not.toHaveBeenCalled();
  });

  it("pageBy accumulates a signed delta onto the current gridOffset", () => {
    const navigation = createSurfaceNavigation({ mode: "step-grid", gridOffset: { row: 0, column: 0 } });

    navigation.pageBy({ row: 0, column: 1 });
    expect(navigation.state.gridOffset).toEqual({ row: 0, column: 1 });

    navigation.pageBy({ row: 0, column: -1 });
    expect(navigation.state.gridOffset).toEqual({ row: 0, column: 0 });
  });

  it("pageBy is a no-op for a mode with no gridOffset, rather than fabricating one", () => {
    const navigation = createSurfaceNavigation({ mode: "transport" });
    const listener = vi.fn();
    navigation.onChange(listener);

    navigation.pageBy({ row: 0, column: 1 });

    expect(navigation.state.gridOffset).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribing stops further notifications", () => {
    const navigation = createSurfaceNavigation({ mode: "mixer" });
    const listener = vi.fn();
    const unsubscribe = navigation.onChange(listener);

    unsubscribe();
    navigation.setMode("transport");

    expect(listener).not.toHaveBeenCalled();
  });
});
