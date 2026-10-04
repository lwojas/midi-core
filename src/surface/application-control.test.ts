import { describe, expect, it } from "vitest";
import { createAction } from "../control-api/action.js";
import { createControl } from "../control-api/control.js";
import { createControlRegistry } from "../control-api/registry.js";
import { createSurfaceContext } from "../control-api/context.js";
import type { BooleanControlDef, EnumControlDef, NumericControlDef } from "../control-api/types/control.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import { createMockSurfaceDevice } from "../testing/mock-surface-device.js";
import { createMockSurfaceHarness } from "../testing/mock-surface-harness.js";
import { bindActionTrigger } from "./action-binding.js";
import { bindSurfaceMode } from "./bindings.js";
import { generateControlMappings, toMidiSource } from "./generate.js";
import type { ControlBinding } from "./types/bindings.js";

/**
 * ECS-74: "route hardware input through MIDI Core and Device Profiles
 * into surface bindings, then invoke abstract application controls/
 * actions... through the application's own state model," and "do not
 * expose raw CC, Note, SysEx or device checks in application code."
 * Every assertion below reads `Control`/`Action` state only — a
 * `knob`/`button`/`pad` press is simulated through
 * `createMockSurfaceHarness()` (clearly test/MIDI-side tooling), never
 * inspected as MIDI on the application side.
 */
describe("surface -> application control (ECS-74)", () => {
  it("a knob turn updates a track volume Control, and a pad press updates a step Control, via the existing Control-mapping path", async () => {
    const device = createMockSurfaceDevice();
    const harness = createMockSurfaceHarness(device);

    const volumeDef: NumericControlDef = { id: "track.1.volume", label: "Volume", kind: "number", min: 0, max: 127, default: 0 };
    const stepDef: BooleanControlDef = { id: "pattern.1.step.1", label: "Step 1", kind: "boolean", default: false };
    const volume = createControl(volumeDef);
    const step = createControl(stepDef);
    const registry = createControlRegistry([volume, step]);
    const context = createSurfaceContext();

    const bindings: ControlBinding[] = [
      { physicalControlId: "knob-1", role: "track-fader", kind: "control", resolve: { kind: "static", controlId: "track.1.volume" } },
      { physicalControlId: "pad-1", role: "step", kind: "control", resolve: { kind: "static", controlId: "pattern.1.step.1" } },
    ];

    const teardown = await bindSurfaceMode(
      { mode: "mixer", bindings },
      {
        profile: device.profile,
        context,
        registry,
        ports: { inputs: { "main-in": createMidiInput(device.input) }, outputs: { "main-out": createMidiOutput(device.output) } },
        generate: generateControlMappings,
      },
    );

    harness.turnKnob("knob-1", 64);
    expect(volume.getValue()).toBe(64);

    harness.press("pad-1");
    expect(step.getValue()).toBe(true);

    harness.release("pad-1");
    expect(step.getValue()).toBe(false);

    await teardown();
    harness.turnKnob("knob-1", 10);
    expect(volume.getValue()).toBe(64); // unbound: no longer tracking input
  });

  it("button presses invoke play/stop/record Actions, updating transport status through the application's own state model", () => {
    const device = createMockSurfaceDevice();
    const harness = createMockSurfaceHarness(device);
    const input = createMidiInput(device.input);

    const statusDef: EnumControlDef = {
      id: "transport.status",
      label: "Status",
      kind: "enum",
      options: [
        { label: "Stopped", value: "stopped" },
        { label: "Playing", value: "playing" },
        { label: "Recording", value: "recording" },
      ],
      default: "stopped",
    };
    const status = createControl(statusDef);

    const play = createAction({ id: "transport.play", label: "Play" }, () => status.setValue("playing"));
    const stop = createAction({ id: "transport.stop", label: "Stop" }, () => status.setValue("stopped"));
    const record = createAction({ id: "transport.record", label: "Record" }, () => status.setValue("recording"));

    const buttonOne = device.profile.controls.find((control) => control.id === "button-1")!;
    const buttonTwo = device.profile.controls.find((control) => control.id === "button-2")!;
    const buttonThree = device.profile.controls.find((control) => control.id === "button-3")!;

    const unbindPlay = bindActionTrigger(input, toMidiSource(buttonOne)!, play);
    const unbindStop = bindActionTrigger(input, toMidiSource(buttonTwo)!, stop);
    const unbindRecord = bindActionTrigger(input, toMidiSource(buttonThree)!, record);

    harness.press("button-1");
    expect(status.getValue()).toBe("playing");

    harness.press("button-3");
    expect(status.getValue()).toBe("recording");

    harness.press("button-2");
    expect(status.getValue()).toBe("stopped");

    unbindPlay();
    unbindStop();
    unbindRecord();
  });

  it("releasing a button never invokes its Action -- only the press does", () => {
    const device = createMockSurfaceDevice();
    const harness = createMockSurfaceHarness(device);
    const input = createMidiInput(device.input);

    let invocations = 0;
    const action = createAction({ id: "transport.play", label: "Play" }, () => {
      invocations++;
    });

    const button = device.profile.controls.find((control) => control.id === "button-1")!;
    const unbind = bindActionTrigger(input, toMidiSource(button)!, action);

    harness.release("button-1");
    expect(invocations).toBe(0);

    harness.press("button-1");
    expect(invocations).toBe(1);

    unbind();
    harness.press("button-1");
    expect(invocations).toBe(1); // unbound: no further invocations
  });
});
