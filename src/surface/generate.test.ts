import { describe, expect, it } from "vitest";
import { createControl } from "../control-api/control.js";
import { createControlRegistry } from "../control-api/registry.js";
import { createSurfaceContext } from "../control-api/context.js";
import type { BooleanControlDef, NumericControlDef } from "../control-api/types/control.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import { createMockSurfaceDevice } from "../testing/mock-surface-device.js";
import { createMockSurfaceHarness } from "../testing/mock-surface-harness.js";
import type { PhysicalControl } from "../profile/types/control.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import { bindSurfaceMode } from "./bindings.js";
import { generateControlMappings } from "./generate.js";
import type { ControlBinding } from "./types/bindings.js";

const knob: PhysicalControl = {
  id: "knob-1",
  label: "Knob 1",
  kind: "knob",
  portId: "main-in",
  input: { address: { type: "control-change", controller: 11 }, channel: 0 },
};

const padWithFeedback: PhysicalControl = {
  id: "pad-1",
  label: "Pad 1",
  kind: "pad",
  portId: "main-in",
  input: { address: { type: "note", note: 37 }, channel: 0 },
  feedback: { kind: "velocity-color-led", address: { address: { type: "note", note: 37 }, channel: 0 } },
  feedbackPortId: "main-out",
};

const knobWithUnresolvedChannel: PhysicalControl = {
  id: "knob-unresolved",
  label: "Knob (unresolved channel)",
  kind: "knob",
  portId: "main-in",
  input: { address: { type: "control-change", controller: 20 } }, // no channel: unresolved
};

const padWithUnresolvedFeedbackChannel: PhysicalControl = {
  id: "pad-unresolved-feedback",
  label: "Pad (unresolved feedback channel)",
  kind: "pad",
  portId: "main-in",
  input: { address: { type: "note", note: 50 }, channel: 0 },
  feedback: { kind: "monochrome-led", address: { address: { type: "note", note: 50 } } }, // no channel: unresolved
  feedbackPortId: "main-out",
};

const programChangeButton: PhysicalControl = {
  id: "scene-button",
  label: "Scene Button",
  kind: "button",
  portId: "main-in",
  input: { address: { type: "program-change", program: 1 }, channel: 0 },
};

const feedbackOnlyIndicator: PhysicalControl = {
  id: "status-led",
  label: "Status LED",
  kind: "pad",
  portId: "main-in",
  feedback: { kind: "monochrome-led", address: { address: { type: "note", note: 60 }, channel: 0 } },
  feedbackPortId: "main-out",
};

function profileWith(controls: readonly PhysicalControl[]): DeviceProfile {
  return {
    schemaVersion: "1.0",
    identity: { id: "test.device", manufacturer: "Test", model: "Test Device" },
    ports: [
      { id: "main-in", type: "input", role: "main", required: true, messageTypes: [] },
      { id: "main-out", type: "output", role: "main", required: false, messageTypes: [] },
    ],
    controls,
  };
}

