import { describe, expect, it, vi } from "vitest";
import { createSurfaceEventSource } from "./event.js";

describe("createSurfaceEventSource", () => {
  it("emit() notifies every current listener with the event", () => {
    const source = createSurfaceEventSource();
    const listener = vi.fn();
    source.onEvent(listener);

    source.emit({ id: "pattern.step.triggered", payload: { step: 3 } });

    expect(listener).toHaveBeenCalledWith({ id: "pattern.step.triggered", payload: { step: 3 } });
  });

  it("notifies several independent listeners for the same emit()", () => {
    const source = createSurfaceEventSource();
    const first = vi.fn();
    const second = vi.fn();
    source.onEvent(first);
    source.onEvent(second);

    source.emit({ id: "transport.tick", payload: { step: 1 } });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("unsubscribing stops further notifications", () => {
    const source = createSurfaceEventSource();
    const listener = vi.fn();
    const unsubscribe = source.onEvent(listener);

    unsubscribe();
    source.emit({ id: "transport.tick", payload: { step: 1 } });

    expect(listener).not.toHaveBeenCalled();
  });

  it("retains nothing between emits: a listener added after an emit doesn't see it", () => {
    const source = createSurfaceEventSource();
    source.emit({ id: "transport.tick", payload: { step: 1 } });

    const lateListener = vi.fn();
    source.onEvent(lateListener);

    expect(lateListener).not.toHaveBeenCalled();
  });
});
