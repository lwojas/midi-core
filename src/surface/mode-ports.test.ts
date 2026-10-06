import { describe, expect, it, vi } from "vitest";
import { createControl } from "../control-api/control.js";
import { createControlRegistry } from "../control-api/registry.js";
import { createSurfaceContext } from "../control-api/context.js";
import type { BooleanControlDef, NumericControlDef } from "../control-api/types/control.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import { createMockSurfaceDevice } from "../testing/mock-surface-device.js";
import { createMockSurfaceHarness } from "../testing/mock-surface-harness.js";
import { generateControlMappings } from "./generate.js";
import { createSurfaceNavigation } from "./navigation.js";
import { createControlSurface, type ControlSurfaceDeps } from "./runtime.js";
import type { SurfaceBindingTable } from "./types/bindings.js";

describe("createSurfaceNavigation: canSetMode (ECS-104)", () => {
  it("refuses a switch the callback declines: the state stays and no listener is told", () => {
    const navigation = createSurfaceNavigation({ mode: "steps" }, { canSetMode: (mode) => mode !== "faders" });
    const listener = vi.fn();
    navigation.onChange(listener);
    navigation.setMode("faders");
    expect(navigation.state.mode).toBe("steps");
    expect(listener).not.toHaveBeenCalled();
  });

  it("allows a switch the callback accepts", () => {
    const navigation = createSurfaceNavigation({ mode: "steps" }, { canSetMode: () => true });
    navigation.setMode("mixer");
    expect(navigation.state.mode).toBe("mixer");
  });

  it("doesn't ask about the mode the surface is already in", () => {
    const canSetMode = vi.fn(() => false);
    const navigation = createSurfaceNavigation({ mode: "steps" }, { canSetMode });
    navigation.setMode("steps");
    expect(canSetMode).not.toHaveBeenCalled();
  });
});

describe("createControlSurface: a mode's required ports (ECS-104)", () => {
  it("refuses to enter a mode whose required port isn't connected, reports it, and stays in the current mode", async () => {
    const device = createMockSurfaceDevice();
    const harness = createMockSurfaceHarness(device);
    const volume = createControl<NumericControlDef>({ id: "track.1.volume", label: "Volume", kind: "number", min: 0, max: 127, default: 0 });
    const step = createControl<BooleanControlDef>({ id: "pattern.1.step.1", label: "Step 1", kind: "boolean", default: false });
    const bindingTable: SurfaceBindingTable = [
      { mode: "mixer", bindings: [{ physicalControlId: "knob-1", role: "track-fader", kind: "control", resolve: { kind: "static", controlId: "track.1.volume" } }] },
      {
        mode: "step-grid",
        bindings: [{ physicalControlId: "pad-1", role: "step", kind: "control", resolve: { kind: "static", controlId: "pattern.1.step.1" } }],
        requiredPortIds: ["daw-in"],
      },
    ];
    const deps: ControlSurfaceDeps = {
      profile: device.profile,
      ports: { inputs: { "main-in": createMidiInput(device.input) }, outputs: { "main-out": createMidiOutput(device.output) } },
      bindingTable,
      context: createSurfaceContext(),
      registry: createControlRegistry([volume, step]),
      generate: generateControlMappings,
      initialNavigation: { mode: "mixer" },
    };
    const surface = createControlSurface(deps);
    const errors: Array<{ code: string }> = [];
    surface.onError((error) => errors.push(error));
    await surface.attach();

    surface.navigation.setMode("step-grid");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(surface.navigation.state.mode).toBe("mixer");
    expect(errors.map((error) => error.code)).toEqual(["port-unavailable"]);
    harness.turnKnob("knob-1", 42);
    expect(volume.getValue()).toBe(42);
    await surface.detach();
  });
});
