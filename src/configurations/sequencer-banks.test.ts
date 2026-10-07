import { describe, expect, it } from "vitest";
import { createAction } from "../control-api/action.js";
import { createControl } from "../control-api/control.js";
import { createSurfaceContext } from "../control-api/context.js";
import { createControlRegistry } from "../control-api/registry.js";
import type { NumericControlDef } from "../control-api/types/control.js";
import { MockMidiInput } from "../adapters/mock/mock-input.js";
import { MockMidiOutput } from "../adapters/mock/mock-output.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import { LAUNCHPAD_MINI_MK3_PROFILE } from "../profile/devices/launchpad-mini-mk3.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import { generateControlMappings } from "../surface/generate.js";
import { createControlSurface } from "../surface/runtime.js";
import { createSequencerBindings, type SequencerContract } from "./sequencer.js";

/**
 * ECS-114, end to end: bank buttons on the Launchpad profile, through the surface runtime. The app's bank is a number
 * control 0 to 3; a press must reach the app as an action and never write that control. The lit LED is an indicator.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");

/** The Launchpad's RGB LED message for `led` (note or CC number), as the last one the device was sent for it, or undefined. */
function lastLed(sent: string[], led: number): string | undefined {
  const prefix = `f0 00 20 29 02 0d 03 03 ${led.toString(16).padStart(2, "0")} `;
  const matches = sent.filter((message) => message.startsWith(prefix));
  return matches[matches.length - 1];
}

function build(profile: DeviceProfile = LAUNCHPAD_MINI_MK3_PROFILE, options: { bankControl?: boolean; withPrevious?: boolean } = {}) {
  const portInfo = { name: "Launchpad Mini [MK3]", manufacturer: "Novation" };
  const midiIn = new MockMidiInput({ id: "midi-in", type: "input", ...portInfo });
  const midiOut = new MockMidiOutput({ id: "midi-out", type: "output", ...portInfo });

  const bank = createControl<NumericControlDef>({ id: "bank.active", label: "Active bank", kind: "number", min: 0, max: 3, default: 0 });
  const registry = createControlRegistry([
    bank,
    createControl<NumericControlDef>({ id: "steps.length", label: "length", kind: "number", min: 0, max: 1024, default: 0 }),
    createControl<NumericControlDef>({ id: "tracks.count", label: "tracks", kind: "number", min: 0, max: 1024, default: 0 }),
  ]);

  const calls: string[] = [];
  const record = (name: string) => createAction({ id: `bank.${name}`, label: name }, () => calls.push(name));
  const contract: SequencerContract = {
    stepTemplate: "step.{row}.{column}",
    lengthControl: "steps.length",
    muteTemplate: "mute.{track}",
    trackCountControl: "tracks.count",
    actions: {},
    bankActions: {
      previous: options.withPrevious === false ? undefined : record("previous"),
      next: record("next"),
      select: { 0: record("select-a"), 1: record("select-b"), 2: record("select-c"), 3: record("select-d") },
    },
    ...(options.bankControl === false ? {} : { bankControl: "bank.active" }),
  };
  const { bindings, unresolved } = createSequencerBindings(createMidiInput(midiIn), profile, contract);

  const surface = createControlSurface({
    profile: { ...profile, setup: undefined },
    ports: { inputs: { "midi-in": createMidiInput(midiIn) }, outputs: { "midi-out": createMidiOutput(midiOut) } },
    bindingTable: bindings,
    context: createSurfaceContext(),
    registry,
    generate: generateControlMappings,
    initialNavigation: { mode: "steps", gridOffset: { row: 0, column: 0 } },
  });

  /** A note-on press and release on the main port (Programmer mode), as the device sends a pad. */
  const pressNote = async (note: number) => {
    midiIn.emitRawMessage(new Uint8Array([0x90, note, 127]));
    await flush();
    midiIn.emitRawMessage(new Uint8Array([0x90, note, 0]));
    await flush();
  };
  /** A CC press and release on the main port, as the device sends a top-row button. */
  const pressCc = async (controller: number) => {
    midiIn.emitRawMessage(new Uint8Array([0xb0, controller, 127]));
    await flush();
    midiIn.emitRawMessage(new Uint8Array([0xb0, controller, 0]));
    await flush();
  };

  return {
    surface,
    registry,
    unresolved,
    calls,
    pressNote,
    pressCc,
    sent: () => midiOut.sentMessages.map(hex),
    setBank: (value: number) => registry.getControl("bank.active")!.setValue(value),
    bank,
    bankNumber: () => bank.getValue(),
    enterMixer: async () => {
      midiIn.emitRawMessage(new Uint8Array([0xb0, 79, 127]));
      await flush();
      midiIn.emitRawMessage(new Uint8Array([0xb0, 79, 0]));
      await flush();
    },
  };
}

