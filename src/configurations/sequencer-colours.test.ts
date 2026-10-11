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
import { PUSH_MK1_PROFILE } from "../profile/devices/push-mk1.js";
import { generateControlMappings } from "../surface/generate.js";
import { createControlSurface } from "../surface/runtime.js";
import { createSequencerBindings, type SequencerContract } from "./sequencer.js";

/**
 * Grid and mute colour styling, end to end on the real Push profile: even/odd step and step-length colours, the
 * playhead overriding them, and an unmuted track's mute button lit green while a muted one is red. The expected
 * bytes are the ones `GRID_COLOURS`/`MUTE_COLOURS` at the top of `push-mk1.ts` declare.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const COLUMNS = 8;
const TRACKS = 16;

/** The Push's pad for sequencer `row` (row 0 is the top pad row, notes 92-99) and `column`. */
const padNote = (column: number, row = 0) => 92 - 8 * row + column;
const ROWS = 4;

function build() {
  const portInfo = { name: "Ableton Push User Port", manufacturer: "Ableton" };
  const midiIn = new MockMidiInput({ id: "user-in", type: "input", ...portInfo });
  const midiOut = new MockMidiOutput({ id: "user-out", type: "output", ...portInfo });

  const steps = Array.from({ length: ROWS }, (_, row) =>
    Array.from({ length: COLUMNS }, (_, column) =>
      createControl<BooleanControlDef>({ id: `step.${row}.${column}`, label: `Step ${row}.${column}`, kind: "boolean", default: false }),
    ),
  );
  const durations = Array.from({ length: ROWS }, (_, row) =>
    Array.from({ length: COLUMNS }, (_, column) =>
      createControl<NumericControlDef>({ id: `step.${row}.${column}.duration`, label: `Duration ${row}.${column}`, kind: "number", min: 0, max: 64, default: 0 }),
    ),
  );
  const mutes = Array.from({ length: TRACKS }, (_, index) =>
    createControl<BooleanControlDef>({ id: `mute.${index + 1}`, label: `Mute ${index + 1}`, kind: "boolean", default: false }),
  );
  const playhead = createControl<NumericControlDef>({ id: "transport.playhead", label: "Playhead", kind: "number", min: -1, max: 64, default: -1 });
  const registry = createControlRegistry([
    ...steps.flat(),
    ...durations.flat(),
    ...mutes,
    playhead,
    createControl<NumericControlDef>({ id: "steps.length", label: "length", kind: "number", min: 0, max: 64, default: COLUMNS }),
    createControl<NumericControlDef>({ id: "tracks.count", label: "tracks", kind: "number", min: 0, max: 64, default: TRACKS }),
  ]);

  const contract: SequencerContract = {
    stepTemplate: "step.{row}.{column}",
    lengthControl: "steps.length",
    muteTemplate: "mute.{track}",
    trackCountControl: "tracks.count",
    actions: { play: createAction({ id: "play", label: "play" }, () => {}), stop: createAction({ id: "stop", label: "stop" }, () => {}) },
    stepDurationTemplate: "step.{row}.{column}.duration",
    playheadControl: "transport.playhead",
  };
  const { bindings } = createSequencerBindings(createMidiInput(midiIn), PUSH_MK1_PROFILE, contract);
  const surface = createControlSurface({
    profile: { ...PUSH_MK1_PROFILE, setup: undefined },
    ports: { inputs: { "user-port-in": createMidiInput(midiIn) }, outputs: { "user-port-out": createMidiOutput(midiOut) } },
    bindingTable: bindings,
    context: createSurfaceContext(),
    registry,
    generate: generateControlMappings,
    initialNavigation: { mode: "steps", gridOffset: { row: 0, column: 0 } },
  });

  const sent = () => midiOut.sentMessages.map((bytes) => Array.from(bytes));
  /** The last note-on velocity sent to `note`, or undefined. */
  const lastNote = (note: number) => {
    const matches = sent().filter((m) => m[0] === 0x90 && m[1] === note);
    return matches[matches.length - 1]?.[2];
  };
  /** The last CC value sent to `controller`, or undefined. */
  const lastCc = (controller: number) => {
    const matches = sent().filter((m) => m[0] === 0xb0 && m[1] === controller);
    return matches[matches.length - 1]?.[2];
  };
  const pressCc = async (controller: number) => {
    midiIn.emitRawMessage(Uint8Array.of(0xb0, controller, 127));
    await flush();
    midiIn.emitRawMessage(Uint8Array.of(0xb0, controller, 0));
    await flush();
  };
  return { surface, steps, durations, mutes, playhead, lastNote, lastCc, pressCc };
}

