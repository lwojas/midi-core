import { describe, expect, it } from "vitest";
import { createAction } from "../control-api/action.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import type { MidiMessage } from "../core/types/message.js";
import type { MidiOutput } from "../core/types/output.js";
import { MockMidiInput } from "../adapters/mock/mock-input.js";
import { LAUNCHPAD_MINI_MK3_MODES, LAUNCHPAD_MINI_MK3_PROFILE } from "../profile/devices/launchpad-mini-mk3.js";
import type { ModeBinding, SurfaceBindingTable, SurfaceModeDefinition } from "../surface/types/bindings.js";
import { createSequencerBindings, type SequencerContract, type SequencerDevices } from "./sequencer.js";

const action = () => createAction({ id: "a", label: "a" }, () => {});
const input = createMidiInput(new MockMidiInput({ id: "in", type: "input", name: "in", manufacturer: null }));

const faderTemplates = {
  volume: "mixer.volume.{index}",
  pan: "mixer.pan.{index}",
  send: "mixer.send.{index}",
};
const contract = (): SequencerContract => ({
  stepTemplate: "step.{row}.{column}",
  lengthControl: "steps.length",
  muteTemplate: "mute.{track}",
  trackCountControl: "tracks.count",
  actions: { play: action(), stop: action(), record: action(), clear: action() },
  faderTemplates,
});

/** A device's connection with every Launchpad port present: the main pair and the DAW pair. */
function connectedLaunchpad(): { devices: SequencerDevices; sent: MidiMessage[] } {
  const sent: MidiMessage[] = [];
  const output = { send: (message: MidiMessage) => sent.push(message) } as unknown as MidiOutput;
  const connectedPortIds = LAUNCHPAD_MINI_MK3_PROFILE.ports.map((port) => port.id);
  const dawInput = createMidiInput(new MockMidiInput({ id: "daw-in", type: "input", name: "daw-in", manufacturer: null }));
  return { devices: { outputs: { "midi-out": output, "daw-out": output }, inputs: { "daw-in": dawInput }, connectedPortIds }, sent };
}

/** The Launchpad as a device without the DAW ports: only the main pair is connected. */
function mainPortsOnly(): { devices: SequencerDevices; sent: MidiMessage[] } {
  const sent: MidiMessage[] = [];
  const output = { send: (message: MidiMessage) => sent.push(message) } as unknown as MidiOutput;
  return { devices: { outputs: { "midi-out": output }, inputs: {}, connectedPortIds: ["midi-in", "midi-out"] }, sent };
}

function modeNames(table: SurfaceBindingTable): string[] {
  return table.map((definition) => definition.mode);
}

function definitionOf(table: SurfaceBindingTable, mode: string): SurfaceModeDefinition {
  const found = table.find((definition) => definition.mode === mode);
  if (!found) throw new Error(`no mode ${mode}`);
  return found;
}

function setModeTargets(bindings: readonly ModeBinding[] | undefined): Record<string, string> {
  const targets: Record<string, string> = {};
  for (const binding of bindings ?? []) {
    if (binding.kind === "navigate" && binding.navigate.kind === "set-mode") targets[binding.physicalControlId] = binding.navigate.mode;
  }
  return targets;
}

describe("the fader modes, without a device connection", () => {
  it("builds no fader modes, so a device without the DAW ports has only its own modes", () => {
    const { bindings, unresolved } = createSequencerBindings(input, LAUNCHPAD_MINI_MK3_PROFILE, contract());
    expect(modeNames(bindings)).toEqual(["steps", "mixer", "transport"]);
    expect(unresolved).toEqual([]);
  });
});

