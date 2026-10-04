import { describe, expect, it } from "vitest";
import { createControl } from "../control-api/control.js";
import { createControlRegistry } from "../control-api/registry.js";
import { createSurfaceContext } from "../control-api/context.js";
import { createSurfaceEventSource } from "../control-api/event.js";
import type { BooleanControlDef, EnumControlDef, NumericControlDef } from "../control-api/types/control.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import { createMockSurfaceDevice } from "../testing/mock-surface-device.js";
import { createMockSurfaceHarness } from "../testing/mock-surface-harness.js";
import { bindSurfaceMode } from "./bindings.js";
import { bindEventFeedback } from "./event-feedback.js";
import { generateControlMappings, toMidiTarget } from "./generate.js";
import type { ControlBinding } from "./types/bindings.js";

/**
 * ECS-73: "demonstrate independent UI/application changes reaching
 * physical feedback, including track volume, transport, active steps
 * and playhead" — and "the UI must not mediate updates." Every `Control`
 * here is changed by calling `setValue()` directly, the same way a UI
 * reading/writing that same `Control` would — never through the mock
 * device's input side — proving feedback reaches hardware because
 * `bindControlMapping()` subscribes to `onChange()` directly, not
 * because this test routes through any UI-owned relay.
 *
 * Any feedback-capable `PhysicalControl` may be assigned any application
 * role; a profile reserves nothing (`docs/control-surface-architecture.md`:
 * "Control Surface is where a physical control is first assigned
 * application meaning — never earlier"). `knob-2` standing in for a
 * transport-status indicator is exactly that: a binding-table choice,
 * not a fact about the device.
 */
describe("application -> surface feedback (ECS-73)", () => {
  it("track volume, transport status and active-step Control changes each reach physical feedback", async () => {
    const device = createMockSurfaceDevice();
    const harness = createMockSurfaceHarness(device);

    const volumeDef: NumericControlDef = { id: "track.1.volume", label: "Volume", kind: "number", min: 0, max: 127, default: 0 };
    const statusDef: EnumControlDef = {
      id: "transport.status",
      label: "Status",
      kind: "enum",
      options: [
        { label: "Stopped", value: "stopped" },
        { label: "Playing", value: "playing" },
      ],
      default: "stopped",
    };
    const stepDef: BooleanControlDef = { id: "pattern.1.step.1", label: "Step 1", kind: "boolean", default: false };

    const volume = createControl(volumeDef);
    const status = createControl(statusDef);
    const step = createControl(stepDef);
    const registry = createControlRegistry([volume, status, step]);
    const context = createSurfaceContext();

    const bindings: ControlBinding[] = [
      { physicalControlId: "knob-1", role: "track-fader", kind: "control", resolve: { kind: "static", controlId: "track.1.volume" } },
      { physicalControlId: "knob-2", role: "transport-status-indicator", kind: "control", resolve: { kind: "static", controlId: "transport.status" } },
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

    // Direct setValue() calls -- this is "the application"/"the UI" changing state,
    // never the mock device's input side.
    volume.setValue(100);
    expect(harness.lastFeedbackFor("knob-1")).toMatchObject({ type: "control-change", controller: 11, channel: 0, value: 100 });

    status.setValue("playing");
    expect(harness.lastFeedbackFor("knob-2")).toMatchObject({ type: "control-change", controller: 12, channel: 0 });

    step.setValue(true);
    expect(harness.lastFeedbackFor("pad-1")).toMatchObject({ type: "note-on", note: 37 });

    step.setValue(false);
    expect(harness.lastFeedbackFor("pad-1")).toMatchObject({ type: "note-off", note: 37 });

    await teardown();

    const feedbackCountBeforeTeardownCheck = harness.decodedFeedback().length;
    volume.setValue(50);
    expect(harness.decodedFeedback().length).toBe(feedbackCountBeforeTeardownCheck); // unbound: no longer sending feedback
  });

  it("playhead ticks (a SurfaceEvent, not a Control) reach physical feedback via bindEventFeedback", () => {
    const device = createMockSurfaceDevice();
    const harness = createMockSurfaceHarness(device);
    const output = createMidiOutput(device.output);
    const playhead = createSurfaceEventSource();

    const litPad = device.profile.controls.find((control) => control.id === "pad-4")!;
    const target = toMidiTarget(litPad)!;
    if (target.address.type !== "note") throw new Error("expected a note-addressed feedback target");
    const note = target.address.note;

    const unbind = bindEventFeedback(
      playhead,
      (event) => {
        if (event.id !== "transport.tick") return undefined;
        const { step } = event.payload as { step: number };
        return step === 4 ? { type: "note-on", channel: target.channel, note, velocity: 127 } : undefined;
      },
      output,
    );

    playhead.emit({ id: "transport.tick", payload: { step: 1 } });
    expect(harness.lastFeedbackFor("pad-4")).toBeUndefined();

    playhead.emit({ id: "transport.tick", payload: { step: 4 } });
    expect(harness.lastFeedbackFor("pad-4")).toMatchObject({ type: "note-on", note: 40, velocity: 127 });

    unbind();
    const countBeforeUnboundTick = harness.decodedFeedback().length;
    playhead.emit({ id: "transport.tick", payload: { step: 4 } });
    expect(harness.decodedFeedback().length).toBe(countBeforeUnboundTick); // unbound: no further feedback sent
  });
});
