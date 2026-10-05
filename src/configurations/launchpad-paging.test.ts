import { describe, expect, it } from "vitest";
import { createAction } from "../control-api/action.js";
import { createControl } from "../control-api/control.js";
import { createSurfaceContext } from "../control-api/context.js";
import { createControlRegistry } from "../control-api/registry.js";
import type { BooleanControlDef, NumericControlDef } from "../control-api/types/control.js";
import { MockMidiInput } from "../adapters/mock/mock-input.js";
import { MockMidiOutput } from "../adapters/mock/mock-output.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import { LAUNCHPAD_MINI_MK3_PROFILE } from "../profile/devices/launchpad-mini-mk3.js";
import { generateControlMappings } from "../surface/generate.js";
import { createControlSurface } from "../surface/runtime.js";
import { createSequencerBindings, type SequencerContract } from "./sequencer.js";

/**
 * ECS-95, end to end: the Launchpad's real profile and sequencer configuration, driven by raw Note and CC messages
 * through the surface runtime. The app has 16 tracks of 32 steps, so there are two track pages.
 */

const TRACKS = 16;
const STEPS = 32;

const noteOn = (note: number) => new Uint8Array([0x90, note, 127]);
const ccOn = (controller: number) => new Uint8Array([0xb0, controller, 127]);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function build() {
  const portInfo = { name: "Launchpad Mini [MK3]", manufacturer: "Novation" };
  const rawInput = new MockMidiInput({ id: "midi-in", type: "input", ...portInfo });
  const rawOutput = new MockMidiOutput({ id: "midi-out", type: "output", ...portInfo });
  const input = createMidiInput(rawInput);
  const output = createMidiOutput(rawOutput);

  const steps = new Map<string, ReturnType<typeof createControl<BooleanControlDef>>>();
  for (let row = 0; row < TRACKS; row++) {
    for (let column = 0; column < STEPS; column++) {
      const id = `step.${row}.${column}`;
      steps.set(id, createControl<BooleanControlDef>({ id, label: id, kind: "boolean", default: false }));
    }
  }
  const mutes = Array.from({ length: TRACKS }, (_, index) =>
    createControl<BooleanControlDef>({ id: `mute.${index + 1}`, label: `Mute ${index + 1}`, kind: "boolean", default: false }),
  );
  const length = createControl<NumericControlDef>({ id: "steps.length", label: "Steps", kind: "number", min: 0, max: 64, default: STEPS });
  const trackCount = createControl<NumericControlDef>({ id: "tracks.count", label: "Tracks", kind: "number", min: 0, max: 64, default: TRACKS });
  const registry = createControlRegistry([...steps.values(), ...mutes, length, trackCount]);

  const played: string[] = [];
  const action = (name: string) => createAction({ id: `transport.${name}`, label: name }, () => played.push(name));
  const contract: SequencerContract = {
    stepTemplate: "step.{row}.{column}",
    lengthControl: "steps.length",
    muteTemplate: "mute.{track}",
    trackCountControl: "tracks.count",
    actions: { play: action("play"), stop: action("stop"), record: action("record"), clear: action("clear") },
  };
  const { bindings, unresolved } = createSequencerBindings(input, LAUNCHPAD_MINI_MK3_PROFILE, contract);

  const surface = createControlSurface({
    profile: { ...LAUNCHPAD_MINI_MK3_PROFILE, setup: undefined },
    ports: { inputs: { "midi-in": input }, outputs: { "midi-out": output } },
    bindingTable: bindings,
    context: createSurfaceContext(),
    registry,
    generate: generateControlMappings,
    initialNavigation: { mode: "steps", gridOffset: { row: 0, column: 0 } },
  });

  /** Presses a control by its profile id: "pad-37" is a Note On, "top-91" or "side-79" a Control Change. */
  const press = async (id: string) => {
    const [kind, number] = id.split("-");
    rawInput.emitRawMessage(kind === "pad" ? noteOn(Number(number)) : ccOn(Number(number)));
    await flush();
  };
  return { surface, unresolved, steps, mutes, played, press, sent: () => rawOutput.sentMessages.map((bytes) => Array.from(bytes)) };
}