describe("bank buttons reach the application as actions (ECS-114)", () => {
  it("a note-on and a bank-select CC both invoke their action, through the same binding", async () => {
    // A note-on can be a bank button too: the profile says which control it is, and the device's wire format doesn't matter.
    const profile: DeviceProfile = {
      ...LAUNCHPAD_MINI_MK3_PROFILE,
      layout: { ...LAUNCHPAD_MINI_MK3_PROFILE.layout, bank: { previous: "pad-81", select: { 0: "top-95" } } },
    };
    const { surface, calls, pressNote, pressCc } = build(profile);
    await surface.attach();

    await pressNote(81);
    await pressCc(95);
    expect(calls).toEqual(["previous", "select-a"]);
    await surface.detach();
  });

  it("the Launchpad's top-row buttons select banks A to D, and a press does not write the bank control", async () => {
    const { surface, calls, pressCc, bankNumber } = build();
    await surface.attach();

    await pressCc(96);
    expect(calls).toEqual(["select-b"]);
    expect(bankNumber()).toBe(0);
    await surface.detach();
  });

  it("a bank with no action has no binding: its button does nothing", async () => {
    const { surface, calls, pressCc } = build(undefined, { withPrevious: false });
    await surface.attach();

    await pressCc(96);
    expect(calls).toEqual(["select-b"]);
    await surface.detach();
  });

  it("names a bank button the profile doesn't have as unresolved, and the rest still work", async () => {
    const profile: DeviceProfile = {
      ...LAUNCHPAD_MINI_MK3_PROFILE,
      layout: { ...LAUNCHPAD_MINI_MK3_PROFILE.layout, bank: { previous: "no-such-control", select: { 0: "top-95" } } },
    };
    const { surface, unresolved, calls, pressCc } = build(profile);
    await surface.attach();

    expect(unresolved).toContain("bank: previous (control no-such-control)");
    await pressCc(95);
    expect(calls).toEqual(["select-a"]);
    await surface.detach();
  });
});

describe("the bank buttons show the active bank (ECS-114)", () => {
  it("lights the select button of the active bank, and only that one", async () => {
    const { surface, sent, setBank } = build();
    await surface.attach();
    // Bank A (0) is active when the surface attaches: its button (CC 95) is lit green, the others are dark.
    expect(lastLed(sent(), 95)).toBe("f0 00 20 29 02 0d 03 03 5f 00 7f 00 f7");
    expect(lastLed(sent(), 96)).toBe("f0 00 20 29 02 0d 03 03 60 00 00 00 f7");

    setBank(2);
    expect(lastLed(sent(), 95)).toBe("f0 00 20 29 02 0d 03 03 5f 00 00 00 f7");
    expect(lastLed(sent(), 97)).toBe("f0 00 20 29 02 0d 03 03 61 00 7f 00 f7");
    await surface.detach();
  });

  it("keeps the active bank lit after the surface changes mode", async () => {
    const { surface, sent, enterMixer, setBank } = build();
    await surface.attach();
    setBank(3);
    await enterMixer();
    expect(surface.navigation.state.mode).toBe("mixer");
    expect(lastLed(sent(), 98)).toBe("f0 00 20 29 02 0d 03 03 62 00 7f 00 f7");
    await surface.detach();
  });

  it("has no indicator when the contract names no bank control, and the buttons still press", async () => {
    const { surface, sent, pressCc, calls } = build(undefined, { bankControl: false });
    await surface.attach();

    expect(lastLed(sent(), 95)).toBeUndefined();
    await pressCc(95);
    expect(calls).toEqual(["select-a"]);
    await surface.detach();
  });
});

