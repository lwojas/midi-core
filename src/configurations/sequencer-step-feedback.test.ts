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
 * ECS-127 (step duration) and ECS-131 (playhead), end to end on the real Launchpad profile: both render through the
 * same `createSequencerBindings()` -> `createControlSurface()` path every other sequencer configuration test uses,
 * proving the feedback a step's pad actually shows, not just the declarative binding shape (`sequencer.test.ts`
 * already covers that). Row 0 of the pad grid is notes 81-88, one pad per column 0-7 (`launchpad-mini-mk3.ts`).
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");

/** The Launchpad's RGB LED message for `led` (note or CC number), as the last one the device was sent for it, or undefined. */
function lastLed(sent: string[], led: number): string | undefined {
  const prefix = `f0 00 20 29 02 0d 03 03 ${led.toString(16).padStart(2, "0")} `;
  const matches = sent.filter((message) => message.startsWith(prefix));
  return matches[matches.length - 1];
}

const rgb = (led: number, red: number, green: number, blue: number) =>
  `f0 00 20 29 02 0d 03 03 ${led.toString(16).padStart(2, "0")} ${red.toString(16).padStart(2, "0")} ${green.toString(16).padStart(2, "0")} ${blue.toString(16).padStart(2, "0")} f7`;

/** Pad note for row 0, column `column` (0-7): row 0 is notes 81-88. */
const padNote = (column: number) => 81 + column;

function build(options: { duration?: boolean; playhead?: boolean } = { duration: true, playhead: true }, length = 8) {
  const portInfo = { name: "Launchpad Mini [MK3]", manufacturer: "Novation" };
  const midiIn = new MockMidiInput({ id: "midi-in", type: "input", ...portInfo });
  const midiOut = new MockMidiOutput({ id: "midi-out", type: "output", ...portInfo });

  const steps = Array.from({ length }, (_, column) =>
    createControl<BooleanControlDef>({ id: `step.0.${column}`, label: `Step ${column}`, kind: "boolean", default: false }),
  );
  const durations = Array.from({ length }, (_, column) =>
    createControl<NumericControlDef>({ id: `step.0.${column}.duration`, label: `Step ${column} duration`, kind: "number", min: 0, max: 1024, default: 0 }),
  );
  const playhead = createControl<NumericControlDef>({ id: "transport.playhead", label: "Playhead", kind: "number", min: -1, max: 1024, default: -1 });
  const registry = createControlRegistry([
    ...steps,
    ...durations,
    playhead,
    createControl<NumericControlDef>({ id: "steps.length", label: "length", kind: "number", min: 0, max: 1024, default: length }),
    createControl<NumericControlDef>({ id: "tracks.count", label: "tracks", kind: "number", min: 0, max: 1024, default: 1 }),
  ]);

  const contract: SequencerContract = {
    stepTemplate: "step.{row}.{column}",
    lengthControl: "steps.length",
    muteTemplate: "mute.{track}",
    trackCountControl: "tracks.count",
    actions: { play: createAction({ id: "play", label: "play" }, () => {}), stop: createAction({ id: "stop", label: "stop" }, () => {}) },
    ...(options.duration ? { stepDurationTemplate: "step.{row}.{column}.duration" } : {}),
    ...(options.playhead ? { playheadControl: "transport.playhead" } : {}),
  };
  const { bindings } = createSequencerBindings(createMidiInput(midiIn), LAUNCHPAD_MINI_MK3_PROFILE, contract);

  const surface = createControlSurface({
    profile: { ...LAUNCHPAD_MINI_MK3_PROFILE, setup: undefined },
    ports: { inputs: { "midi-in": createMidiInput(midiIn) }, outputs: { "midi-out": createMidiOutput(midiOut) } },
    bindingTable: bindings,
    context: createSurfaceContext(),
    registry,
    generate: generateControlMappings,
    initialNavigation: { mode: "steps", gridOffset: { row: 0, column: 0 } },
  });

  /** Presses and releases the steps mode's "page right" button (top-94, ECS-89), moving the window one page (8 columns). */
  const pageRight = async () => {
    midiIn.emitRawMessage(Uint8Array.of(0xb0, 94, 127));
    await flush();
    midiIn.emitRawMessage(Uint8Array.of(0xb0, 94, 0));
    await flush();
  };

  return { surface, steps, durations, playhead, pageRight, sent: () => midiOut.sentMessages.map(hex) };
}

