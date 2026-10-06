import { describe, expect, it } from "vitest";
import { createSurfaceContext } from "../control-api/context.js";
import { createControlRegistry } from "../control-api/registry.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import type { MidiPortInfo } from "../core/types/identity.js";
import { MockMidiInput } from "../adapters/mock/mock-input.js";
import { createControlSurface } from "../surface/runtime.js";
import { generateControlMappings } from "../surface/generate.js";
import { DEVICE_REGISTRY, GENERIC_DEVICE, findDevice, requiresOutput, resolveDevice } from "./registry.js";

describe("resolveDevice", () => {
  it("falls back to the generic device when no registry entry names the input", () => {
    expect(findDevice({ name: "Maschine Mikro MK1" })).toBeUndefined();
    expect(resolveDevice({ name: "Maschine Mikro MK1" })).toBe(GENERIC_DEVICE);
    expect(resolveDevice({ name: null })).toBe(GENERIC_DEVICE);
  });

  it("keeps the registry entry for a device it names", () => {
    const launchpad = DEVICE_REGISTRY.find((entry) => entry.id === "novation.launchpad-mini-mk3");
    expect(resolveDevice({ name: "Launchpad Mini [MK3] MIDI Out" })).toBe(launchpad);
  });
});

describe("requiresOutput", () => {
  it("does not require an output for the generic device, so an input alone can connect", () => {
    expect(requiresOutput(GENERIC_DEVICE)).toBe(false);
  });

  it("requires an output for a device whose profile needs one to set up or be driven", () => {
    const launchpad = DEVICE_REGISTRY.find((entry) => entry.id === "novation.launchpad-mini-mk3")!;
    expect(requiresOutput(launchpad)).toBe(true);
  });
});

describe("generic device attach", () => {
  it("attaches on its input alone: no output is supplied, nothing is sent, and no setup runs", async () => {
    const portInfo: MidiPortInfo = { id: "main-in", type: "input", name: "Maschine Mikro MK1", manufacturer: null };
    const rawInput = new MockMidiInput(portInfo);
    const surface = createControlSurface({
      profile: GENERIC_DEVICE.profile,
      ports: { inputs: { "main-in": createMidiInput(rawInput) }, outputs: {} },
      bindingTable: [],
      context: createSurfaceContext(),
      registry: createControlRegistry([]),
      generate: generateControlMappings,
      initialNavigation: { mode: "steps" },
    });

    await surface.attach();
    expect(surface.state).toBe("attached");

    await surface.detach();
    expect(surface.state).toBe("detached");
  });
});
