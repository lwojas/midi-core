import { describe, expect, it, vi } from "vitest";
import { MockMidiInput } from "../adapters/mock/mock-input.js";
import { MockMidiOutput } from "../adapters/mock/mock-output.js";
import type { SurfaceContext } from "../control-api/types/context.js";
import type { BooleanControlDef, Control, ControlDef, ControlValue, NumericControlDef, StringControlDef } from "../control-api/types/control.js";
import type { ControlRegistry } from "../control-api/types/registry.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import type { PhysicalControl } from "../profile/types/control.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import { bindActiveMode, bindSurfaceMode, type BindSurfaceModeDeps } from "./bindings.js";
import { createSurfaceNavigation } from "./navigation.js";
import type { DisplayBinding, ModeBinding, ModeIndicatorBinding, SurfaceModeDefinition } from "./types/bindings.js";
import type { GenerateControlMappings } from "./types/generation.js";

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

function createFakeRegistry(controls: Record<string, Control<any>>): ControlRegistry {
  return {
    listControls: () => Object.values(controls),
    getControl: (id) => controls[id],
    onChange: () => () => {},
  };
}

function createFakeContext(): SurfaceContext {
  return { listSelections: () => [], getSelection: () => undefined, onChange: () => () => {} };
}

const profile: DeviceProfile = {
  schemaVersion: "1.0",
  identity: { id: "mock.device", manufacturer: "Mock", model: "Mock Device" },
  ports: [],
  controls: [],
};

const cutoff: NumericControlDef = { id: "fx.1.cutoff", label: "Cutoff", kind: "number", min: 0, max: 127, default: 0 };
const muted: BooleanControlDef = { id: "track.1.muted", label: "Mute", kind: "boolean", default: false };

function wiredPorts() {
  const rawInput = new MockMidiInput({ id: "in-1", type: "input", name: "Mock In", manufacturer: null });
  const rawOutput = new MockMidiOutput({ id: "out-1", type: "output", name: "Mock Out", manufacturer: null });
  return { rawInput, rawOutput, input: createMidiInput(rawInput), output: createMidiOutput(rawOutput) };
}

const navBinding: ModeBinding = {
  physicalControlId: "next-btn",
  role: "next-page",
  kind: "navigate",
  navigate: { kind: "page", gridId: "pads", direction: { row: 0, column: 1 } },
};

const controlBinding: ModeBinding = {
  physicalControlId: "knob-1",
  role: "track-fader",
  kind: "control",
  resolve: { kind: "static", controlId: cutoff.id },
};

