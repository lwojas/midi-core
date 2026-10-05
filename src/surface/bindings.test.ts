import { describe, expect, it, vi } from "vitest";
import { MockMidiInput } from "../adapters/mock/mock-input.js";
import { MockMidiOutput } from "../adapters/mock/mock-output.js";
import type { SurfaceContext } from "../control-api/types/context.js";
import type { BooleanControlDef, Control, ControlDef, ControlValue, NumericControlDef } from "../control-api/types/control.js";
import type { ControlRegistry } from "../control-api/types/registry.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import { bindActiveMode, bindSurfaceMode, type BindSurfaceModeDeps } from "./bindings.js";
import { createSurfaceNavigation } from "./navigation.js";
import type { ModeBinding, SurfaceModeDefinition } from "./types/bindings.js";
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
  navigate: { kind: "page-by", delta: { row: 0, column: 1 } },
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
