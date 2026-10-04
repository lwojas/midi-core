import { describe, expect, it } from "vitest";
import { createControl } from "../control-api/control.js";
import { createControlRegistry } from "../control-api/registry.js";
import { createSurfaceContext } from "../control-api/context.js";
import type { BooleanControlDef, NumericControlDef } from "../control-api/types/control.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import { createMockSurfaceDevice } from "../testing/mock-surface-device.js";
import { createMockSurfaceHarness } from "../testing/mock-surface-harness.js";
import { bindActiveMode } from "./bindings.js";
import { generateControlMappings } from "./generate.js";
import { switchMode } from "./mode-switching.js";
import { createSurfaceNavigation } from "./navigation.js";
import type { ControlBinding, SurfaceBindingTable } from "./types/bindings.js";

/**
 * ECS-75: "the same profile-defined controls can serve Mixer, Transport
 * and Step Grid mappings." One `DeviceProfile` (the generic mock surface
 * device, ECS-71), one `SurfaceBindingTable` naming all three modes; at
 * any moment only the active mode's bindings are live, switched by
 * tearing down the outgoing mode and installing the incoming one — no
 * MIDI protocol change, no device-aware application code, just which
 * `ControlId` the same physical knob/button/pad currently drives.
 */
describe("mode switching (ECS-75)", () => {
  it("only the active mode's bindings are live; switching tears down the outgoing mode and installs the incoming one", async () => {
    const device = createMockSurfaceDevice();
    const harness = createMockSurfaceHarness(device);

    const volumeDef: NumericControlDef = { id: "track.1.volume", label: "Volume", kind: "number", min: 0, max: 127, default: 0 };
    const recordingDef: BooleanControlDef = { id: "transport.recording", label: "Recording", kind: "boolean", default: false };
    const stepDef: BooleanControlDef = { id: "pattern.1.step.1", label: "Step 1", kind: "boolean", default: false };

    const volume = createControl(volumeDef);
    const recording = createControl(recordingDef);
    const step = createControl(stepDef);
    const registry = createControlRegistry([volume, recording, step]);
    const context = createSurfaceContext();

    let mixerEnters = 0;
    let mixerExits = 0;

    const table: SurfaceBindingTable = [
      {
        mode: "mixer",
        bindings: [{ physicalControlId: "knob-1", role: "track-fader", kind: "control", resolve: { kind: "static", controlId: "track.1.volume" } }],
        hooks: {
          onEnter: () => {
            mixerEnters++;
          },
          onExit: () => {
            mixerExits++;
          },
        },
      },
      {
        mode: "transport",
        bindings: [{ physicalControlId: "button-1", role: "recording-indicator", kind: "control", resolve: { kind: "static", controlId: "transport.recording" } }],
      },
      {
        mode: "step-grid",
        bindings: [{ physicalControlId: "pad-1", role: "step", kind: "control", resolve: { kind: "static", controlId: "pattern.1.step.1" } }],
      },
    ];

    const navigation = createSurfaceNavigation({ mode: "mixer" });
    const deps = {
      profile: device.profile,
      context,
      registry,
      ports: { inputs: { "main-in": createMidiInput(device.input) }, outputs: { "main-out": createMidiOutput(device.output) } },
      generate: generateControlMappings,
    };

    let teardown = await bindActiveMode(table, navigation, deps);
    expect(mixerEnters).toBe(1);

    // Mixer is active: knob-1 drives volume; pad-1/button-1 are unbound (not in this mode's table entry).
    harness.turnKnob("knob-1", 64);
    expect(volume.getValue()).toBe(64);
    harness.press("pad-1");
    expect(step.getValue()).toBe(false);
    harness.press("button-1");
    expect(recording.getValue()).toBe(false);

    // Switch to Step Grid: the same device, the same profile, a different active mode.
    navigation.setMode("step-grid");
    teardown = await switchMode(table, navigation, teardown, deps);
    expect(mixerExits).toBe(1);

    harness.press("pad-1");
    expect(step.getValue()).toBe(true);
    harness.turnKnob("knob-1", 10); // mixer's binding is gone -- no longer tracked
    expect(volume.getValue()).toBe(64);

    // Switch to Transport.
    navigation.setMode("transport");
    teardown = await switchMode(table, navigation, teardown, deps);

    harness.press("button-1");
    expect(recording.getValue()).toBe(true);
    harness.press("pad-1"); // step-grid's binding is gone -- no longer tracked
    expect(step.getValue()).toBe(true); // unchanged from before, no new press reached it

    // Back to Mixer -- a full cycle, proving this isn't a one-shot transition.
    navigation.setMode("mixer");
    teardown = await switchMode(table, navigation, teardown, deps);
    expect(mixerEnters).toBe(2);

    harness.turnKnob("knob-1", 30);
    expect(volume.getValue()).toBe(30);

    await teardown();
  });

  it("a page-only navigation change (same mode) needs no switchMode call -- bindings are untouched", async () => {
    const device = createMockSurfaceDevice();
    const harness = createMockSurfaceHarness(device);

    const stepDef: BooleanControlDef = { id: "pattern.1.step.1", label: "Step 1", kind: "boolean", default: false };
    const step = createControl(stepDef);
    const registry = createControlRegistry([step]);
    const context = createSurfaceContext();

    const table: SurfaceBindingTable = [
      { mode: "step-grid", bindings: [{ physicalControlId: "pad-1", role: "step", kind: "control", resolve: { kind: "static", controlId: "pattern.1.step.1" } }] },
    ];

    const navigation = createSurfaceNavigation({ mode: "step-grid", gridOffset: { row: 0, column: 0 } });
    const deps = {
      profile: device.profile,
      context,
      registry,
      ports: { inputs: { "main-in": createMidiInput(device.input) }, outputs: { "main-out": createMidiOutput(device.output) } },
      generate: generateControlMappings,
    };

    const teardown = await bindActiveMode(table, navigation, deps);

    navigation.pageBy({ row: 0, column: 1 }); // same mode -- nothing about which ControlMapping set is active changed

    harness.press("pad-1"); // still bound: pageBy never tore anything down
    expect(step.getValue()).toBe(true);

    await teardown();
  });
});
