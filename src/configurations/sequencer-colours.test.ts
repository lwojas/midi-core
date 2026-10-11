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

/** The Push's top pad row (the sequencer's row 0): notes 92-99, one per column. */
const padNote = (column: number) => 92 + column;

function build() {
  const portInfo = { name: "Ableton Push User Port", manufacturer: "Ableton" };
  const midiIn = new MockMidiInput({ id: "user-in", type: "input", ...portInfo });
  const midiOut = new MockMidiOutput({ id: "user-out", type: "output", ...portInfo });

  const steps = Array.from({ length: COLUMNS }, (_, column) =>
    createControl<BooleanControlDef>({ id: `step.0.${column}`, label: `Step ${column}`, kind: "boolean", default: false }),
  );
  const durations = Array.from({ length: COLUMNS }, (_, column) =>
    createControl<NumericControlDef>({ id: `step.0.${column}.duration`, label: `Duration ${column}`, kind: "number", min: 0, max: 64, default: 0 }),
  );
  const mutes = Array.from({ length: TRACKS }, (_, index) =>
    createControl<BooleanControlDef>({ id: `mute.${index + 1}`, label: `Mute ${index + 1}`, kind: "boolean", default: false }),
  );
  const playhead = createControl<NumericControlDef>({ id: "transport.playhead", label: "Playhead", kind: "number", min: -1, max: 64, default: -1 });
  const registry = createControlRegistry([
    ...steps,
    ...durations,
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
  it("lights an even-column step with stepEven and an odd-column step with stepOdd", async () => {
    const { surface, steps, lastNote } = build();
    steps[0]!.setValue(true);
    steps[1]!.setValue(true);
    await surface.attach();

    expect(lastNote(padNote(0))).toBe(127); // stepEven
    expect(lastNote(padNote(1))).toBe(22); // stepOdd
    await surface.detach();
  });

  it("lights the continuation of a four-step note with the even/odd step-length colours, the start with the step colour", async () => {
    const { surface, steps, durations, lastNote } = build();
    steps[0]!.setValue(true);
    durations[0]!.setValue(4);
    await surface.attach();

    expect(lastNote(padNote(0))).toBe(127); // the step itself: stepEven
    expect(lastNote(padNote(1))).toBe(1); // stepLengthOdd
    expect(lastNote(padNote(2))).toBe(2); // stepLengthEven
    expect(lastNote(padNote(3))).toBe(1); // stepLengthOdd
    expect(lastNote(padNote(4))).toBeUndefined(); // past the note: dark (never a lit note-on)
    await surface.detach();
  });

  it("paints the playhead over a step and a continuation alike, and restores them after it moves on", async () => {
    const { surface, steps, durations, playhead, lastNote } = build();
    steps[0]!.setValue(true);
    durations[0]!.setValue(3);
    await surface.attach();

    playhead.setValue(0);
    expect(lastNote(padNote(0))).toBe(36);
    playhead.setValue(1);
    expect(lastNote(padNote(0))).toBe(127);
    expect(lastNote(padNote(1))).toBe(36);
    playhead.setValue(2);
    expect(lastNote(padNote(1))).toBe(1);
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