describe("generateControlMappings", () => {
  it("resolves a static ControlBinding into a ControlMapping with the control's declared MidiSource", () => {
    const profile = profileWith([knob]);
    const binding: ControlBinding = { physicalControlId: "knob-1", role: "generic", kind: "control", resolve: { kind: "static", controlId: "fx.1.cutoff" } };

    const [generated] = generateControlMappings(profile, [binding], createSurfaceContext());

    expect(generated).toEqual({
      mapping: { id: "knob-1", control: "fx.1.cutoff", source: { address: { type: "control-change", controller: 11 }, channel: 0 } },
      inputPortId: "main-in",
    });
  });

  it("resolves a from-selection ControlBinding using the current SurfaceContext selection", () => {
    const profile = profileWith([knob]);
    const binding: ControlBinding = {
      physicalControlId: "knob-1",
      role: "track-fader",
      kind: "control",
      resolve: { kind: "from-selection", scope: "track", template: "track.{id}.volume" },
    };
    const context = createSurfaceContext([{ scope: "track", id: "3" }]);

    const [generated] = generateControlMappings(profile, [binding], context);

    expect(generated?.mapping.control).toBe("track.3.volume");
  });

  it("produces no entry for a from-selection ControlBinding when nothing is currently selected", () => {
    const profile = profileWith([knob]);
    const binding: ControlBinding = {
      physicalControlId: "knob-1",
      role: "track-fader",
      kind: "control",
      resolve: { kind: "from-selection", scope: "track", template: "track.{id}.volume" },
    };

    expect(generateControlMappings(profile, [binding], createSurfaceContext())).toEqual([]);
  });

  it("produces no entry for a binding naming a physicalControlId not on the profile", () => {
    const profile = profileWith([knob]);
    const binding: ControlBinding = { physicalControlId: "nowhere", role: "generic", kind: "control", resolve: { kind: "static", controlId: "x" } };

    expect(generateControlMappings(profile, [binding], createSurfaceContext())).toEqual([]);
  });

  it("includes feedback, with its own port id, for a control whose declared feedback has a resolved channel", () => {
    const profile = profileWith([padWithFeedback]);
    const binding: ControlBinding = { physicalControlId: "pad-1", role: "step", kind: "control", resolve: { kind: "static", controlId: "pattern.1.step.1" } };

    const [generated] = generateControlMappings(profile, [binding], createSurfaceContext());

    expect(generated).toEqual({
      mapping: {
        id: "pad-1",
        control: "pattern.1.step.1",
        source: { address: { type: "note", note: 37 }, channel: 0 },
        feedback: { address: { type: "note", note: 37 }, channel: 0 },
      },
      inputPortId: "main-in",
      outputPortId: "main-out",
    });
  });

  it("defaults an unresolved input channel to MidiSource's 'any'", () => {
    const profile = profileWith([knobWithUnresolvedChannel]);
    const binding: ControlBinding = { physicalControlId: "knob-unresolved", role: "generic", kind: "control", resolve: { kind: "static", controlId: "x" } };

    const [generated] = generateControlMappings(profile, [binding], createSurfaceContext());

    expect(generated?.mapping.source.channel).toBe("any");
  });

  it("omits feedback (rather than inventing a channel) when the profile's feedback channel is unresolved", () => {
    const profile = profileWith([padWithUnresolvedFeedbackChannel]);
    const binding: ControlBinding = { physicalControlId: "pad-unresolved-feedback", role: "step", kind: "control", resolve: { kind: "static", controlId: "x" } };

    const [generated] = generateControlMappings(profile, [binding], createSurfaceContext());

    expect(generated?.mapping.feedback).toBeUndefined();
    expect(generated?.outputPortId).toBeUndefined();
  });

  it("produces no entry for a control addressed outside MidiAddress (program-change)", () => {
    const profile = profileWith([programChangeButton]);
    const binding: ControlBinding = { physicalControlId: "scene-button", role: "generic", kind: "control", resolve: { kind: "static", controlId: "x" } };

    expect(generateControlMappings(profile, [binding], createSurfaceContext())).toEqual([]);
  });

  it("produces no entry for a feedback-only control (no input at all)", () => {
    const profile = profileWith([feedbackOnlyIndicator]);
    const binding: ControlBinding = { physicalControlId: "status-led", role: "generic", kind: "control", resolve: { kind: "static", controlId: "x" } };

    expect(generateControlMappings(profile, [binding], createSurfaceContext())).toEqual([]);
  });

  it("processes several bindings independently, in order", () => {
    const profile = profileWith([knob, padWithFeedback]);
    const bindings: ControlBinding[] = [
      { physicalControlId: "knob-1", role: "generic", kind: "control", resolve: { kind: "static", controlId: "a" } },
      { physicalControlId: "pad-1", role: "generic", kind: "control", resolve: { kind: "static", controlId: "b" } },
    ];

    const generated = generateControlMappings(profile, bindings, createSurfaceContext());

    expect(generated.map((g) => g.mapping.control)).toEqual(["a", "b"]);
  });
});

describe("generateControlMappings — integration with bindSurfaceMode and the generic mock surface device", () => {
  it("round-trips a knob to a track volume Control, and a pad press/feedback to a step Control, through real mock I/O", async () => {
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

    step.setValue(false);
    expect(harness.lastFeedbackFor("pad-1")).toMatchObject({ type: "note-off" });

    await teardown();
    harness.turnKnob("knob-1", 10);
    expect(volume.getValue()).toBe(64); // unbound: no longer tracking input
  });
});
