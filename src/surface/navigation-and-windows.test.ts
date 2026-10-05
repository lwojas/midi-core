import { describe, expect, it } from "vitest";
import { createAction } from "../control-api/action.js";
import { createControl } from "../control-api/control.js";
import { createSurfaceContext } from "../control-api/context.js";
import { createControlRegistry } from "../control-api/registry.js";
import type { BooleanControlDef, NumericControlDef } from "../control-api/types/control.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import { createMockSurfaceDevice } from "../testing/mock-surface-device.js";
import { createMockSurfaceHarness } from "../testing/mock-surface-harness.js";
import { generateControlMappings } from "./generate.js";
import { createControlSurface } from "./runtime.js";
import type { SurfaceBindingTable } from "./types/bindings.js";
import type { DeviceProfile } from "../profile/types/profile.js";

/** The mock device's step grid is one row of eight pads (pad-1..pad-8). Steps are controls step.0.0..step.0.15, so two pages. */
const STEP_COUNT = 16;

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function withPaging(profile: DeviceProfile, columns: number): DeviceProfile {
  return { ...profile, grids: profile.grids?.map((grid) => ({ ...grid, paging: { rows: 1, columns } })) };
}

function build(press: "hold" | "toggle" = "hold", pageColumns = 1, sequenceLength = STEP_COUNT) {
  const device = createMockSurfaceDevice();
  const harness = createMockSurfaceHarness(device);
  const input = createMidiInput(device.input);
  const output = createMidiOutput(device.output);
  const context = createSurfaceContext();

  const steps = Array.from({ length: STEP_COUNT }, (_, column) =>
    createControl<BooleanControlDef>({ id: `step.0.${column}`, label: `Step ${column}`, kind: "boolean", default: false }),
  );
  const length = createControl<NumericControlDef>({ id: "steps.length", label: "Steps", kind: "number", min: 0, max: 64, default: 0 });
  length.setValue(sequenceLength);
  const mute = createControl<BooleanControlDef>({ id: "mute.0", label: "Mute 1", kind: "boolean", default: false });
  const volume = createControl<NumericControlDef>({ id: "track.1.volume", label: "Volume 1", kind: "number", min: 0, max: 127, default: 0 });
  const registry = createControlRegistry([...steps, length, mute, volume]);

  const table: SurfaceBindingTable = [
    {
      mode: "steps",
      bindings: [
        { kind: "window", physicalControlId: "pad-1", role: "step", gridId: "step-grid", template: "step.{row}.{column}", press, columnCountControl: "steps.length" },
        { kind: "window", physicalControlId: "pad-2", role: "step", gridId: "step-grid", template: "step.{row}.{column}", press, columnCountControl: "steps.length" },
        { kind: "window", physicalControlId: "pad-3", role: "step", gridId: "step-grid", template: "step.{row}.{column}", press, columnCountControl: "steps.length" },
        { kind: "window", physicalControlId: "pad-4", role: "step", gridId: "step-grid", template: "step.{row}.{column}", press, columnCountControl: "steps.length" },
        { kind: "window", physicalControlId: "pad-5", role: "step", gridId: "step-grid", template: "step.{row}.{column}", press, columnCountControl: "steps.length" },
        { kind: "window", physicalControlId: "pad-6", role: "step", gridId: "step-grid", template: "step.{row}.{column}", press, columnCountControl: "steps.length" },
        { kind: "window", physicalControlId: "pad-7", role: "step", gridId: "step-grid", template: "step.{row}.{column}", press, columnCountControl: "steps.length" },
        { kind: "window", physicalControlId: "pad-8", role: "step", gridId: "step-grid", template: "step.{row}.{column}", press, columnCountControl: "steps.length" },
        { kind: "navigate", physicalControlId: "button-1", role: "page right", navigate: { kind: "page", gridId: "step-grid", direction: { row: 0, column: 1 } } },
        { kind: "navigate", physicalControlId: "button-2", role: "page left", navigate: { kind: "page", gridId: "step-grid", direction: { row: 0, column: -1 } } },
        { kind: "navigate", physicalControlId: "button-4", role: "to mixer", navigate: { kind: "set-mode", mode: "mixer" } },
      ],
    },
    {
      mode: "mixer",
      activateOn: { scope: "track" },
      bindings: [
        { kind: "control", physicalControlId: "pad-1", role: "mute", resolve: { kind: "static", controlId: "mute.0" }, press },
        { kind: "control", physicalControlId: "knob-1", role: "track-fader", resolve: { kind: "static", controlId: "track.1.volume" } },
        { kind: "navigate", physicalControlId: "button-4", role: "to steps", navigate: { kind: "set-mode", mode: "steps" } },
      ],
    },
  ];

  const surface = createControlSurface({
    profile: withPaging(device.profile, pageColumns),
    ports: { inputs: { "main-in": input }, outputs: { "main-out": output } },
    bindingTable: table,
    context,
    registry,
    generate: generateControlMappings,
    initialNavigation: { mode: "steps", gridOffset: { row: 0, column: 0 } },
  });

  return { device, harness, surface, context, steps, mute, volume, length };
}

