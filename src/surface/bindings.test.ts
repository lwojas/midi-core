import { describe, expect, it, vi } from "vitest";
import { MockMidiInput } from "../adapters/mock/mock-input.js";
import { MockMidiOutput } from "../adapters/mock/mock-output.js";
import { createControl } from "../control-api/control.js";
import { createSurfaceContext } from "../control-api/context.js";
import { createControlRegistry } from "../control-api/registry.js";
import type { SurfaceContext } from "../control-api/types/context.js";
import type { BooleanControlDef, Control, ControlDef, ControlValue, NumericControlDef, StringControlDef } from "../control-api/types/control.js";
import type { ControlRegistry } from "../control-api/types/registry.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import type { PhysicalControl } from "../profile/types/control.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import { bindActiveMode, bindSurfaceMode, type BindSurfaceModeDeps } from "./bindings.js";
import { createSurfaceNavigation } from "./navigation.js";
import type { ControlBinding, DisplayBinding, IndicatorBinding, ModeBinding, ModeIndicatorBinding, SelectionClearBinding, SelectionWindowBinding, SurfaceModeDefinition } from "./types/bindings.js";
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

describe("bindSurfaceMode — selection window and clear bindings (ECS-155)", () => {
  const index: NumericControlDef = { id: "selection.index", label: "Selected index", kind: "number", min: -1, max: 1024, default: -1 };
  const count: NumericControlDef = { id: "tracks.count", label: "Track count", kind: "number", min: 0, max: 1024, default: 5 };

  function selectionButton(n: number, cc: number): PhysicalControl {
    return {
      id: `button-select-${n}`,
      label: `Selection button ${n}`,
      kind: "button",
      portId: "in-1",
      input: { address: { type: "control-change", controller: cc }, channel: 0 },
      feedback: { kind: "monochrome-led", address: { address: { type: "control-change", controller: cc }, channel: 0 }, dimValue: 1 },
      feedbackPortId: "out-1",
    };
  }

  const buttons = Array.from({ length: 8 }, (_, i) => selectionButton(i + 1, 36 + i));
  const masterButton: PhysicalControl = {
    id: "button-master",
    label: "Master",
    kind: "button",
    portId: "in-1",
    input: { address: { type: "control-change", controller: 28 }, channel: 0 },
    feedback: { kind: "monochrome-led", address: { address: { type: "control-change", controller: 28 }, channel: 0 }, dimValue: 1 },
    feedbackPortId: "out-1",
  };

  const grid = {
    id: "selection-buttons",
    label: "selection",
    rows: 1,
    columns: 8,
    cells: buttons.map((button, column) => ({ row: 0, column, controlId: button.id })),
  };

  const selectionBindings: SelectionWindowBinding[] = buttons.map((button, column) => ({
    kind: "selection",
    physicalControlId: button.id,
    role: `selection slot ${column + 1}`,
    gridId: grid.id,
    indexControl: index.id,
    orientation: "horizontal",
    countControl: count.id,
  }));

  const clearBinding: SelectionClearBinding = {
    kind: "selection-clear",
    physicalControlId: masterButton.id,
    role: "selection: clear (master)",
    indexControl: index.id,
    clearValue: -1,
  };

  const masterIndicator: IndicatorBinding = {
    kind: "indicator",
    physicalControlId: masterButton.id,
    role: "selection: master lit",
    resolve: { kind: "static", controlId: index.id },
    lit: -1,
  };

  /** The last monochrome CC value sent for `controller`, or undefined if none was. */
  function lastValue(sent: readonly Uint8Array[], controller: number): number | undefined {
    const matches = sent.filter((bytes) => bytes[0] === 0xb0 && bytes[1] === controller);
    return matches[matches.length - 1]?.[2];
  }

  function build(options: { trackCount?: number } = {}) {
    const { rawInput, rawOutput, input, output } = wiredPorts();
    const indexControl = createTestControl({ ...index });
    const countControl = createTestControl({ ...count, default: options.trackCount ?? count.default });
    const deps: BindSurfaceModeDeps = {
      profile: { ...profile, controls: [...buttons, masterButton], grids: [grid] },
      context: createFakeContext(),
      registry: createFakeRegistry({ [index.id]: indexControl, [count.id]: countControl }),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate: () => [],
      navigation: createSurfaceNavigation({ mode: "steps", gridOffset: { row: 0, column: 0 } }),
    };
    return { rawInput, rawOutput, indexControl, countControl, deps };
  }

  const pressCc = (rawInput: MockMidiInput, controller: number) => {
    rawInput.emitRawMessage(Uint8Array.of(0xb0, controller, 127));
    rawInput.emitRawMessage(Uint8Array.of(0xb0, controller, 0));
  };

  it("CC36-43 map to the correct selection slots: pressing one writes its own virtual index (page 0) to the shared control", async () => {
    const { rawInput, indexControl, deps } = build({ trackCount: 8 });
    await bindSurfaceMode({ mode: "steps", bindings: selectionBindings }, deps);

    pressCc(rawInput, 39); // button-select-4, column 3
    expect(indexControl.getValue()).toBe(3);

    pressCc(rawInput, 36); // button-select-1, column 0
    expect(indexControl.getValue()).toBe(0);
  });

  it("lights the selected slot full, every other available slot dim, on bind and after a press (selection initiated by the device)", async () => {
    const { rawInput, rawOutput, deps } = build({ trackCount: 8 });
    await bindSurfaceMode({ mode: "steps", bindings: selectionBindings }, deps);
    // Nothing selected yet (index -1): every slot is available but unselected -- dim.
    for (let cc = 36; cc <= 43; cc++) expect(lastValue(rawOutput.sentMessages, cc), `cc ${cc}`).toBe(1);

    pressCc(rawInput, 38); // button-select-3
    expect(lastValue(rawOutput.sentMessages, 38)).toBe(127); // selected: full
    for (const cc of [36, 37, 39, 40, 41, 42, 43]) expect(lastValue(rawOutput.sentMessages, cc), `cc ${cc}`).toBe(1); // unselected: dim
  });

  it("selection initiated by the application updates the Push: setValue() on the shared control repaints every slot", async () => {
    const { rawOutput, indexControl, deps } = build({ trackCount: 8 });
    await bindSurfaceMode({ mode: "steps", bindings: selectionBindings }, deps);
    rawOutput.clearSentMessages();

    indexControl.setValue(5); // the application selects an item directly, with no device press at all
    expect(lastValue(rawOutput.sentMessages, 41)).toBe(127); // button-select-6, column 5: now selected
    expect(lastValue(rawOutput.sentMessages, 36)).toBe(1); // button-select-1: still just dim
  });

  it("a slot past the application's track count renders fully off, not dim -- selection outside the current page", async () => {
    const { rawOutput, deps } = build({ trackCount: 5 }); // only columns 0-4 (CC 36-40) are real tracks on this page
    await bindSurfaceMode({ mode: "steps", bindings: selectionBindings }, deps);

    for (const cc of [36, 37, 38, 39, 40]) expect(lastValue(rawOutput.sentMessages, cc), `cc ${cc}`).toBe(1); // available, dim
    for (const cc of [41, 42, 43]) expect(lastValue(rawOutput.sentMessages, cc), `cc ${cc}`).toBe(0); // unavailable, fully off
  });

  it("a press on an unavailable slot still writes the index -- availability is a feedback-only concern here", async () => {
    const { rawInput, indexControl, deps } = build({ trackCount: 5 });
    await bindSurfaceMode({ mode: "steps", bindings: selectionBindings }, deps);

    pressCc(rawInput, 42); // button-select-7, column 6 -- past the 5-track count
    expect(indexControl.getValue()).toBe(6);
  });

  it("changing page updates which item each slot represents, and repaints without rebinding", async () => {
    const { rawOutput, indexControl, deps } = build({ trackCount: 16 });
    await bindSurfaceMode({ mode: "steps", bindings: selectionBindings }, deps);
    indexControl.setValue(3); // selects column 3 (button-select-4) on page 0
    rawOutput.clearSentMessages();

    deps.navigation!.pageBy({ row: 8, column: 0 }); // page down by one page of 8
    // Column 3 on the new page is virtual index 11, which no longer equals the selected index (3): dim, not full.
    expect(lastValue(rawOutput.sentMessages, 39)).toBe(1);

    indexControl.setValue(11); // now select what column 3 represents on this new page
    expect(lastValue(rawOutput.sentMessages, 39)).toBe(127);
  });

  it("stops repainting once unbound, and clears to fully off", async () => {
    const { rawOutput, indexControl, deps } = build({ trackCount: 8 });
    const teardown = await bindSurfaceMode({ mode: "steps", bindings: selectionBindings }, deps);
    indexControl.setValue(2);
    rawOutput.clearSentMessages();

    await teardown();
    expect(lastValue(rawOutput.sentMessages, 38)).toBe(0); // was full (selected); now fully off
    rawOutput.clearSentMessages();
    indexControl.setValue(4);
    expect(rawOutput.sentMessages).toHaveLength(0); // no longer observing the control at all
  });

  it("CC28 (master/clear) writes the sentinel, clearing every slot's selected state, and its own IndicatorBinding lights full", async () => {
    const { rawInput, rawOutput, indexControl, deps } = build({ trackCount: 8 });
    await bindSurfaceMode({ mode: "steps", bindings: [...selectionBindings, clearBinding, masterIndicator] }, deps);
    indexControl.setValue(2);
    expect(lastValue(rawOutput.sentMessages, 38)).toBe(127);

    pressCc(rawInput, 28); // Master
    expect(indexControl.getValue()).toBe(-1);
    expect(lastValue(rawOutput.sentMessages, 38)).toBe(1); // no longer selected: back to dim
    expect(lastValue(rawOutput.sentMessages, 28)).toBe(127); // master's own indicator: lit while index === clearValue
  });

  it("other profile controls can observe the resulting selection state: a plain onChange subscriber sees every change, device- or application-initiated", async () => {
    const { rawInput, indexControl, deps } = build({ trackCount: 8 });
    const seen: number[] = [];
    indexControl.onChange((value) => seen.push(value));
    await bindSurfaceMode({ mode: "steps", bindings: selectionBindings }, deps);

    pressCc(rawInput, 37); // device-initiated
    indexControl.setValue(6); // application-initiated
    expect(seen).toEqual([1, 6]);
  });

  it("a conditional (`when`) selection binding only applies while the modifier is in the matching state", async () => {
    const shiftButton: PhysicalControl = {
      id: "shift",
      label: "Shift",
      kind: "button",
      portId: "in-1",
      input: { address: { type: "control-change", controller: 49 }, channel: 0 },
    };
    const { rawInput, indexControl, deps } = build({ trackCount: 8 });
    const gatedBindings: SelectionWindowBinding[] = selectionBindings.map((binding) => ({ ...binding, when: "modifier-held" }));
    await bindSurfaceMode(
      { mode: "steps", bindings: gatedBindings },
      { ...deps, profile: { ...deps.profile, controls: [...deps.profile.controls, shiftButton], layout: { modifier: "shift" } } },
    );

    pressCc(rawInput, 36); // modifier released: the binding never applies
    expect(indexControl.getValue()).toBe(-1);

    rawInput.emitRawMessage(Uint8Array.of(0xb0, 49, 127)); // hold Shift
    pressCc(rawInput, 36);
    expect(indexControl.getValue()).toBe(0);
  });
});