describe("bindSurfaceMode", () => {
  it("binds the generated ControlMapping and lets MIDI drive the control, filtering out navigate bindings before calling generate", async () => {
    const { rawInput, input, output } = wiredPorts();
    const control = createTestControl(cutoff);
    const generate = vi.fn<GenerateControlMappings>((_profile, bindings) => [
      {
        mapping: { id: "m1", control: cutoff.id, source: { address: { type: "control-change", controller: 74 }, channel: "any" } },
        inputPortId: "in-1",
      },
    ]);

    const deps: BindSurfaceModeDeps = {
      profile,
      context: createFakeContext(),
      registry: createFakeRegistry({ [cutoff.id]: control }),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate,
    };

    const mode: SurfaceModeDefinition = { mode: "mixer", bindings: [controlBinding, navBinding] };
    const teardown = await bindSurfaceMode(mode, deps);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]![1]).toEqual([controlBinding]);

    rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, 127));
    expect(control.getValue()).toBe(127);

    await teardown();
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, 0));
    expect(control.getValue()).toBe(127); // unbound: no longer driven
  });

  it("runs hooks.onEnter before binding and hooks.onExit after unbinding", async () => {
    const order: string[] = [];
    const { input, output } = wiredPorts();
    const generate: GenerateControlMappings = () => [];
    const deps: BindSurfaceModeDeps = {
      profile,
      context: createFakeContext(),
      registry: createFakeRegistry({}),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate,
    };
    const mode: SurfaceModeDefinition = {
      mode: "mixer",
      bindings: [],
      hooks: {
        onEnter: () => {
          order.push("enter");
        },
        onExit: () => {
          order.push("exit");
        },
      },
    };

    const teardown = await bindSurfaceMode(mode, deps);
    expect(order).toEqual(["enter"]);
    await teardown();
    expect(order).toEqual(["enter", "exit"]);
  });

  it("uses hooks.resolveBindings instead of bindings when present", async () => {
    const { input, output } = wiredPorts();
    const generate = vi.fn<GenerateControlMappings>(() => []);
    const deps: BindSurfaceModeDeps = {
      profile,
      context: createFakeContext(),
      registry: createFakeRegistry({}),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate,
    };
    const mode: SurfaceModeDefinition = {
      mode: "mixer",
      bindings: [controlBinding],
      hooks: { resolveBindings: () => [] },
    };

    await bindSurfaceMode(mode, deps);
    expect(generate).toHaveBeenCalledWith(profile, [], deps.context);
  });

  it("skips a generated binding whose ControlId isn't in the registry", async () => {
    const { rawInput, input, output } = wiredPorts();
    const generate: GenerateControlMappings = () => [
      {
        mapping: { id: "m1", control: "nowhere.volume", source: { address: { type: "control-change", controller: 74 }, channel: "any" } },
        inputPortId: "in-1",
      },
    ];
    const deps: BindSurfaceModeDeps = {
      profile,
      context: createFakeContext(),
      registry: createFakeRegistry({}),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate,
    };

    const teardown = await bindSurfaceMode({ mode: "mixer", bindings: [controlBinding] }, deps);
    expect(() => rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, 127))).not.toThrow();
    await expect(teardown()).resolves.toBeUndefined();
  });

  it("skips a generated binding whose input port was never resolved", async () => {
    const { output } = wiredPorts();
    const control = createTestControl(cutoff);
    const generate: GenerateControlMappings = () => [
      {
        mapping: { id: "m1", control: cutoff.id, source: { address: { type: "control-change", controller: 74 }, channel: "any" } },
        inputPortId: "missing-port",
      },
    ];
    const deps: BindSurfaceModeDeps = {
      profile,
      context: createFakeContext(),
      registry: createFakeRegistry({ [cutoff.id]: control }),
      ports: { inputs: {}, outputs: { "out-1": output } },
      generate,
    };

    await expect(bindSurfaceMode({ mode: "mixer", bindings: [controlBinding] }, deps)).resolves.toBeInstanceOf(Function);
    expect(control.getValue()).toBe(cutoff.default);
  });

  it("skips a mapping with feedback when no output port resolves, rather than binding input-only", async () => {
    const { rawInput, input } = wiredPorts();
    const control = createTestControl(muted);
    const generate: GenerateControlMappings = () => [
      {
        mapping: {
          id: "m1",
          control: muted.id,
          source: { address: { type: "note", note: 36 }, channel: "any" },
          feedback: { address: { type: "note", note: 36 }, channel: 0 },
        },
        inputPortId: "in-1",
        outputPortId: "missing-out",
      },
    ];
    const deps: BindSurfaceModeDeps = {
      profile,
      context: createFakeContext(),
      registry: createFakeRegistry({ [muted.id]: control }),
      ports: { inputs: { "in-1": input }, outputs: {} },
      generate,
    };

    await bindSurfaceMode({ mode: "mixer", bindings: [controlBinding] }, deps);
    rawInput.emitRawMessage(Uint8Array.of(0x90, 36, 127));
    expect(control.getValue()).toBe(false); // never bound at all
  });

  it("binds feedback through the resolved output port", async () => {
    const { input, output, rawOutput } = wiredPorts();
    const control = createTestControl(muted);
    const generate: GenerateControlMappings = () => [
      {
        mapping: {
          id: "m1",
          control: muted.id,
          source: { address: { type: "note", note: 36 }, channel: "any" },
          feedback: { address: { type: "note", note: 36 }, channel: 0 },
        },
        inputPortId: "in-1",
        outputPortId: "out-1",
      },
    ];
    const deps: BindSurfaceModeDeps = {
      profile,
      context: createFakeContext(),
      registry: createFakeRegistry({ [muted.id]: control }),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate,
    };

    await bindSurfaceMode({ mode: "mixer", bindings: [controlBinding] }, deps);
    control.setValue(true);

    // Binding paints the current value first (off), then the change goes out.
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0x80, 36, 0]);
    expect(Array.from(rawOutput.sentMessages[1]!)).toEqual([0x90, 36, 127]);
  });

  it("returns a no-op teardown when there is no mode definition", async () => {
    const { input, output } = wiredPorts();
    const generate = vi.fn<GenerateControlMappings>(() => []);
    const deps: BindSurfaceModeDeps = {
      profile,
      context: createFakeContext(),
      registry: createFakeRegistry({}),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate,
    };

    const teardown = await bindSurfaceMode(undefined, deps);
    await expect(teardown()).resolves.toBeUndefined();
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("bindActiveMode", () => {
  it("installs the SurfaceModeDefinition matching the navigation's current mode", async () => {
    const { input, output } = wiredPorts();
    const generate = vi.fn<GenerateControlMappings>(() => []);
    const deps: BindSurfaceModeDeps = {
      profile,
      context: createFakeContext(),
      registry: createFakeRegistry({}),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate,
    };
    const navigation = createSurfaceNavigation({ mode: "transport" });
    const table = [
      { mode: "mixer", bindings: [controlBinding] },
      { mode: "transport", bindings: [] },
    ];

    await bindActiveMode(table, navigation, deps);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(profile, [], deps.context);
  });

  it("binds nothing when no table entry matches the current mode", async () => {
    const { input, output } = wiredPorts();
    const generate = vi.fn<GenerateControlMappings>(() => []);
    const deps: BindSurfaceModeDeps = {
      profile,
      context: createFakeContext(),
      registry: createFakeRegistry({}),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate,
    };
    const navigation = createSurfaceNavigation({ mode: "parameter-control" });

    const teardown = await bindActiveMode([{ mode: "mixer", bindings: [] }], navigation, deps);

    expect(generate).not.toHaveBeenCalled();
    await expect(teardown()).resolves.toBeUndefined();
  });
});

describe("bindSurfaceMode — modifier-conditional bindings (ECS-137)", () => {
  const shiftButton: PhysicalControl = {
    id: "shift",
    label: "Shift",
    kind: "button",
    portId: "in-1",
    input: { address: { type: "control-change", controller: 49 }, channel: 0 },
  };

  const heldTarget: NumericControlDef = { id: "held.value", label: "Held target", kind: "number", min: 0, max: 127, default: 0 };
  const releasedTarget: NumericControlDef = { id: "released.value", label: "Released target", kind: "number", min: 0, max: 127, default: 0 };

  function profileWithModifier(): DeviceProfile {
    return { ...profile, controls: [shiftButton], layout: { modifier: "shift" } };
  }

  it("dispatches to the modifier-held binding while held, and the modifier-released binding otherwise", async () => {
    const { rawInput, input, output } = wiredPorts();
    const held = createTestControl(heldTarget);
    const released = createTestControl(releasedTarget);
    const generate = vi.fn<GenerateControlMappings>(() => [
      {
        mapping: { id: "shared-held", control: heldTarget.id, source: { address: { type: "control-change", controller: 71 }, channel: "any" } },
        inputPortId: "in-1",
        when: "modifier-held",
      },
      {
        mapping: { id: "shared-released", control: releasedTarget.id, source: { address: { type: "control-change", controller: 71 }, channel: "any" } },
        inputPortId: "in-1",
        when: "modifier-released",
      },
    ]);
    const deps: BindSurfaceModeDeps = {
      profile: profileWithModifier(),
      context: createFakeContext(),
      registry: createFakeRegistry({ [heldTarget.id]: held, [releasedTarget.id]: released }),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate,
    };

    await bindSurfaceMode({ mode: "mixer", bindings: [] }, deps);

    // Modifier released (the default, unpressed state): only the released-target binding applies.
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 71, 100));
    expect(released.getValue()).toBe(100);
    expect(held.getValue()).toBe(0);

    // Shift pressed (CC 49 full value): the held-target binding now applies instead.
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 49, 127));
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 71, 50));
    expect(held.getValue()).toBe(50);
    expect(released.getValue()).toBe(100); // unchanged while the modifier is held

    // Shift released again: back to the released-target binding.
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 49, 0));
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 71, 20));
    expect(released.getValue()).toBe(20);
    expect(held.getValue()).toBe(50); // unchanged once the modifier is released again
  });

  it("never satisfies a conditional binding when the profile declares no layout.modifier", async () => {
    const { rawInput, input, output } = wiredPorts();
    const held = createTestControl(heldTarget);
    const generate = vi.fn<GenerateControlMappings>(() => [
      {
        mapping: { id: "shared-held", control: heldTarget.id, source: { address: { type: "control-change", controller: 71 }, channel: "any" } },
        inputPortId: "in-1",
        when: "modifier-held",
      },
    ]);
    const deps: BindSurfaceModeDeps = {
      profile, // no layout at all
      context: createFakeContext(),
      registry: createFakeRegistry({ [heldTarget.id]: held }),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate,
    };

    await bindSurfaceMode({ mode: "mixer", bindings: [] }, deps);
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 71, 100));

    expect(held.getValue()).toBe(0); // "modifier-held" is never satisfied with no modifier declared
  });

  it("regression: a mapping with no `when` is applied unconditionally, even on a profile that declares a modifier", async () => {
    const { rawInput, input, output } = wiredPorts();
    const control = createTestControl(cutoff);
    const generate = vi.fn<GenerateControlMappings>(() => [
      {
        mapping: { id: "m1", control: cutoff.id, source: { address: { type: "control-change", controller: 74 }, channel: "any" } },
        inputPortId: "in-1",
      },
    ]);
    const deps: BindSurfaceModeDeps = {
      profile: profileWithModifier(),
      context: createFakeContext(),
      registry: createFakeRegistry({ [cutoff.id]: control }),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate,
    };

    await bindSurfaceMode({ mode: "mixer", bindings: [controlBinding] }, deps);
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, 127)); // modifier never touched -- shift stays "released"

    expect(control.getValue()).toBe(127);
  });
});

