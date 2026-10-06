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
import { LAUNCHPAD_MINI_MK3_MODES, LAUNCHPAD_MINI_MK3_PROFILE } from "../profile/devices/launchpad-mini-mk3.js";
import { generateControlMappings } from "../surface/generate.js";
import { createControlSurface } from "../surface/runtime.js";
import { createSequencerBindings, type SequencerContract } from "./sequencer.js";

/**
 * ECS-96, end to end: the Launchpad's real profile and the sequencer's fader modes, driven by raw messages on the
 * main and DAW ports through the surface runtime. The app's volume, pan and send controls are numbers from 0 to 127.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");

function build(profile: typeof LAUNCHPAD_MINI_MK3_PROFILE = LAUNCHPAD_MINI_MK3_PROFILE) {
  const portInfo = { name: "Launchpad Mini [MK3]", manufacturer: "Novation" };
  const midiIn = new MockMidiInput({ id: "midi-in", type: "input", ...portInfo });
  const midiOut = new MockMidiOutput({ id: "midi-out", type: "output", ...portInfo });
  const dawIn = new MockMidiInput({ id: "daw-in", type: "input", ...portInfo });
  const dawOut = new MockMidiOutput({ id: "daw-out", type: "output", ...portInfo });

  const numeric = (id: string) => createControl<NumericControlDef>({ id, label: id, kind: "number", min: 0, max: 127, default: 0 });
  const appControls = ["volume", "pan", "send"].flatMap((bank) => Array.from({ length: 8 }, (_, index) => numeric(`mixer.${bank}.${index}`)));
  const registry = createControlRegistry([...appControls, numeric("steps.length"), numeric("tracks.count")]);

  const pages: string[] = [];
  const contract: SequencerContract = {
    stepTemplate: "step.{row}.{column}",
    lengthControl: "steps.length",
    muteTemplate: "mute.{track}",
    trackCountControl: "tracks.count",
    actions: { play: createAction({ id: "t.play", label: "play" }, () => {}) },
    faderActions: {
      pageUp: createAction({ id: "faders.pageUp", label: "page up" }, () => pages.push("up")),
      pageDown: createAction({ id: "faders.pageDown", label: "page down" }, () => pages.push("down")),
      pageLeft: createAction({ id: "faders.pageLeft", label: "page left" }, () => pages.push("left")),
      pageRight: createAction({ id: "faders.pageRight", label: "page right" }, () => pages.push("right")),
    },
    faderTemplates: { volume: "mixer.volume.{index}", pan: "mixer.pan.{index}", send: "mixer.send.{index}" },
  };
  const devices = {
    outputs: { "midi-out": createMidiOutput(midiOut), "daw-out": createMidiOutput(dawOut) },
    inputs: { "daw-in": createMidiInput(dawIn) },
    connectedPortIds: ["midi-in", "midi-out", "daw-in", "daw-out"],
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

  /** Presses a side button on the main port (Programmer mode): CC 89-19, as the device sends them. */
  const pressMain = async (controller: number) => {
    midiIn.emitRawMessage(new Uint8Array([0xb0, controller, 127]));
    await flush();
    midiIn.emitRawMessage(new Uint8Array([0xb0, controller, 0]));
    await flush();
  };
  /** Presses a side button on the DAW port (fader layout). */
  const pressDaw = async (controller: number) => {
    dawIn.emitRawMessage(new Uint8Array([0xb0, controller, 127]));
    await flush();
    dawIn.emitRawMessage(new Uint8Array([0xb0, controller, 0]));
    await flush();
  };
  /** Moves a fader on the DAW port: channel 5, the fader's CC, value 0-127. */
  const moveFader = async (controller: number, value: number) => {
    dawIn.emitRawMessage(new Uint8Array([0xb4, controller, value]));
    await flush();
  };

  return {
    surface,
    registry,
    dawIn,
    dawOut,
    pages,
    /** The DAW-mode and layout messages sent on the main port: DAW mode (10h), bank setup (01h) and layout (00h). LED paints are left out. */
    sentMain: () => midiOut.sentMessages.map(hex).filter((message) => /^f0 00 20 29 02 0d (10|01|00) /.test(message)),
    sentDaw: () => dawOut.sentMessages.map(hex),
    pressMain,
    pressDaw,
    moveFader,
  };
}