describe("the fader modes, on a Launchpad with its DAW ports", () => {
  it("builds one mode per bank, with its own eight fader bindings resolved from the application's templates", () => {
    const { devices } = connectedLaunchpad();
    const { bindings } = createSequencerBindings(input, LAUNCHPAD_MINI_MK3_PROFILE, contract(), devices);
    expect(modeNames(bindings)).toEqual(["steps", "mixer", "transport", "faders-volume", "faders-pan", "faders-send"]);

    const pan = definitionOf(bindings, "faders-pan");
    const faders = (pan.bindings ?? []).filter((binding) => binding.kind === "control");
    expect(faders).toHaveLength(8);
    expect(faders[0]).toMatchObject({ physicalControlId: "fader-pan-0", resolve: { kind: "static", controlId: "mixer.pan.0" } });
    expect(faders[7]).toMatchObject({ physicalControlId: "fader-pan-7", resolve: { kind: "static", controlId: "mixer.pan.7" } });
  });

  it("switches modes from the DAW side buttons while in a fader bank, and from the main side buttons elsewhere", () => {
    const { devices } = connectedLaunchpad();
    const { bindings } = createSequencerBindings(input, LAUNCHPAD_MINI_MK3_PROFILE, contract(), devices);

    const volume = setModeTargets(definitionOf(bindings, "faders-volume").bindings);
    expect(volume).toEqual({
      "daw-side-89": "steps",
      "daw-side-79": "mixer",
      "daw-side-59": "faders-pan",
      "daw-side-49": "faders-send",
    });

    const steps = setModeTargets(definitionOf(bindings, "steps").bindings);
    expect(steps["side-69"]).toBe("faders-volume");
    expect(steps["side-59"]).toBe("faders-pan");
    expect(steps["side-49"]).toBe("faders-send");
  });

  it("sends the mode's activate messages, then the bank, then the layout on enter, and the deactivate messages on exit", async () => {
    const { devices, sent } = connectedLaunchpad();
    const { bindings } = createSequencerBindings(input, LAUNCHPAD_MINI_MK3_PROFILE, contract(), devices);
    const volume = definitionOf(bindings, "faders-volume");

    await volume.hooks?.onEnter?.();
    const enter = sent.map((message) => (message.type === "sysex" ? Array.from(message.raw) : message.type));
    expect(enter[0]).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x10, 0x01, 0xf7]);
    // Volume: unipolar faders, CCs 80-87, colour 37.
    expect(enter[1]).toEqual([
      0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x01, 0x00, 0x00,
      0, 0, 80, 37, 1, 0, 81, 37, 2, 0, 82, 37, 3, 0, 83, 37, 4, 0, 84, 37, 5, 0, 85, 37, 6, 0, 86, 37, 7, 0, 87, 37,
      0xf7,
    ]);
    expect(enter[2]).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x00, 0x0d, 0xf7]);
    expect(enter).toHaveLength(3);

    sent.length = 0;
    await volume.hooks?.onExit?.();
    expect(sent.map((message) => (message.type === "sysex" ? Array.from(message.raw) : message.type))).toEqual([
      [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x00, 0x7f, 0xf7],
      [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x10, 0x00, 0xf7],
    ]);
  });

  it("sends the pan bank as bipolar faders on CCs 88-95, colour 21", async () => {
    const { devices, sent } = connectedLaunchpad();
    const { bindings } = createSequencerBindings(input, LAUNCHPAD_MINI_MK3_PROFILE, contract(), devices);
    await definitionOf(bindings, "faders-pan").hooks?.onEnter?.();
    const bank = sent[1];
    expect(bank?.type === "sysex" && Array.from(bank.raw)).toEqual([
      0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x01, 0x00, 0x00,
      0, 1, 88, 21, 1, 1, 89, 21, 2, 1, 90, 21, 3, 1, 91, 21, 4, 1, 92, 21, 5, 1, 93, 21, 6, 1, 94, 21, 7, 1, 95, 21,
      0xf7,
    ]);
  });

  it("binds each fader to the control id the profile gives it, and the mode to the bank's mode id (ECS-100)", () => {
    const { devices } = connectedLaunchpad();
    const rename = (id: string) => id.replace("fader-pan-", "pan-knob-");
    const profile = {
      ...LAUNCHPAD_MINI_MK3_PROFILE,
      controls: LAUNCHPAD_MINI_MK3_PROFILE.controls.map((control) => (control.id.startsWith("fader-pan-") ? { ...control, id: rename(control.id) } : control)),
      modes: LAUNCHPAD_MINI_MK3_MODES.map((mode) => ({
        ...mode,
        faders: { ...mode.faders, banks: mode.faders.banks.map((bank) => (bank.id === "pan" ? { ...bank, controlIds: bank.controlIds.map(rename) } : bank)) },
      })),
    } as typeof LAUNCHPAD_MINI_MK3_PROFILE;
    const { bindings } = createSequencerBindings(input, profile, contract(), devices);
    const faders = (definitionOf(bindings, "faders-pan").bindings ?? []).filter((binding) => binding.kind === "control");
    expect(faders[0]).toMatchObject({ physicalControlId: "pan-knob-0", resolve: { kind: "static", controlId: "mixer.pan.0" } });
    expect(faders[7]).toMatchObject({ physicalControlId: "pan-knob-7", resolve: { kind: "static", controlId: "mixer.pan.7" } });
  });

  it("writes each fader's entry in the profile's field order and bank type values (ECS-99)", async () => {
    const { devices, sent } = connectedLaunchpad();
    const [mode] = LAUNCHPAD_MINI_MK3_PROFILE.modes ?? [];
    const profile = {
      ...LAUNCHPAD_MINI_MK3_PROFILE,
      modes: [{ ...mode!, bankEntry: ["colour", "controller", "type", "index"], bankTypes: { unipolar: 2, bipolar: 3 } }],
    } as typeof LAUNCHPAD_MINI_MK3_PROFILE;
    const { bindings } = createSequencerBindings(input, profile, contract(), devices);
    await definitionOf(bindings, "faders-pan").hooks?.onEnter?.();
    const bank = sent[1];
    // Each fader: colour 21, its CC, bipolar type 3, then its index.
    const entries = Array.from({ length: 8 }, (_, index) => [21, 88 + index, 3, index]).flat();
    expect(bank?.type === "sysex" && Array.from(bank.raw)).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x01, 0x00, 0x00, ...entries, 0xf7]);
  });

  it("builds a bank's mode only when the application has a template for that bank", () => {
    const { devices } = connectedLaunchpad();
    const { bindings } = createSequencerBindings(input, LAUNCHPAD_MINI_MK3_PROFILE, { ...contract(), faderTemplates: { volume: faderTemplates.volume } }, devices);
    expect(modeNames(bindings)).toEqual(["steps", "mixer", "transport", "faders-volume"]);
    expect(setModeTargets(definitionOf(bindings, "steps").bindings)["side-59"]).toBeUndefined();
  });

  it("keeps the transport mode off the side-59 button, which the fader bank selects", () => {
    const { devices } = connectedLaunchpad();
    const { bindings } = createSequencerBindings(input, LAUNCHPAD_MINI_MK3_PROFILE, contract(), devices);
    const transport = setModeTargets(definitionOf(bindings, "transport").bindings);
    expect(transport["side-59"]).toBeUndefined();
    expect(transport["side-79"]).toBe("mixer");
  });
});

describe("the fader modes, on a Launchpad without its DAW ports", () => {
  it("builds no fader modes, and binds no fader buttons", () => {
    const { devices } = mainPortsOnly();
    const { bindings, unresolved } = createSequencerBindings(input, LAUNCHPAD_MINI_MK3_PROFILE, contract(), devices);
    expect(modeNames(bindings)).toEqual(["steps", "mixer", "transport"]);
    expect(unresolved).toEqual([]);
  });
});