describe("bindSurfaceMode — display binding (ECS-137)", () => {
  const patternName: StringControlDef = { id: "sequencer.pattern-name", label: "Pattern name", kind: "string", default: "" };

  function profileWithDisplay(): DeviceProfile {
    return {
      ...profile,
      displays: [
        {
          id: "lcd",
          label: "LCD",
          portId: "out-1",
          prefix: [0xf0, 0x47, 0x7f, 0x15],
          textPrefix: [0x00, 0x45, 0x00],
          charCount: 4,
          lines: [{ id: "line-1", label: "Line 1", lineId: 0x18 }],
        },
      ],
    };
  }

  const displayBinding: DisplayBinding = {
    kind: "display",
    displayId: "lcd",
    lineId: "line-1",
    resolve: { kind: "static", controlId: patternName.id },
  };

  it("paints the control's current value on bind, and repaints on every change", async () => {
    const { input, output, rawOutput } = wiredPorts();
    const control = createTestControl({ ...patternName, default: "Hi" });
    const generate = vi.fn<GenerateControlMappings>(() => []);
    const deps: BindSurfaceModeDeps = {
      profile: profileWithDisplay(),
      context: createFakeContext(),
      registry: createFakeRegistry({ [patternName.id]: control }),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate,
    };

    await bindSurfaceMode({ mode: "mixer", bindings: [displayBinding] }, deps);
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xf0, 0x47, 0x7f, 0x15, 0x18, 0x00, 0x45, 0x00, 72, 105, 0x20, 0x20, 0xf7]); // "Hi  "

    control.setValue("Yo!!");
    expect(Array.from(rawOutput.sentMessages[1]!)).toEqual([0xf0, 0x47, 0x7f, 0x15, 0x18, 0x00, 0x45, 0x00, 89, 111, 33, 33, 0xf7]);
  });

  it("stops repainting once unbound, and sends nothing for an unresolvable display/line/port", async () => {
    const { input, output, rawOutput } = wiredPorts();
    const control = createTestControl(patternName);
    const generate = vi.fn<GenerateControlMappings>(() => []);
    const deps: BindSurfaceModeDeps = {
      profile: profileWithDisplay(),
      context: createFakeContext(),
      registry: createFakeRegistry({ [patternName.id]: control }),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate,
    };

    const teardown = await bindSurfaceMode({ mode: "mixer", bindings: [displayBinding] }, deps);
    rawOutput.clearSentMessages();
    await teardown();
    control.setValue("gone");
    expect(rawOutput.sentMessages).toHaveLength(0);
  });
});