describe("step duration feedback on the Launchpad (ECS-127)", () => {
  it("lights only the active pad, at full colour, for a one-step note", async () => {
    const { surface, steps, sent } = build();
    steps[2]!.setValue(true);
    await surface.attach();

    expect(lastLed(sent(), padNote(2))).toBe(rgb(padNote(2), 0, 0, 127));
    expect(lastLed(sent(), padNote(1))).toBe(rgb(padNote(1), 0, 0, 0));
    expect(lastLed(sent(), padNote(3))).toBe(rgb(padNote(3), 0, 0, 0));
    await surface.detach();
  });

  it("lights each of several independent one-step notes on its own pad, with nothing between them", async () => {
    const { surface, steps, sent } = build();
    steps[0]!.setValue(true);
    steps[3]!.setValue(true);
    await surface.attach();

    expect(lastLed(sent(), padNote(0))).toBe(rgb(padNote(0), 0, 0, 127));
    expect(lastLed(sent(), padNote(3))).toBe(rgb(padNote(3), 0, 0, 127));
    expect(lastLed(sent(), padNote(1))).toBe(rgb(padNote(1), 0, 0, 0));
    expect(lastLed(sent(), padNote(2))).toBe(rgb(padNote(2), 0, 0, 0));
    await surface.detach();
  });

  it("shows a one-bar note as its own colour followed by dimmed continuation pads, and repaints when the duration changes", async () => {
    const { surface, steps, durations, sent } = build();
    steps[0]!.setValue(true);
    durations[0]!.setValue(4);
    await surface.attach();

    expect(lastLed(sent(), padNote(0))).toBe(rgb(padNote(0), 0, 0, 127)); // the originating step keeps its own colour
    expect(lastLed(sent(), padNote(1))).toBe(rgb(padNote(1), 0, 0, 32)); // continuation: a quarter of steps' blue
    expect(lastLed(sent(), padNote(2))).toBe(rgb(padNote(2), 0, 0, 32));
    expect(lastLed(sent(), padNote(3))).toBe(rgb(padNote(3), 0, 0, 32));
    expect(lastLed(sent(), padNote(4))).toBe(rgb(padNote(4), 0, 0, 0)); // outside the 4-step span

    durations[0]!.setValue(2); // shortening the note un-covers pad 2 and 3 live, without a page turn
    expect(lastLed(sent(), padNote(1))).toBe(rgb(padNote(1), 0, 0, 32));
    expect(lastLed(sent(), padNote(2))).toBe(rgb(padNote(2), 0, 0, 0));
    expect(lastLed(sent(), padNote(3))).toBe(rgb(padNote(3), 0, 0, 0));
    await surface.detach();
  });

  it("covers every pad up to the end of the available (8-wide) page, with no error", async () => {
    const { surface, steps, durations, sent } = build();
    steps[0]!.setValue(true);
    durations[0]!.setValue(8);
    await surface.attach();

    for (let column = 1; column < 8; column++) {
      expect(lastLed(sent(), padNote(column))).toBe(rgb(padNote(column), 0, 0, 32));
    }
    await surface.detach();
  });

  it("does not modify any step or duration control while painting", async () => {
    const { surface, steps, durations } = build();
    steps[0]!.setValue(true);
    durations[0]!.setValue(4);
    await surface.attach();

    expect(steps.map((step) => step.getValue())).toEqual([true, false, false, false, false, false, false, false]);
    expect(durations[0]!.getValue()).toBe(4);
    await surface.detach();
  });

  it("re-targets its continuation scan to the new page, not the one it left (ECS-89 paging)", async () => {
    const { surface, steps, durations, pageRight, sent } = build({ duration: true }, 16);
    steps[0]!.setValue(true);
    durations[0]!.setValue(4); // on page 0, covers virtual columns 1-3 (pad-82..pad-84)
    steps[8]!.setValue(true); // on page 1 (virtual column 8), no duration: a plain one-step note
    await surface.attach();
    expect(lastLed(sent(), padNote(1))).toBe(rgb(padNote(1), 0, 0, 32));

    await pageRight(); // offset.column: 0 -> 8; pad-81..88 now show virtual columns 8-15
    expect(lastLed(sent(), padNote(0))).toBe(rgb(padNote(0), 0, 0, 127)); // virtual column 8: steps[8]
    expect(lastLed(sent(), padNote(1))).toBe(rgb(padNote(1), 0, 0, 0)); // virtual column 9: no longer page 0's continuation

    steps[0]!.setValue(false); // changing the page-0 step must not reach a pad that no longer represents it
    expect(lastLed(sent(), padNote(0))).toBe(rgb(padNote(0), 0, 0, 127));
    await surface.detach();
  });

  it("keeps showing continuation feedback on the next page for a duration that spans the page boundary (ECS-147)", async () => {
    const { surface, steps, durations, pageRight, sent } = build({ duration: true }, 16);
    steps[6]!.setValue(true); // virtual column 6, near the end of page 0
    durations[6]!.setValue(4); // covers virtual columns 7-9, past the page 0/1 boundary at column 8
    await surface.attach();
    expect(lastLed(sent(), padNote(7))).toBe(rgb(padNote(7), 0, 0, 32)); // virtual column 7: still on page 0

    await pageRight(); // offset.column: 0 -> 8; pad-81..88 now show virtual columns 8-15
    expect(lastLed(sent(), padNote(0))).toBe(rgb(padNote(0), 0, 0, 32)); // virtual column 8: steps[6]'s duration still reaches here
    expect(lastLed(sent(), padNote(1))).toBe(rgb(padNote(1), 0, 0, 32)); // virtual column 9: last covered column
    expect(lastLed(sent(), padNote(2))).toBe(rgb(padNote(2), 0, 0, 0)); // virtual column 10: outside the 4-step span
    await surface.detach();
  });

  it("keeps showing continuation feedback two page turns after the originating note, for a note long enough to span both boundaries (ECS-147 follow-up)", async () => {
    const { surface, steps, durations, pageRight, sent } = build({ duration: true }, 32);
    steps[0]!.setValue(true); // virtual column 0
    durations[0]!.setValue(20); // covers virtual columns 1-19, spanning the page 0/1 boundary (8) and the page 1/2 boundary (16)
    await surface.attach();

    await pageRight(); // offset.column: 0 -> 8
    await pageRight(); // offset.column: 8 -> 16; pad-81..88 now show virtual columns 16-23, two pages from the note's own
    expect(lastLed(sent(), padNote(0))).toBe(rgb(padNote(0), 0, 0, 32)); // virtual column 16: still within the 20-step span
    expect(lastLed(sent(), padNote(3))).toBe(rgb(padNote(3), 0, 0, 32)); // virtual column 19: last covered column
    expect(lastLed(sent(), padNote(4))).toBe(rgb(padNote(4), 0, 0, 0)); // virtual column 20: outside the 20-step span
    await surface.detach();
  });

  it("shows no continuation feedback at all when the contract names no duration control", async () => {
    const { surface, steps, sent } = build({ duration: false, playhead: false });
    steps[0]!.setValue(true);
    await surface.attach();

    expect(lastLed(sent(), padNote(0))).toBe(rgb(padNote(0), 0, 0, 127));
    expect(lastLed(sent(), padNote(1))).toBe(rgb(padNote(1), 0, 0, 0));
    await surface.detach();
  });
});