describe("Push sequencer grid colours", () => {
  it("colours a step by its track row's parity: even rows stepEven, odd rows stepOdd, whatever the column", async () => {
    const { surface, steps, lastNote } = build();
    for (const [row, column] of [[0, 0], [0, 1], [1, 0], [1, 1], [2, 3], [3, 2]] as const) steps[row]![column]!.setValue(true);
    await surface.attach();

    expect(lastNote(padNote(0, 0))).toBe(127); // row 0 (even)
    expect(lastNote(padNote(1, 0))).toBe(127); // row 0, odd column: still even
    expect(lastNote(padNote(0, 1))).toBe(22); // row 1 (odd)
    expect(lastNote(padNote(1, 1))).toBe(22); // row 1, odd column: odd
    expect(lastNote(padNote(3, 2))).toBe(127); // row 2 (even)
    expect(lastNote(padNote(2, 3))).toBe(22); // row 3 (odd)
    await surface.detach();
  });

  it("lights a note's continuation with its row's step-length colour, the start with the row's step colour", async () => {
    const { surface, steps, durations, lastNote } = build();
    steps[0]![0]!.setValue(true);
    durations[0]![0]!.setValue(4);
    steps[1]![0]!.setValue(true);
    durations[1]![0]!.setValue(4);
    await surface.attach();

    expect(lastNote(padNote(0, 0))).toBe(127); // the step itself: stepEven
    for (const column of [1, 2, 3]) expect(lastNote(padNote(column, 0))).toBe(2); // stepLengthEven, every column
    expect(lastNote(padNote(4, 0))).toBeUndefined(); // past the note: dark (never a lit note-on)

    expect(lastNote(padNote(0, 1))).toBe(22); // stepOdd
    for (const column of [1, 2, 3]) expect(lastNote(padNote(column, 1))).toBe(1); // stepLengthOdd, every column
    await surface.detach();
  });

  it("paints the playhead over a step and a continuation alike, and restores them after it moves on", async () => {
    const { surface, steps, durations, playhead, lastNote } = build();
    steps[0]![0]!.setValue(true);
    durations[0]![0]!.setValue(3);
    await surface.attach();

    playhead.setValue(0);
    expect(lastNote(padNote(0))).toBe(36);
    playhead.setValue(1);
    expect(lastNote(padNote(0))).toBe(127);
    expect(lastNote(padNote(1))).toBe(36);
    playhead.setValue(2);
    expect(lastNote(padNote(1))).toBe(2); // row 0 is even: stepLengthEven
    expect(lastNote(padNote(2))).toBe(36);
    await surface.detach();
  });
});

describe("Push mute button colours", () => {
  it("shows unmuted tracks green and muted tracks red, following each button's own track", async () => {
    const { surface, mutes, lastCc } = build();
    mutes[1]!.setValue(true); // track 2 muted
    await surface.attach();

    expect(lastCc(102)).toBe(22); // track 1 unmuted: green
    expect(lastCc(103)).toBe(6); // track 2 muted: red
    await surface.detach();
  });

  it("flips a button red when its track is muted and green when it is unmuted again", async () => {
    const { surface, mutes, lastCc, pressCc } = build();
    await surface.attach();
    expect(lastCc(104)).toBe(22);

    await pressCc(104);
    expect(mutes[2]!.getValue()).toBe(true);
    expect(lastCc(104)).toBe(6);

    await pressCc(104);
    expect(mutes[2]!.getValue()).toBe(false);
    expect(lastCc(104)).toBe(22);
    await surface.detach();
  });

  it("keeps the strip contextual: paging tracks shows the next eight tracks' mute state", async () => {
    const { surface, mutes, lastCc, pressCc } = build();
    mutes[8]!.setValue(true); // track 9, the first track of the second page
    await surface.attach();
    expect(lastCc(102)).toBe(22);

    await pressCc(47); // page down (button-arrow-down)
    expect(lastCc(102)).toBe(6);
    await surface.detach();
  });
});