describe("bindSurfaceMode — mode indicator binding (ECS-138)", () => {
  const noteButton: PhysicalControl = {
    id: "button-note",
    label: "Note",
    kind: "button",
    portId: "in-1",
    input: { address: { type: "control-change", controller: 50 }, channel: 0 },
    feedback: { kind: "monochrome-led", address: { address: { type: "control-change", controller: 50 }, channel: 0 } },
    feedbackPortId: "out-1",
  };

  const modeIndicator: ModeIndicatorBinding = { kind: "mode-indicator", physicalControlId: "button-note", role: "mode indicator: steps", mode: "steps" };

  it("paints lit when the mode it names is the surface's current mode", async () => {
    const { input, output, rawOutput } = wiredPorts();
    const generate = vi.fn<GenerateControlMappings>(() => []);
    const deps: BindSurfaceModeDeps = {
      profile: { ...profile, controls: [noteButton] },
      context: createFakeContext(),
      registry: createFakeRegistry({}),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate,
      navigation: createSurfaceNavigation({ mode: "steps" }),
    };

    await bindSurfaceMode({ mode: "steps", bindings: [modeIndicator] }, deps);
    expect(rawOutput.sentMessages).toHaveLength(1);
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 50, 127]);
  });

  it("paints dark when the mode it names is not the surface's current mode, and clears on unbind", async () => {
    const { input, output, rawOutput } = wiredPorts();
    const generate = vi.fn<GenerateControlMappings>(() => []);
    const deps: BindSurfaceModeDeps = {
      profile: { ...profile, controls: [noteButton] },
      context: createFakeContext(),
      registry: createFakeRegistry({}),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate,
      navigation: createSurfaceNavigation({ mode: "mixer" }),
    };

    const teardown = await bindSurfaceMode({ mode: "mixer", bindings: [modeIndicator] }, deps);
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 50, 0]);

    rawOutput.clearSentMessages();
    await teardown();
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 50, 0]);
  });

  it("sends nothing without a navigation dependency, or for an unresolvable control/port", async () => {
    const { input, output, rawOutput } = wiredPorts();
    const generate = vi.fn<GenerateControlMappings>(() => []);
    const deps: BindSurfaceModeDeps = {
      profile: { ...profile, controls: [noteButton] },
      context: createFakeContext(),
      registry: createFakeRegistry({}),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate,
      // no navigation
    };

    await bindSurfaceMode({ mode: "steps", bindings: [modeIndicator] }, deps);
    expect(rawOutput.sentMessages).toHaveLength(0);
  });
});