describe("playhead feedback on the Launchpad (ECS-131)", () => {
  it("leaves every pad in its own, sensible state while stopped (playhead at the sentinel), rather than showing a stray lit pad", async () => {
    const { surface, steps, sent } = build();
    steps[2]!.setValue(true); // playhead defaults to -1, matching no column
    await surface.attach();

    expect(lastLed(sent(), padNote(2))).toBe(rgb(padNote(2), 0, 0, 127)); // the step's own colour, not the playhead's
    expect(lastLed(sent(), padNote(0))).toBe(rgb(padNote(0), 0, 0, 0));
    await surface.detach();
  });

  it("lights the playhead's column in white, distinguishable from an inactive step, and moves as playback progresses", async () => {
    const { surface, playhead, sent } = build();
    await surface.attach();
    playhead.setValue(0);
    expect(lastLed(sent(), padNote(0))).toBe(rgb(padNote(0), 127, 127, 127));

    playhead.setValue(3); // playback advances: the old pad returns to its correct (inactive) state, not just "off" by coincidence
    expect(lastLed(sent(), padNote(0))).toBe(rgb(padNote(0), 0, 0, 0));
    expect(lastLed(sent(), padNote(3))).toBe(rgb(padNote(3), 127, 127, 127));
    await surface.detach();
  });

  it("stays distinguishable from an active step: the playhead's colour wins over the step's own", async () => {
    const { surface, steps, playhead, sent } = build();
    steps[5]!.setValue(true);
    await surface.attach();
    expect(lastLed(sent(), padNote(5))).toBe(rgb(padNote(5), 0, 0, 127));

    playhead.setValue(5);
    expect(lastLed(sent(), padNote(5))).toBe(rgb(padNote(5), 127, 127, 127));

    playhead.setValue(-1); // stopping restores the step's own colour, since nothing clears the step itself
    expect(lastLed(sent(), padNote(5))).toBe(rgb(padNote(5), 0, 0, 127));
    await surface.detach();
  });

  it("stays distinguishable from a duration continuation pad: the playhead's colour wins there too", async () => {
    const { surface, steps, durations, playhead, sent } = build();
    steps[0]!.setValue(true);
    durations[0]!.setValue(4);
    await surface.attach();
    expect(lastLed(sent(), padNote(2))).toBe(rgb(padNote(2), 0, 0, 32)); // continuation, before the playhead reaches it

    playhead.setValue(2);
    expect(lastLed(sent(), padNote(2))).toBe(rgb(padNote(2), 127, 127, 127));

    playhead.setValue(3);
    expect(lastLed(sent(), padNote(2))).toBe(rgb(padNote(2), 0, 0, 32)); // moved on: back to its continuation colour
    await surface.detach();
  });

  it("introduces no second clock of its own: the pad only ever changes when the playhead control itself does", async () => {
    const { surface, playhead, sent } = build();
    await surface.attach();
    playhead.setValue(1);
    const afterFirstMove = sent().filter((message) => message.startsWith("f0 00 20 29 02 0d 03 03")).length;

    await flush();
    await flush();
    expect(sent().filter((message) => message.startsWith("f0 00 20 29 02 0d 03 03")).length).toBe(afterFirstMove);
    await surface.detach();
  });

  it("follows the playhead's absolute column across a page turn (ECS-89 paging)", async () => {
    const { surface, playhead, pageRight, sent } = build({ playhead: true }, 16);
    await surface.attach();
    playhead.setValue(3);
    expect(lastLed(sent(), padNote(3))).toBe(rgb(padNote(3), 127, 127, 127));

    await pageRight(); // offset.column: 0 -> 8; column 3 is no longer on this page
    expect(lastLed(sent(), padNote(3))).toBe(rgb(padNote(3), 0, 0, 0));

    playhead.setValue(11); // column 11 is pad-4 on this page (offset 8 + column 3)
    expect(lastLed(sent(), padNote(3))).toBe(rgb(padNote(3), 127, 127, 127));
    await surface.detach();
  });

  it("shows no playhead feedback at all when the contract names no playhead control", async () => {
    const { surface, sent } = build({ duration: false, playhead: false });
    await surface.attach();

    expect(lastLed(sent(), padNote(0))).toBe(rgb(padNote(0), 0, 0, 0));
    await surface.detach();
  });
});