describe("bank arrows on the DAW port, in a fader mode (ECS-114)", () => {
  /** The Launchpad with its bank arrows on the DAW port: `daw-top-93` is previous, `daw-top-94` next. */
  function dawBanks() {
    const portInfo = { name: "Launchpad Mini [MK3]", manufacturer: "Novation" };
    const midiIn = new MockMidiInput({ id: "midi-in", type: "input", ...portInfo });
    const midiOut = new MockMidiOutput({ id: "midi-out", type: "output", ...portInfo });
    const dawIn = new MockMidiInput({ id: "daw-in", type: "input", ...portInfo });
    const dawOut = new MockMidiOutput({ id: "daw-out", type: "output", ...portInfo });

    let bank = 0;
    const registry = createControlRegistry([
      createControl<NumericControlDef>({ id: "bank.active", label: "Active bank", kind: "number", min: 0, max: 3, default: 0 }),
      createControl<NumericControlDef>({ id: "steps.length", label: "length", kind: "number", min: 0, max: 1024, default: 0 }),
      createControl<NumericControlDef>({ id: "tracks.count", label: "tracks", kind: "number", min: 0, max: 1024, default: 0 }),
    ]);
    const profile: DeviceProfile = {
      ...LAUNCHPAD_MINI_MK3_PROFILE,
      layout: { ...LAUNCHPAD_MINI_MK3_PROFILE.layout, bank: { previous: "daw-top-93", next: "daw-top-94", select: { 0: "top-95" } } },
    };
    const calls: string[] = [];
    const contract: SequencerContract = {
      stepTemplate: "step.{row}.{column}",
      lengthControl: "steps.length",
      muteTemplate: "mute.{track}",
      trackCountControl: "tracks.count",
      actions: {},
      bankActions: {
        previous: createAction({ id: "bank.previous", label: "previous" }, () => {
          calls.push("previous");
          bank = Math.max(0, bank - 1);
        }),
        next: createAction({ id: "bank.next", label: "next" }, () => {
          calls.push("next");
          bank = Math.min(3, bank + 1);
        }),
        select: {},
      },
      bankControl: "bank.active",
      faderTemplates: { volume: "mixer.volume.{index}" },
    };
    const devices = {
      outputs: { "midi-out": createMidiOutput(midiOut), "daw-out": createMidiOutput(dawOut) },
      inputs: { "daw-in": createMidiInput(dawIn) },
    };
    const { bindings } = createSequencerBindings(createMidiInput(midiIn), profile, contract, devices);
    const surface = createControlSurface({
      profile: { ...profile, setup: undefined },
      ports: {
        inputs: { "midi-in": createMidiInput(midiIn), "daw-in": createMidiInput(dawIn) },
        outputs: { "midi-out": createMidiOutput(midiOut), "daw-out": createMidiOutput(dawOut) },
      },
      bindingTable: bindings,
      context: createSurfaceContext(),
      registry,
      generate: generateControlMappings,
      initialNavigation: { mode: "steps", gridOffset: { row: 0, column: 0 } },
    });
    return {
      surface,
      calls,
      getBank: () => bank,
      /** Enters the volume fader mode from its side button on the main port (side-69). */
      enterFaders: () => midiIn.emitRawMessage(Uint8Array.of(0xb0, 69, 127)),
      /** Presses a button on the DAW port, as the fader layout's arrows send them. */
      pressDaw: (controller: number) => {
        dawIn.emitRawMessage(Uint8Array.of(0xb0, controller, 127));
        dawIn.emitRawMessage(Uint8Array.of(0xb0, controller, 0));
      },
    };
  }

  it("the DAW arrows switch banks while a fader mode is shown", async () => {
    const { surface, calls, enterFaders, pressDaw, getBank } = dawBanks();
    await surface.attach();
    enterFaders();
    expect(surface.navigation.state.mode).toBe("faders-volume");

    pressDaw(94); // next
    expect(calls).toEqual(["next"]);
    expect(getBank()).toBe(1);
    await surface.detach();
  });
});