describe("bindSurfaceMode — dim/full two-tier feedback (ECS-145)", () => {
  const muteButton: PhysicalControl = {
    id: "button-mute-1",
    label: "Mute 1",
    kind: "button",
    portId: "in-1",
    input: { address: { type: "control-change", controller: 102 }, channel: 0 },
    feedback: { kind: "monochrome-led", address: { address: { type: "control-change", controller: 102 }, channel: 0 }, dimValue: 1 },
    feedbackPortId: "out-1",
  };

  const toggleBinding: ModeBinding = {
    kind: "control",
    physicalControlId: "button-mute-1",
    role: "mute",
    press: "toggle",
    resolve: { kind: "static", controlId: muted.id },
  };

  it("paints dim, not fully off, on bind, while the bound control is false", async () => {
    const { input, output, rawOutput } = wiredPorts();
    const control = createTestControl(muted);
    const deps: BindSurfaceModeDeps = {
      profile: { ...profile, controls: [muteButton] },
      context: createFakeContext(),
      registry: createFakeRegistry({ [muted.id]: control }),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate: () => [],
    };

    await bindSurfaceMode({ mode: "mixer", bindings: [toggleBinding] }, deps);
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 102, 1]);
  });

  it("goes to full brightness when the bound control becomes true, and back to dim (not off) when it's false again", async () => {
    const { rawInput, input, output, rawOutput } = wiredPorts();
    const control = createTestControl(muted);
    const deps: BindSurfaceModeDeps = {
      profile: { ...profile, controls: [muteButton] },
      context: createFakeContext(),
      registry: createFakeRegistry({ [muted.id]: control }),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate: () => [],
    };

    await bindSurfaceMode({ mode: "mixer", bindings: [toggleBinding] }, deps);
    rawOutput.clearSentMessages();

    rawInput.emitRawMessage(Uint8Array.of(0xb0, 102, 127)); // press toggles the control true
    expect(control.getValue()).toBe(true);
    expect(Array.from(rawOutput.sentMessages[rawOutput.sentMessages.length - 1]!)).toEqual([0xb0, 102, 127]);

    rawInput.emitRawMessage(Uint8Array.of(0xb0, 102, 127)); // press again toggles back false
    expect(control.getValue()).toBe(false);
    expect(Array.from(rawOutput.sentMessages[rawOutput.sentMessages.length - 1]!)).toEqual([0xb0, 102, 1]); // dim, not off
  });

  it("goes fully off (not dim) on unbind, even though this control's rest state renders dim while bound", async () => {
    const { input, output, rawOutput } = wiredPorts();
    const control = createTestControl(muted);
    const deps: BindSurfaceModeDeps = {
      profile: { ...profile, controls: [muteButton] },
      context: createFakeContext(),
      registry: createFakeRegistry({ [muted.id]: control }),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate: () => [],
    };

    const teardown = await bindSurfaceMode({ mode: "mixer", bindings: [toggleBinding] }, deps);
    rawOutput.clearSentMessages();
    await teardown();
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 102, 0]);
  });

  it("a control with no dimValue declared keeps today's plain on/off behavior, unchanged", async () => {
    const { rawInput, input, output, rawOutput } = wiredPorts();
    const plainButton: PhysicalControl = { ...muteButton, feedback: { kind: "monochrome-led", address: muteButton.feedback!.address } };
    const control = createTestControl(muted);
    const deps: BindSurfaceModeDeps = {
      profile: { ...profile, controls: [plainButton] },
      context: createFakeContext(),
      registry: createFakeRegistry({ [muted.id]: control }),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate: () => [],
    };

    await bindSurfaceMode({ mode: "mixer", bindings: [toggleBinding] }, deps);
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 102, 0]); // rests fully off, not dim

    rawOutput.clearSentMessages();
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 102, 127));
    expect(Array.from(rawOutput.sentMessages[rawOutput.sentMessages.length - 1]!)).toEqual([0xb0, 102, 127]);
  });
});

