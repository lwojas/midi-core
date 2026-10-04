import { describe, expect, it, vi } from "vitest";
import { createControl } from "./control.js";
import { createControlRegistry } from "./registry.js";
import type { BooleanControlDef, NumericControlDef } from "./types/control.js";

const volume: NumericControlDef = { id: "track.1.volume", label: "Volume", kind: "number", min: 0, max: 1, default: 0.8 };
const muted: BooleanControlDef = { id: "track.1.muted", label: "Mute", kind: "boolean", default: false };

describe("createControlRegistry", () => {
  it("starts with the given initial controls", () => {
    const control = createControl(volume);
    const registry = createControlRegistry([control]);

    expect(registry.listControls()).toEqual([control]);
    expect(registry.getControl(volume.id)).toBe(control);
  });

  it("getControl returns undefined for an id nothing is registered under", () => {
    expect(createControlRegistry().getControl("nowhere.volume")).toBeUndefined();
  });

  it("add() registers a control and notifies with type 'added'", () => {
    const registry = createControlRegistry();
    const control = createControl(muted);
    const listener = vi.fn();
    registry.onChange(listener);

    registry.add(control);

    expect(registry.getControl(muted.id)).toBe(control);
    expect(listener).toHaveBeenCalledWith({ type: "added", control });
  });

  it("remove() unregisters a control and notifies with type 'removed'", () => {
    const control = createControl(muted);
    const registry = createControlRegistry([control]);
    const listener = vi.fn();
    registry.onChange(listener);

    registry.remove(muted.id);

    expect(registry.getControl(muted.id)).toBeUndefined();
    expect(listener).toHaveBeenCalledWith({ type: "removed", control });
  });

  it("remove() of an id that isn't registered is a no-op: no notification", () => {
    const registry = createControlRegistry();
    const listener = vi.fn();
    registry.onChange(listener);

    registry.remove("nowhere.volume");

    expect(listener).not.toHaveBeenCalled();
  });

  it("add() replaces whatever was previously registered under the same ControlId", () => {
    const first = createControl(volume, 0.2);
    const second = createControl(volume, 0.9);
    const registry = createControlRegistry([first]);

    registry.add(second);

    expect(registry.getControl(volume.id)).toBe(second);
    expect(registry.listControls()).toHaveLength(1);
  });
});