describe("the mixer fader modes, end to end on the Launchpad", () => {
  it("enters the volume bank from the main side-69 button, sending DAW mode, the bank and the layout", async () => {
    const { surface, sentMain, pressMain } = build();
    await surface.attach();
    await pressMain(69);
    expect(surface.navigation.state.mode).toBe("faders-volume");
    expect(sentMain()).toEqual([
      "f0 00 20 29 02 0d 10 01 f7",
      "f0 00 20 29 02 0d 01 00 00 00 00 50 25 01 00 51 25 02 00 52 25 03 00 53 25 04 00 54 25 05 00 55 25 06 00 56 25 07 00 57 25 f7",
      "f0 00 20 29 02 0d 00 0d f7",
    ]);
    await surface.detach();
  });

  it("moves a fader on the DAW port to its app control, without echoing its colour back (ECS-57)", async () => {
    const { surface, registry, pressMain, moveFader, sentDaw } = build();
    await surface.attach();
    await pressMain(69);
    const before = sentDaw().length;
    await moveFader(80, 100);
    expect(registry.getControl("mixer.volume.0")?.getValue()).toBe(100);
    expect(sentDaw().slice(before).filter((message) => message.startsWith("b5 00 "))).toEqual([]);
    await surface.detach();
  });

  it("paints a fader's colour from its app control when the app changes the level: B5h, the fader's index, the level as palette entry", async () => {
    const { surface, registry, pressMain, sentDaw } = build();
    await surface.attach();
    await pressMain(69);
    const before = sentDaw().length;
    registry.getControl("mixer.volume.0")?.setValue(50);
    expect(sentDaw().slice(before)).toEqual(["b5 00 32"]);
    await surface.detach();
  });

  it("leaves the fader layout from the DAW side-89 button, sending the deactivate messages on the main port", async () => {
    const { surface, sentMain, pressMain, pressDaw } = build();
    await surface.attach();
    await pressMain(69);
    const before = sentMain().length;
    await pressDaw(89);
    expect(surface.navigation.state.mode).toBe("steps");
    expect(sentMain().slice(before)).toEqual(["f0 00 20 29 02 0d 00 7f f7", "f0 00 20 29 02 0d 10 00 f7"]);
    await surface.detach();
  });

  it("switches banks from the DAW side-59 button: leaving the volume bank, then entering pan", async () => {
    const { surface, sentMain, pressMain, pressDaw } = build();
    await surface.attach();
    await pressMain(69);
    const before = sentMain().length;
    await pressDaw(59);
    expect(surface.navigation.state.mode).toBe("faders-pan");
    const sentSince = sentMain().slice(before);
    expect(sentSince[0]).toBe("f0 00 20 29 02 0d 00 7f f7");
    expect(sentSince[1]).toBe("f0 00 20 29 02 0d 10 00 f7");
    expect(sentSince[2]).toBe("f0 00 20 29 02 0d 10 01 f7");
    expect(sentSince[3]?.startsWith("f0 00 20 29 02 0d 01 00 00 00 01 58 15")).toBe(true);
    expect(sentSince[4]).toBe("f0 00 20 29 02 0d 00 0d f7");
    await surface.detach();
  });

  it("opens the DAW ports at attach, keeps them open across modes, and closes them at detach", async () => {
    const { surface, dawIn, dawOut, pressMain, pressDaw } = build();
    expect(dawIn.state).toBe("available");
    await surface.attach();
    expect(dawIn.state).toBe("connected");
    expect(dawOut.state).toBe("connected");

    await pressMain(69);
    await pressDaw(89);
    expect(surface.navigation.state.mode).toBe("steps");
    expect(dawIn.state).toBe("connected");

    await surface.detach();
    expect(dawIn.state).toBe("disconnected");
    expect(dawOut.state).toBe("disconnected");
  });

  it("re-enters a fader bank after leaving it, and leaves pan again", async () => {
    const { surface, registry, pressMain, pressDaw, moveFader } = build();
    await surface.attach();
    await pressMain(69);
    await pressDaw(89);
    await pressMain(69);
    expect(surface.navigation.state.mode).toBe("faders-volume");
    await moveFader(80, 40);
    expect(registry.getControl("mixer.volume.0")?.getValue()).toBe(40);

    await pressDaw(59);
    expect(surface.navigation.state.mode).toBe("faders-pan");
    await pressDaw(89);
    expect(surface.navigation.state.mode).toBe("steps");
    await surface.detach();
  });

  it("keeps the side buttons and faders working after a bank switch, so pan can be left again", async () => {
    const { surface, registry, dawIn, pressMain, pressDaw, moveFader } = build();
    await surface.attach();
    await pressMain(69);
    await pressDaw(59);
    expect(surface.navigation.state.mode).toBe("faders-pan");
    expect(dawIn.state).toBe("connected");

    await moveFader(88, 30);
    expect(registry.getControl("mixer.pan.0")?.getValue()).toBe(30);

    await pressDaw(89);
    expect(surface.navigation.state.mode).toBe("steps");
    await surface.detach();
  });

  it("sends the fader modes' arrows to the application as page actions, not as navigation", async () => {
    const { surface, pages, pressMain, pressDaw } = build();
    await surface.attach();
    await pressMain(69);
    await pressDaw(94);
    await pressDaw(93);
    expect(pages).toEqual(["right", "left"]);
    expect(surface.navigation.state.gridOffset).toEqual({ row: 0, column: 0 });
    await surface.detach();
  });

  it("resends the bank before the application moves its tracks, so the device's fader setup follows the page (ECS-96)", async () => {
    const { surface, pages, sentMain, pressMain, pressDaw } = build();
    await surface.attach();
    await pressMain(69);
    const banksBefore = sentMain().filter((message) => message.startsWith("f0 00 20 29 02 0d 01 ")).length;
    await pressDaw(94);
    expect(pages).toEqual(["right"]);
    const banksAfter = sentMain().filter((message) => message.startsWith("f0 00 20 29 02 0d 01 ")).length;
    expect(banksAfter).toBe(banksBefore + 1);
    await surface.detach();
  });

  it("sends no bank on a page turn when the profile says the device keeps its fader setup (ECS-101)", async () => {
    const profile = { ...LAUNCHPAD_MINI_MK3_PROFILE, modes: LAUNCHPAD_MINI_MK3_MODES.map((mode) => ({ ...mode, resendBankOnPageTurn: false })) };
    const { surface, pages, sentMain, pressMain, pressDaw } = build(profile);
    await surface.attach();
    await pressMain(69);
    const before = sentMain().length;
    await pressDaw(94);
    // The application still turns its tracks; only the device's bank message is left out.
    expect(pages).toEqual(["right"]);
    expect(sentMain().slice(before)).toEqual([]);
    await surface.detach();
  });
});