describe("bindSurfaceMode — modifier LED feedback (ECS-145)", () => {
  const shiftButton: PhysicalControl = {
    id: "button-shift",
    label: "Shift",
    kind: "button",
    portId: "in-1",
    input: { address: { type: "control-change", controller: 49 }, channel: 0 },
    feedback: { kind: "monochrome-led", address: { address: { type: "control-change", controller: 49 }, channel: 0 }, dimValue: 1 },
    feedbackPortId: "out-1",
  };

  function profileWithModifierFeedback(): DeviceProfile {
    return { ...profile, controls: [shiftButton], layout: { modifier: "button-shift" } };
  }

  it("rests dim on bind, goes full while held, back to dim on release, and off on unbind", async () => {
    const { rawInput, input, output, rawOutput } = wiredPorts();
    const deps: BindSurfaceModeDeps = {
      profile: profileWithModifierFeedback(),
      context: createFakeContext(),
      registry: createFakeRegistry({}),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate: () => [],
    };

    const teardown = await bindSurfaceMode({ mode: "mixer", bindings: [] }, deps);
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 49, 1]);
    rawOutput.clearSentMessages();

    rawInput.emitRawMessage(Uint8Array.of(0xb0, 49, 127));
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 49, 127]);
    rawOutput.clearSentMessages();

    rawInput.emitRawMessage(Uint8Array.of(0xb0, 49, 0));
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 49, 1]);
    rawOutput.clearSentMessages();

    await teardown();
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 49, 0]);
  });

  it("tracks held/released for `when` dispatch exactly as before, when the modifier control declares no feedback", async () => {
    const noFeedbackShift: PhysicalControl = { id: "button-shift", label: "Shift", kind: "button", portId: "in-1", input: shiftButton.input };
    const { rawInput, input, output, rawOutput } = wiredPorts();
    const heldTarget: NumericControlDef = { id: "held.value", label: "Held", kind: "number", min: 0, max: 127, default: 0 };
    const held = createTestControl(heldTarget);
    const generate = vi.fn<GenerateControlMappings>(() => [
      {
        mapping: { id: "shared-held", control: heldTarget.id, source: { address: { type: "control-change", controller: 71 }, channel: "any" } },
        inputPortId: "in-1",
        when: "modifier-held",
      },
    ]);
    const deps: BindSurfaceModeDeps = {
      profile: { ...profile, controls: [noFeedbackShift], layout: { modifier: "button-shift" } },
      context: createFakeContext(),
      registry: createFakeRegistry({ [heldTarget.id]: held }),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate,
    };

    await bindSurfaceMode({ mode: "mixer", bindings: [] }, deps);
    expect(rawOutput.sentMessages).toHaveLength(0); // no feedback declared -- nothing ever sent for the modifier itself

    rawInput.emitRawMessage(Uint8Array.of(0xb0, 49, 127));
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 71, 50));
    expect(held.getValue()).toBe(50); // held/released tracking for `when` still works with no feedback wired
  });
});

