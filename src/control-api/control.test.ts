import { describe, expect, it, vi } from "vitest";
import { createControl } from "./control.js";
import type { BooleanControlDef, NumericControlDef } from "./types/control.js";

const volume: NumericControlDef = { id: "track.1.volume", label: "Volume", kind: "number", min: 0, max: 1, default: 0.8 };
const muted: BooleanControlDef = { id: "track.1.muted", label: "Mute", kind: "boolean", default: false };

describe("createControl", () => {
  it("starts at def.default when no initial value is given", () => {
    expect(createControl(volume).getValue()).toBe(0.8);
  });

  it("starts at the given initial value", () => {
    expect(createControl(volume, 0.5).getValue()).toBe(0.5);
  });

  it("throws for an invalid initial value", () => {
    expect(() => createControl(volume, 2)).toThrow();
  });

  it("setValue updates getValue and notifies onChange with (value, previous)", () => {
    const control = createControl(volume);
    const listener = vi.fn();
    control.onChange(listener);

    control.setValue(0.5);

    expect(control.getValue()).toBe(0.5);
    expect(listener).toHaveBeenCalledWith(0.5, 0.8);
  });

  it("setValue throws for an out-of-range value and leaves the value unchanged", () => {
    const control = createControl(volume);
    expect(() => control.setValue(2)).toThrow();
    expect(control.getValue()).toBe(0.8);
  });

  it("setValue with the current value is a no-op: no onChange fires", () => {
    const control = createControl(volume);
    const listener = vi.fn();
    control.onChange(listener);

    control.setValue(0.8);

    expect(listener).not.toHaveBeenCalled();
  });

  it("supports several independent listeners, neither acting as an intermediary for the other", () => {
    const control = createControl(muted);
    const surfaceSideListener = vi.fn();
    const uiSideListener = vi.fn();
    control.onChange(surfaceSideListener);
    control.onChange(uiSideListener);

    control.setValue(true);

    expect(surfaceSideListener).toHaveBeenCalledWith(true, false);
    expect(uiSideListener).toHaveBeenCalledWith(true, false);
  });

  it("unsubscribing one listener leaves others receiving changes", () => {
    const control = createControl(muted);
    const stays = vi.fn();
    const leaves = vi.fn();
    control.onChange(stays);
    const unsubscribe = control.onChange(leaves);

    unsubscribe();
    control.setValue(true);

    expect(stays).toHaveBeenCalledWith(true, false);
    expect(leaves).not.toHaveBeenCalled();
  });
});