describe("bindSurfaceMode — selection window with a velocity-color-led target (ECS-155 hardware correction)", () => {
  // The Push mk1's contextual selection buttons turned out to be a velocity-color-led family, not the
  // monochrome one assumed above: a declared colourPalette entry for the selected tier, dimValue for the
  // resting one -- the same combination `ControlFeedback.dimValue`'s own doc comment already anticipates
  // ("any boolean-paired feedback kind addressed by... control-change").
  const index: NumericControlDef = { id: "selection.index", label: "Selected index", kind: "number", min: -1, max: 1024, default: -1 };
  const green = { red: 0, green: 127, blue: 0 };

  function selectionButton(n: number, cc: number): PhysicalControl {
    return {
      id: `button-select-${n}`,
      label: `Selection button ${n}`,
      kind: "button",
      portId: "in-1",
      input: { address: { type: "control-change", controller: cc }, channel: 0 },
      feedback: {
        kind: "velocity-color-led",
        address: { address: { type: "control-change", controller: cc }, channel: 0 },
        dimValue: 10,
        colourPalette: [{ colour: green, velocity: 22 }],
      },
      feedbackPortId: "out-1",
    };
  }

  const buttons = [selectionButton(1, 36), selectionButton(2, 37)];
  const grid = { id: "selection-buttons", label: "selection", rows: 1, columns: 2, cells: buttons.map((button, column) => ({ row: 0, column, controlId: button.id })) };
  const bindings: SelectionWindowBinding[] = buttons.map((button, column) => ({
    kind: "selection",
    physicalControlId: button.id,
    role: `selection slot ${column + 1}`,
    gridId: grid.id,
    indexControl: index.id,
    orientation: "horizontal",
    colour: green,
  }));

  function lastValue(sent: readonly Uint8Array[], controller: number): number | undefined {
    const matches = sent.filter((bytes) => bytes[0] === 0xb0 && bytes[1] === controller);
    return matches[matches.length - 1]?.[2];
  }

  it("sends the palette's velocity for the selected cell, and dimValue's resting tier for every other one", async () => {
    const { input, output, rawOutput } = wiredPorts();
    const indexControl = createTestControl({ ...index });
    const deps: BindSurfaceModeDeps = {
      profile: { ...profile, controls: buttons, grids: [grid] },
      context: createFakeContext(),
      registry: createFakeRegistry({ [index.id]: indexControl }),
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate: () => [],
      navigation: createSurfaceNavigation({ mode: "steps", gridOffset: { row: 0, column: 0 } }),
    };

    await bindSurfaceMode({ mode: "steps", bindings }, deps);
    indexControl.setValue(0);

    expect(lastValue(rawOutput.sentMessages, 36)).toBe(22); // selected: the palette's velocity, not 127
    expect(lastValue(rawOutput.sentMessages, 37)).toBe(10); // available, unselected: dimValue's own tier
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

describe("bindSurfaceMode — from-selection control binding (ECS-140)", () => {
  // A relative encoder, the same wire shape as the Push mk1's own parameter encoders (ECS-136/137): CC 71,
  // twos-complement-7bit, no feedback (the real device's generic parameter encoders have none either).
  const encoder: PhysicalControl = {
    id: "encoder-1",
    label: "Encoder 1",
    kind: "encoder",
    portId: "in-1",
    input: { address: { type: "control-change", controller: 71 }, channel: 0 },
    valueMode: "relative",
    relativeEncoding: "twos-complement-7bit",
  };

  const binding: ControlBinding = {
    kind: "control",
    physicalControlId: "encoder-1",
    role: "encoder: volume",
    resolve: { kind: "from-selection", scope: "track", template: "track.{id}.volume" },
  };

  const volumeDef = (id: string): NumericControlDef => ({ id, label: "Volume", kind: "number", min: 0, max: 100, default: 50 });
  const turn = (rawInput: MockMidiInput, delta: 1 | -1) => rawInput.emitRawMessage(Uint8Array.of(0xb0, 71, delta === 1 ? 1 : 127));

  it("drives whichever track is currently selected, in both directions, and retargets live on a selection change without rebinding", async () => {
    const { rawInput, input, output } = wiredPorts();
    const track1 = createControl(volumeDef("track.1.volume"), 50);
    const track2 = createControl(volumeDef("track.2.volume"), 20);
    const registry = createControlRegistry([track1, track2]);
    const context = createSurfaceContext([{ scope: "track", id: "1" }]);
    const deps: BindSurfaceModeDeps = {
      profile: { ...profile, controls: [encoder] },
      context,
      registry,
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate: () => [],
    };

    await bindSurfaceMode({ mode: "steps", bindings: [binding] }, deps);

    turn(rawInput, 1);
    expect(track1.getValue()).toBe(51);
    turn(rawInput, -1);
    turn(rawInput, -1);
    expect(track1.getValue()).toBe(49);

    // Selecting track 2 retargets the same live binding -- no mode switch, nothing rebound.
    context.setSelection({ scope: "track", id: "2" });
    turn(rawInput, 1);
    expect(track2.getValue()).toBe(21);
    expect(track1.getValue()).toBe(49); // untouched by the turn after retargeting
  });

  it("clamps at the resolved control's own range boundaries in both directions, never throwing", async () => {
    const { rawInput, input, output } = wiredPorts();
    const track1 = createControl(volumeDef("track.1.volume"), 99);
    const registry = createControlRegistry([track1]);
    const context = createSurfaceContext([{ scope: "track", id: "1" }]);
    const deps: BindSurfaceModeDeps = {
      profile: { ...profile, controls: [encoder] },
      context,
      registry,
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate: () => [],
    };

    await bindSurfaceMode({ mode: "steps", bindings: [binding] }, deps);

    turn(rawInput, 1);
    turn(rawInput, 1); // past max
    expect(track1.getValue()).toBe(100);

    for (let i = 0; i < 150; i++) turn(rawInput, -1); // deep past min
    expect(track1.getValue()).toBe(0);
  });

  it("does nothing, and never throws, while the named scope has no current selection", async () => {
    const { rawInput, input, output } = wiredPorts();
    const track1 = createControl(volumeDef("track.1.volume"), 50);
    const registry = createControlRegistry([track1]);
    const context = createSurfaceContext([]);
    const deps: BindSurfaceModeDeps = {
      profile: { ...profile, controls: [encoder] },
      context,
      registry,
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate: () => [],
    };

    await bindSurfaceMode({ mode: "steps", bindings: [binding] }, deps);
    expect(() => turn(rawInput, 1)).not.toThrow();
    expect(track1.getValue()).toBe(50);
  });
});

describe("bindSurfaceMode — from-selection display binding (ECS-140)", () => {
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

  const binding: DisplayBinding = {
    kind: "display",
    displayId: "lcd",
    lineId: "line-1",
    resolve: { kind: "from-selection", scope: "track", template: "track.{id}.label" },
  };

  it("paints the currently selected track's label, and repaints on a later selection change, with no rebind", async () => {
    const { input, output, rawOutput } = wiredPorts();
    const labelDef = (id: string): StringControlDef => ({ id, label: "Label", kind: "string", default: "" });
    const track1 = createControl(labelDef("track.1.label"), "Kick");
    const track2 = createControl(labelDef("track.2.label"), "Snare");
    const registry = createControlRegistry([track1, track2]);
    const context = createSurfaceContext([{ scope: "track", id: "1" }]);
    const deps: BindSurfaceModeDeps = {
      profile: profileWithDisplay(),
      context,
      registry,
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate: () => [],
    };

    await bindSurfaceMode({ mode: "steps", bindings: [binding] }, deps);
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xf0, 0x47, 0x7f, 0x15, 0x18, 0x00, 0x45, 0x00, 75, 105, 99, 107, 0xf7]); // "Kick"

    context.setSelection({ scope: "track", id: "2" });
    expect(Array.from(rawOutput.sentMessages[1]!)).toEqual([0xf0, 0x47, 0x7f, 0x15, 0x18, 0x00, 0x45, 0x00, 83, 110, 97, 114, 0xf7]); // "Snare"
  });

  it("sends nothing while nothing is selected, and starts painting once a selection appears", async () => {
    const { input, output, rawOutput } = wiredPorts();
    const labelDef = (id: string): StringControlDef => ({ id, label: "Label", kind: "string", default: "" });
    const track1 = createControl(labelDef("track.1.label"), "Kick");
    const registry = createControlRegistry([track1]);
    const context = createSurfaceContext([]);
    const deps: BindSurfaceModeDeps = {
      profile: profileWithDisplay(),
      context,
      registry,
      ports: { inputs: { "in-1": input }, outputs: { "out-1": output } },
      generate: () => [],
    };

    await bindSurfaceMode({ mode: "steps", bindings: [binding] }, deps);
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xf0, 0x47, 0x7f, 0x15, 0x18, 0x00, 0x45, 0x00, 0x20, 0x20, 0x20, 0x20, 0xf7]); // fallback "" padded

    context.setSelection({ scope: "track", id: "1" });
    expect(Array.from(rawOutput.sentMessages[1]!)).toEqual([0xf0, 0x47, 0x7f, 0x15, 0x18, 0x00, 0x45, 0x00, 75, 105, 99, 107, 0xf7]); // "Kick"
  });
});