describe("bindSurfaceMode — navigation binding LED feedback (ECS-145 follow-up)", () => {
  const arrowButton: PhysicalControl = {
    id: "button-arrow-right",
    label: "Arrow Right",
    kind: "button",
    portId: "in-1",
    input: { address: { type: "control-change", controller: 45 }, channel: 0 },
    feedback: { kind: "monochrome-led", address: { address: { type: "control-change", controller: 45 }, channel: 0 }, dimValue: 1 },
    feedbackPortId: "out-1",
  };

  const pageBinding: ModeBinding = {
    kind: "navigate",
    physicalControlId: "button-arrow-right",
    role: "page right",
    navigate: { kind: "page", gridId: "pads", direction: { row: 0, column: 1 } },
  };

  const padGrid = { id: "pads", label: "pads", rows: 1, columns: 1, cells: [], paging: { rows: 1, columns: 1 } };

  it("rests dim on bind, goes full while held, back to dim on release, and off on unbind", async () => {
    const { rawInput, input, output, rawOutput } = wiredPorts();
    const deps: BindSurfaceModeDeps = {
      profile: { ...profile, controls: [arrowButton], grids: [padGrid] },
      context: createFakeContext(),
      registry: createFakeRegistry({}),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate: () => [],
      navigation: createSurfaceNavigation({ mode: "steps" }),
    };

    const teardown = await bindSurfaceMode({ mode: "steps", bindings: [pageBinding] }, deps);
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 45, 1]);
    rawOutput.clearSentMessages();

    rawInput.emitRawMessage(Uint8Array.of(0xb0, 45, 127));
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 45, 127]);
    rawOutput.clearSentMessages();

    rawInput.emitRawMessage(Uint8Array.of(0xb0, 45, 0));
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 45, 1]);
    rawOutput.clearSentMessages();

    await teardown();
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 45, 0]);
  });

  it("still pages normally, and sends nothing, when the control declares no feedback", async () => {
    const noFeedbackArrow: PhysicalControl = { ...arrowButton, feedback: undefined, feedbackPortId: undefined };
    const { rawInput, input, output, rawOutput } = wiredPorts();
    const navigation = createSurfaceNavigation({ mode: "steps", gridOffset: { row: 0, column: 0 } });
    const deps: BindSurfaceModeDeps = {
      profile: { ...profile, controls: [noFeedbackArrow], grids: [padGrid] },
      context: createFakeContext(),
      registry: createFakeRegistry({}),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate: () => [],
      navigation,
    };

    await bindSurfaceMode({ mode: "steps", bindings: [pageBinding] }, deps);
    expect(rawOutput.sentMessages).toHaveLength(0);

    rawInput.emitRawMessage(Uint8Array.of(0xb0, 45, 127));
    expect(navigation.state.gridOffset).toEqual({ row: 0, column: 1 });
  });
});
