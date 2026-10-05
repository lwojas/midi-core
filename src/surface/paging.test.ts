import { describe, expect, it } from "vitest";
import { createControl } from "../control-api/control.js";
import { createControlRegistry } from "../control-api/registry.js";
import { LAUNCHPAD_MINI_MK3_PROFILE } from "../profile/devices/launchpad-mini-mk3.js";
import { sequenceClamp } from "./paging.js";
import type { SurfaceBindingTable, WindowedControlBinding } from "./types/bindings.js";

function table(window: Partial<WindowedControlBinding>): SurfaceBindingTable {
  const binding: WindowedControlBinding = {
    kind: "window",
    physicalControlId: "pad-81",
    role: "step 0,0",
    gridId: "pads",
    template: "step.{row}.{column}",
    ...window,
  };
  return [{ mode: "steps", bindings: [binding] }];
}

const registry = (counts: Record<string, number>) =>
  createControlRegistry(Object.entries(counts).map(([id, value]) => createControl({ id, label: id, kind: "number", min: 0, max: 64, default: value })));

describe("sequenceClamp", () => {
  it("never pages before the first row or column", () => {
    const clamp = sequenceClamp(table({ rowCountControl: "tracks.count" }), LAUNCHPAD_MINI_MK3_PROFILE, registry({ "tracks.count": 16 }));
    expect(clamp({ row: -8, column: -8 })).toEqual({ row: 0, column: 0 });
  });

  it("stops the last track window at the track count, so the last eight tracks are the furthest down", () => {
    const clamp = sequenceClamp(table({ rowCountControl: "tracks.count" }), LAUNCHPAD_MINI_MK3_PROFILE, registry({ "tracks.count": 12 }));
    expect(clamp({ row: 8, column: 0 })).toEqual({ row: 4, column: 0 });
    expect(clamp({ row: 16, column: 0 })).toEqual({ row: 4, column: 0 });
  });

  it("allows a page down to any track window when the count is a whole number of pages", () => {
    const clamp = sequenceClamp(table({ rowCountControl: "tracks.count" }), LAUNCHPAD_MINI_MK3_PROFILE, registry({ "tracks.count": 16 }));
    expect(clamp({ row: 8, column: 0 })).toEqual({ row: 8, column: 0 });
  });

  it("bounds rows and columns independently, from their own counts", () => {
    const clamp = sequenceClamp(
      table({ columnCountControl: "steps.length", rowCountControl: "tracks.count" }),
      LAUNCHPAD_MINI_MK3_PROFILE,
      registry({ "steps.length": 32, "tracks.count": 16 }),
    );
    expect(clamp({ row: 99, column: 99 })).toEqual({ row: 8, column: 24 });
  });

  it("leaves rows unbounded when no window names a track count", () => {
    const clamp = sequenceClamp(table({}), LAUNCHPAD_MINI_MK3_PROFILE, registry({}));
    expect(clamp({ row: 99, column: 0 })).toEqual({ row: 99, column: 0 });
  });
});