describe("ECS-89: offset-aware step grid", () => {
  it("drives the step at the current page offset, and repaints its LED when the page turns", async () => {
    const { harness, surface, steps } = build();
    steps[2]!.setValue(true);
    await surface.attach();

    // Page 0 (offset 0): pad-j is step j-1, so pad-3 is step 2 (on) and pad-2 is step 1 (off).
    expect(harness.lastFeedbackFor("pad-3")).toMatchObject({ type: "note-on", velocity: 127 });
    expect(harness.lastFeedbackFor("pad-2")).toMatchObject({ type: "note-off" });

    harness.press("button-1"); // page right: offset column 1
    await flush();
    // Page 1 (offset 1): pad-2 is step 2 (on), pad-3 is step 3 (off). The LEDs repaint with the window.
    expect(harness.lastFeedbackFor("pad-2")).toMatchObject({ type: "note-on" });
    expect(harness.lastFeedbackFor("pad-3")).toMatchObject({ type: "note-off" });

    harness.press("button-1");
    await flush();
    // Page 2 (offset 2): pad-1 is step 2 (on), pad-2 is step 3 (off).
    expect(harness.lastFeedbackFor("pad-1")).toMatchObject({ type: "note-on" });
    expect(harness.lastFeedbackFor("pad-2")).toMatchObject({ type: "note-off" });
    await surface.detach();
  });

  it("writes a pad press to the step under it on the current page, not to a fixed control", async () => {
    const { harness, surface, steps } = build();
    await surface.attach();
    harness.press("button-1"); // page 1
    await flush();

    harness.press("pad-1"); // page 1, pad-1 is step 1
    expect(steps[1]!.getValue()).toBe(true);
    expect(steps[0]!.getValue()).toBe(false);
    await surface.detach();
  });
});

describe("ECS-89: device navigation", () => {
  it("switches mode from a device button, and the new mode's bindings replace the old", async () => {
    const { harness, surface, mute } = build();
    await surface.attach();
    harness.press("button-4");
    await flush();
    expect(surface.navigation.state.mode).toBe("mixer");

    harness.press("pad-1");
    expect(mute.getValue()).toBe(true);
    await surface.detach();
  });

  it("paints the incoming mode from current state, and clears the outgoing mode's LEDs (motorized controls keep their position)", async () => {
    const { device, harness, surface, steps, mute, volume } = build();
    steps[2]!.setValue(true);
    mute.setValue(true);
    await surface.attach();
    expect(harness.lastFeedbackFor("pad-3")).toMatchObject({ type: "note-on" });

    harness.press("button-4"); // leave steps for mixer
    await flush();
    // Steps' LED is cleared on exit; mixer paints pad-1 from its mute state (on) on enter.
    expect(harness.lastFeedbackFor("pad-3")).toMatchObject({ type: "note-off" });
    expect(harness.lastFeedbackFor("pad-1")).toMatchObject({ type: "note-on" });
    const knobMessagesAfterEnter = device.output.sentMessages.filter((bytes) => bytes[0] === 0xb0).length;

    // Leaving mixer must not send the motorized knob back to its minimum: it keeps its position.
    harness.press("button-4");
    await flush();
    expect(device.output.sentMessages.filter((bytes) => bytes[0] === 0xb0).length).toBe(knobMessagesAfterEnter);
    expect(volume.getValue()).toBe(0);
    await surface.detach();
  });
});

describe("ECS-89: selection-driven mode", () => {
  it("switches to the mode whose activateOn scope matches a new selection, but not on the same mode twice", async () => {
    const { surface, context } = build();
    await surface.attach();
    expect(surface.navigation.state.mode).toBe("steps");

    context.setSelection({ scope: "track", id: "track-1" });
    expect(surface.navigation.state.mode).toBe("mixer");

    await flush();
    context.setSelection({ scope: "track", id: "track-2" });
    expect(surface.navigation.state.mode).toBe("mixer");
    await surface.detach();
  });

  it("stops following selection once detached", async () => {
    const { surface, context } = build();
    await surface.attach();
    await surface.detach();

    context.setSelection({ scope: "track", id: "track-1" });
    expect(surface.navigation.state.mode).toBe("steps");
  });
});

describe("ECS-89: toggle press", () => {
  it("a press flips the step under the pad and its LED follows, and release does nothing", async () => {
    const { harness, surface, steps } = build("toggle");
    await surface.attach();

    harness.press("pad-3"); // step 2
    expect(steps[2]!.getValue()).toBe(true);
    expect(harness.lastFeedbackFor("pad-3")).toMatchObject({ type: "note-on" });

    harness.release("pad-3");
    expect(steps[2]!.getValue()).toBe(true);

    harness.press("pad-3");
    expect(steps[2]!.getValue()).toBe(false);
    expect(harness.lastFeedbackFor("pad-3")).toMatchObject({ type: "note-off" });
    await surface.detach();
  });

  it("a press flips a mute in the mixer, and the LED follows", async () => {
    const { harness, surface, mute } = build("toggle");
    await surface.attach();
    harness.press("button-4");
    await flush();

    harness.press("pad-1");
    expect(mute.getValue()).toBe(true);
    expect(harness.lastFeedbackFor("pad-1")).toMatchObject({ type: "note-on" });
    await surface.detach();
  });
});

describe("ECS-89: paging bounds", () => {
  it("does not page before the first step", async () => {
    const { harness, surface } = build();
    await surface.attach();
    harness.press("button-2"); // page left from the first page
    await flush();
    expect(surface.navigation.state.gridOffset?.column).toBe(0);
    await surface.detach();
  });

  it("stops at the last window that still shows the end of the sequence", async () => {
    const { harness, surface } = build("hold", 1, 16); // 16 steps, 8 visible: last page starts at column 8
    await surface.attach();
    for (let press = 0; press < 12; press++) {
      harness.press("button-1");
      await flush();
    }
    expect(surface.navigation.state.gridOffset?.column).toBe(8);
    await surface.detach();
  });

  it("pages by the amount the profile declares, not by one cell", async () => {
    const { harness, surface } = build("hold", 4, 32);
    await surface.attach();
    harness.press("button-1");
    await flush();
    expect(surface.navigation.state.gridOffset?.column).toBe(4);
    await surface.detach();
  });
});
