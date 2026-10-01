import { describe, expect, it } from "vitest";
import { MockMidiInput } from "../adapters/mock/mock-input.js";
import { MockMidiOutput } from "../adapters/mock/mock-output.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import type { BooleanControlDef, Control, ControlDef, ControlValue, NumericControlDef } from "../control-api/types/control.js";
import type { ControlMapping } from "./types/mapping.js";
import { bindControlMapping } from "./bind.js";

/**
 * A minimal, generic in-memory Control -- exactly the test double ECS-34/35
 * explicitly left out of the Control API contract. Local to this test file:
 * proving the mapping runtime works needs *some* concrete Control, but
 * supplying one is this ticket's concern, not the Control API's.
 */
function createTestControl<D extends ControlDef>(def: D): Control<D> {
  let value = def.default as ControlValue<D>;
  const listeners = new Set<(value: ControlValue<D>, previous: ControlValue<D>) => void>();

  return {
    def,
    getValue: () => value,
    setValue: (next) => {
      const previous = value;
      value = next;
      for (const listener of listeners) listener(value, previous);
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const cutoff: NumericControlDef = {
  id: "fx.filter.cutoff",
  label: "Cutoff",
  kind: "number",
  min: 40,
  max: 18000,
  step: 1,
  unit: "Hz",
  default: 40,
};

const muted: BooleanControlDef = {
  id: "track.1.muted",
  label: "Mute",
  kind: "boolean",
  default: false,
};

function wiredPorts() {
  const rawInput = new MockMidiInput({ id: "in-1", type: "input", name: "Mock In", manufacturer: null });
  const rawOutput = new MockMidiOutput({ id: "out-1", type: "output", name: "Mock Out", manufacturer: null });
  return { rawInput, rawOutput, input: createMidiInput(rawInput), output: createMidiOutput(rawOutput) };
}

describe("bindControlMapping — MIDI -> Control", () => {
  it("pushes a resolved CC value into the control", () => {
    const { rawInput, input, output } = wiredPorts();
    const control = createTestControl(cutoff);
    const mapping: ControlMapping = {
      id: "cc74-cutoff",
      control: cutoff.id,
      source: { address: { type: "control-change", controller: 74 }, channel: "any" },
    };

    bindControlMapping(mapping, input, output, control);
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, 127)); // CC 74, channel 0, value 127

    expect(control.getValue()).toBe(18000);
  });

  it("ignores a message that doesn't match the mapping's source", () => {
    const { rawInput, input, output } = wiredPorts();
    const control = createTestControl(cutoff);
    const mapping: ControlMapping = {
      id: "cc74-cutoff",
      control: cutoff.id,
      source: { address: { type: "control-change", controller: 74 }, channel: "any" },
    };

    bindControlMapping(mapping, input, output, control);
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 75, 127)); // different controller

    expect(control.getValue()).toBe(cutoff.default);
  });

  it("stops updating the control once unbound", () => {
    const { rawInput, input, output } = wiredPorts();
    const control = createTestControl(cutoff);
    const mapping: ControlMapping = {
      id: "cc74-cutoff",
      control: cutoff.id,
      source: { address: { type: "control-change", controller: 74 }, channel: "any" },
    };

    const unbind = bindControlMapping(mapping, input, output, control);
    unbind();
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, 127));

    expect(control.getValue()).toBe(cutoff.default);
  });
});

describe("bindControlMapping — Control -> MIDI (feedback)", () => {
  it("sends feedback when the control changes", () => {
    const { input, output, rawOutput } = wiredPorts();
    const control = createTestControl(cutoff);
    const mapping: ControlMapping = {
      id: "cc74-cutoff",
      control: cutoff.id,
      source: { address: { type: "control-change", controller: 74 }, channel: "any" },
      feedback: { address: { type: "control-change", controller: 20 }, channel: 0 },
    };

    bindControlMapping(mapping, input, output, control);
    control.setValue(18000);

    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 20, 127]);
  });

  it("sends nothing for a mapping with no feedback target", () => {
    const { input, output, rawOutput } = wiredPorts();
    const control = createTestControl(cutoff);
    const mapping: ControlMapping = {
      id: "cc74-cutoff",
      control: cutoff.id,
      source: { address: { type: "control-change", controller: 74 }, channel: "any" },
    };

    bindControlMapping(mapping, input, output, control);
    control.setValue(18000);

    expect(rawOutput.sentMessages).toHaveLength(0);
  });

  it("stops sending feedback once unbound", () => {
    const { input, output, rawOutput } = wiredPorts();
    const control = createTestControl(muted);
    const mapping: ControlMapping = {
      id: "note36-mute",
      control: muted.id,
      source: { address: { type: "note", note: 36 }, channel: "any" },
      feedback: { address: { type: "note", note: 36 }, channel: 0 },
    };

    const unbind = bindControlMapping(mapping, input, output, control);
    unbind();
    control.setValue(true);

    expect(rawOutput.sentMessages).toHaveLength(0);
  });
});

describe("bindControlMapping — round trip", () => {
  it("proves a Launchpad-style pad press updates a control, which lights feedback back out", () => {
    const { rawInput, input, output, rawOutput } = wiredPorts();
    const control = createTestControl(muted);
    const mapping: ControlMapping = {
      id: "note36-mute",
      control: muted.id,
      source: { address: { type: "note", note: 36 }, channel: "any" },
      feedback: { address: { type: "note", note: 36 }, channel: 0 },
    };

    bindControlMapping(mapping, input, output, control);
    rawInput.emitRawMessage(Uint8Array.of(0x90, 36, 127)); // Note On, channel 0

    expect(control.getValue()).toBe(true);
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0x90, 36, 127]); // note-on feedback
  });
});