describe("the Launchpad sequencer, driven through the surface", () => {
  it("resolves every role on the real profile", () => {
    expect(build().unresolved).toEqual([]);
  });

  it("pages tracks with the up and down arrows, one page of eight at a time, and stops at the track count", async () => {
    const { surface, steps, press } = build();
    await surface.attach();

    await press("top-92"); // down: tracks 9-16
    expect(surface.navigation.state.gridOffset).toEqual({ row: 8, column: 0 });
    await press("top-92"); // down again: already at the last page
    expect(surface.navigation.state.gridOffset).toEqual({ row: 8, column: 0 });
    await press("top-91"); // up: back to tracks 1-8
    await press("top-91"); // up again: stops at the first track
    expect(surface.navigation.state.gridOffset).toEqual({ row: 0, column: 0 });

    await press("top-92");
    await press("pad-37"); // note 37 is grid row 5, column 6: on tracks 9-16 that is track 14, step 7
    expect(steps.get("step.13.6")?.getValue()).toBe(true);
    await surface.detach();
  });

  it("pages time with the left and right arrows, as before", async () => {
    const { surface, press } = build();
    await surface.attach();
    await press("top-94"); // right
    expect(surface.navigation.state.gridOffset).toEqual({ row: 0, column: 8 });
    await press("top-93"); // left
    expect(surface.navigation.state.gridOffset).toEqual({ row: 0, column: 0 });
    await surface.detach();
  });

  it("keeps the same track page in the mixer, and mutes the track that page shows", async () => {
    const { surface, mutes, press } = build();
    await surface.attach();

    await press("top-92"); // tracks 9-16 in steps
    await press("side-79"); // mixer
    expect(surface.navigation.state).toMatchObject({ mode: "mixer", gridOffset: { row: 8, column: 0 } });

    await press("pad-81"); // the first row of this page: track 9
    expect(mutes[8]?.getValue()).toBe(true);
    expect(mutes[0]?.getValue()).toBe(false);

    await press("top-91"); // up to tracks 1-8, still in the mixer
    await press("pad-81");
    expect(mutes[0]?.getValue()).toBe(true);
    await surface.detach();
  });

  it("does not page time in the mixer", async () => {
    const { surface, press } = build();
    await surface.attach();
    await press("side-79");
    await press("top-94"); // right: no binding in the mixer
    expect(surface.navigation.state.gridOffset).toEqual({ row: 0, column: 0 });
    await surface.detach();
  });

  it("runs transport from the side column, and the arrows no longer reach it", async () => {
    const { surface, played, press } = build();
    await surface.attach();
    await press("side-69"); // transport mode
    await press("side-59"); // play
    await press("top-91"); // an arrow does nothing in transport mode
    expect(played).toEqual(["play"]);
    await surface.detach();
  });

  it("lays the mixer's mutes across the top row, so paging moves the same row to the next eight tracks", async () => {
    const { surface, mutes, press } = build();
    await surface.attach();
    await press("side-79"); // mixer
    await press("pad-83"); // the third track across the top row: track 3
    expect(mutes[2]?.getValue()).toBe(true);

    await press("top-92"); // page down: tracks 9-16
    await press("pad-83"); // the same position now shows track 11
    expect(mutes[10]?.getValue()).toBe(true);
    expect(mutes[2]?.getValue()).toBe(true);
    await surface.detach();
  });

  it("lights a lit step blue and a muted track red, as RGB SysEx to the device", async () => {
    const { surface, sent, press } = build();
    await surface.attach();

    await press("pad-37"); // grid row 5, column 6: step 5,6
    expect(sent().slice(-1)[0]).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x03, 0x03, 37, 0, 0, 127, 0xf7]);
    await press("pad-37"); // toggled off: black
    expect(sent().slice(-1)[0]).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x03, 0x03, 37, 0, 0, 0, 0xf7]);

    await press("side-79"); // mixer
    await press("pad-81"); // track 1 muted
    expect(sent().slice(-1)[0]).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x03, 0x03, 81, 127, 0, 0, 0xf7]);
    await surface.detach();
  });
});
