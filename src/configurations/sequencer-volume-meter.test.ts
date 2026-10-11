import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAction } from "../control-api/action.js";
import { createControl } from "../control-api/control.js";
import { createSurfaceContext } from "../control-api/context.js";
import { createControlRegistry } from "../control-api/registry.js";
import type { EnumControlDef, NumericControlDef } from "../control-api/types/control.js";
import { MockMidiInput } from "../adapters/mock/mock-input.js";
import { MockMidiOutput } from "../adapters/mock/mock-output.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import { PUSH_MK1_DISPLAY, PUSH_MK1_PROFILE } from "../profile/devices/push-mk1.js";
import { DISPLAY_LINE_MIN_INTERVAL_MS } from "../surface/display-binding.js";
import { generateControlMappings } from "../surface/generate.js";
import { createControlSurface } from "../surface/runtime.js";
import { createSequencerBindings, type SequencerContract } from "./sequencer.js";

/**
 * The Push mk1's top LCD line as a per-track volume meter while the Volume category is live, and the display/encoder
 * traffic of the interactions around it: rapid turns, selection + Devices button + turn, and FX encoder scaling.
 * Every value shown is read from the same controls the encoders write; nothing here is display-only state.
 */

const LINE_1 = 0x18;
const ENCODER_CCS = [71, 72, 73, 74, 75, 76, 77, 78];
const VOLUME_MODE_CC = 114;
const DEVICES_MODE_CC = 110;

const volumeDef = (id: string): NumericControlDef => ({ id, label: "Volume", kind: "number", min: 0, max: 100, step: 1, default: 50 });

function build() {
  const portInfo = { name: "Ableton Push", manufacturer: "Ableton" };
  const midiIn = new MockMidiInput({ id: "user-port-in", type: "input", ...portInfo });
  const midiOut = new MockMidiOutput({ id: "user-port-out", type: "output", ...portInfo });

  const volumes = Array.from({ length: 8 }, (_, i) => createControl(volumeDef(`track.${i + 1}.volume`), 50));
  const names = Array.from({ length: 8 }, (_, i) => createControl({ id: `track.${i + 1}.name`, label: "Name", kind: "string", default: "" }, `Track ${i + 1}`));
  const encoderMode = createControl({ id: "encoder.mode", label: "Mode", kind: "number", min: 0, max: 1, default: 0 } satisfies NumericControlDef, 0);
  const cutoff = createControl({ id: "fx.selected.param.0", label: "Cutoff", kind: "number", min: 40, max: 18000, step: 1, unit: "Hz", default: 18000 } satisfies NumericControlDef, 18000);
  const mode = createControl({ id: "fx.selected.param.1", label: "Mode", kind: "number", min: 0, max: 1, step: 1, default: 0 } satisfies NumericControlDef, 0);
  const shapeDef: EnumControlDef = {
    id: "fx.selected.param.2",
    label: "Shape",
    kind: "enum",
    options: [
      { label: "Sine", value: "sine" },
      { label: "Square", value: "square" },
    ],
    default: "sine",
  };
  const shape = createControl(shapeDef, "sine");
  const on = createControl({ id: "fx.selected.param.3", label: "On", kind: "boolean", default: false }, false);
  const registry = createControlRegistry([...volumes, ...names, encoderMode, cutoff, mode, shape, on]);
  const context = createSurfaceContext([{ scope: "track", id: "1" }]);

  const contract: SequencerContract = {
    stepTemplate: "step.{row}.{column}",
    lengthControl: "steps.length",
    muteTemplate: "mute.{track}",
    trackCountControl: "tracks.count",
    actions: {},
    selectionIndexControl: "selection.index",
    displayLines: { track: { kind: "from-selection", scope: "track", template: "track.{id}.name" } },
    encoderBankTemplates: { volume: "track.{track}.volume", devices: "fx.selected.param.{row}" },
    encoderBankModeControl: "encoder.mode",
    encoderBankModes: { volume: 0, devices: 1 },
    encoderBankModeActions: {
      volume: createAction({ id: "encoder-mode.volume", label: "Volume" }, () => encoderMode.setValue(0)),
      devices: createAction({ id: "encoder-mode.devices", label: "Devices" }, () => encoderMode.setValue(1)),
    },
  };
  const { bindings, unresolved } = createSequencerBindings(createMidiInput(midiIn), PUSH_MK1_PROFILE, contract);
  const surface = createControlSurface({
    profile: { ...PUSH_MK1_PROFILE, setup: undefined },
    ports: { inputs: { "user-port-in": createMidiInput(midiIn) }, outputs: { "user-port-out": createMidiOutput(midiOut) } },
    bindingTable: bindings,
    context,
    registry,
    generate: generateControlMappings,
    initialNavigation: { mode: "steps", gridOffset: { row: 0, column: 0 } },
  });

  const settle = () => vi.advanceTimersByTimeAsync(0);
  /** One relative encoder message: `raw` is the CC byte (1 = one detent clockwise, 127 = one counter-clockwise). */
  const turn = async (controller: number, raw: number) => {
    midiIn.emitRawMessage(new Uint8Array([0xb0, controller, raw]));
    await settle();
  };
  const press = async (controller: number) => {
    midiIn.emitRawMessage(new Uint8Array([0xb0, controller, 127]));
    await settle();
    midiIn.emitRawMessage(new Uint8Array([0xb0, controller, 0]));
    await settle();
  };

  /** Every LCD write to `lineId`, as its 68 characters. */
  const writes = (lineId: number) =>
    midiOut.sentMessages
      .filter((bytes) => bytes[0] === 0xf0 && bytes[4] === lineId)
      .map((bytes) => String.fromCharCode(...bytes.slice(8, 8 + 68)));

  return { surface, unresolved, turn, press, settle, writes, volumes, encoderMode, cutoff, mode, shape, on, context, midiOut };
}

const last = <T>(items: readonly T[]): T => items[items.length - 1]!;

/** Segment `index` of a line's text, per the display's declared layout. */
const segment = (text: string, index: number) => {
  const { width, offsets } = PUSH_MK1_DISPLAY.segments!;
  return text.slice(offsets[index]!, offsets[index]! + width);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("volume meter on the Push mk1's top display line", () => {
  it("resolves with nothing unresolved, and draws each track's volume above its encoder on attach", async () => {
    const { surface, unresolved, writes, volumes } = build();
    await surface.attach();

    expect(unresolved).toEqual([]);
    const text = last(writes(LINE_1));
    expect(text).toHaveLength(68);
    for (let index = 0; index < 8; index += 1) expect(segment(text, index)).toBe("[===   ]"); // 50 of 0-100 = half
    expect(volumes[0]!.getValue()).toBe(50);
    await surface.detach();
  });

  it("tracks the authoritative volume: empty at the minimum, full at the maximum, a half cell in between", async () => {
    const { surface, writes, volumes } = build();
    await surface.attach();

    volumes[0]!.setValue(0);
    volumes[1]!.setValue(100);
    volumes[2]!.setValue(58); // 0.58 * 12 half-steps = 6.96 -> 7: three full cells and a half
    await vi.advanceTimersByTimeAsync(DISPLAY_LINE_MIN_INTERVAL_MS);

    const text = last(writes(LINE_1));
    expect(segment(text, 0)).toBe("[      ]");
    expect(segment(text, 1)).toBe("[======]");
    expect(segment(text, 2)).toBe("[===-  ]");
    expect(segment(text, 3)).toBe("[===   ]"); // untouched
    await surface.detach();
  });

  it("is driven by the encoder: one turn moves the bar, via the same control the mixer reads", async () => {
    const { surface, writes, turn, volumes } = build();
    await surface.attach();

    await turn(ENCODER_CCS[2]!, 20); // 20 detents clockwise on track 3
    await vi.advanceTimersByTimeAsync(DISPLAY_LINE_MIN_INTERVAL_MS);

    expect(volumes[2]!.getValue()).toBe(70);
    expect(segment(last(writes(LINE_1)), 2)).toBe("[====  ]"); // 0.70 * 12 = 8.4 -> 8 halves = 4 full cells
    await surface.detach();
  });

  it("sends nothing when a change doesn't alter any bar's glyphs", async () => {
    const { surface, writes, turn } = build();
    await surface.attach();
    const before = writes(LINE_1).length;

    await turn(ENCODER_CCS[0]!, 1); // 50 -> 51: still 6 of 12 half-steps
    await vi.advanceTimersByTimeAsync(DISPLAY_LINE_MIN_INTERVAL_MS * 2);

    expect(writes(LINE_1).length).toBe(before);
    await surface.detach();
  });

  it("coalesces a rapid burst of turns into a bounded number of writes, ending on the final state", async () => {
    const { surface, writes, turn, volumes } = build();
    await surface.attach();
    const before = writes(LINE_1).length;

    // 90 consecutive detents inside one interval: far more distinct bar states than writes.
    for (let index = 0; index < 45; index += 1) await turn(ENCODER_CCS[0]!, 2);
    await vi.advanceTimersByTimeAsync(DISPLAY_LINE_MIN_INTERVAL_MS);

    expect(volumes[0]!.getValue()).toBe(100);
    const sent = writes(LINE_1).slice(before);
    expect(sent.length).toBeLessThanOrEqual(2); // the leading write, then at most one trailing write
    expect(segment(last(sent), 0)).toBe("[======]");
    await surface.detach();
  });

  it("shows the track role's text on the same line while the Devices category is live, then the bars again", async () => {
    const { surface, writes, press } = build();
    await surface.attach();

    await vi.advanceTimersByTimeAsync(DISPLAY_LINE_MIN_INTERVAL_MS);
    await press(DEVICES_MODE_CC);
    await vi.advanceTimersByTimeAsync(DISPLAY_LINE_MIN_INTERVAL_MS);
    expect(last(writes(LINE_1)).trimEnd()).toBe("Track 1");

    await press(VOLUME_MODE_CC);
    await vi.advanceTimersByTimeAsync(DISPLAY_LINE_MIN_INTERVAL_MS);
    expect(segment(last(writes(LINE_1)), 0)).toBe("[===   ]");
    await surface.detach();
  });

  it("does not repaint the line from volume changes while the Devices category is live", async () => {
    const { surface, writes, press, volumes } = build();
    await surface.attach();
    await vi.advanceTimersByTimeAsync(DISPLAY_LINE_MIN_INTERVAL_MS);
    await press(DEVICES_MODE_CC);
    await vi.advanceTimersByTimeAsync(DISPLAY_LINE_MIN_INTERVAL_MS);
    const before = writes(LINE_1).length;

    volumes[0]!.setValue(10);
    await vi.advanceTimersByTimeAsync(DISPLAY_LINE_MIN_INTERVAL_MS * 2);

    expect(writes(LINE_1).length).toBe(before);
    await surface.detach();
  });
});

describe("selection + Devices button + encoder interaction", () => {
  it("emits a bounded, ordered amount of SysEx and ends consistent with the controls", async () => {
    const { surface, press, turn, context, cutoff, midiOut } = build();
    await surface.attach();
    await vi.advanceTimersByTimeAsync(DISPLAY_LINE_MIN_INTERVAL_MS);
    const before = midiOut.sentMessages.length;

    context.setSelection({ scope: "track", id: "2" });
    await press(DEVICES_MODE_CC);
    for (let index = 0; index < 30; index += 1) await turn(ENCODER_CCS[0]!, 127);
    await vi.advanceTimersByTimeAsync(DISPLAY_LINE_MIN_INTERVAL_MS * 2);

    const lcdWrites = midiOut.sentMessages.slice(before).filter((bytes) => bytes[0] === 0xf0);
    // One line is rewritten per distinct change at most once per interval; the whole burst stays in single digits.
    expect(lcdWrites.length).toBeLessThanOrEqual(6);
    for (const bytes of lcdWrites) expect(bytes.length).toBe(77); // every write is one complete, well-formed line
    expect(cutoff.getValue()).toBeLessThan(18000);
    await surface.detach();
  });
});

describe("encoder scaling by the controls' own metadata, through the Push's Devices bank", () => {
  it("sweeps a 40-18000 Hz cutoff down from its maximum in about a hundred detents, and back", async () => {
    const { surface, press, turn, cutoff } = build();
    await surface.attach();
    await press(DEVICES_MODE_CC);

    let down = 0;
    while (cutoff.getValue() > 40 && down < 1000) {
      await turn(ENCODER_CCS[0]!, 127);
      down += 1;
    }
    expect(cutoff.getValue()).toBe(40);
    expect(down).toBeLessThan(150);

    let up = 0;
    while (cutoff.getValue() < 18000 && up < 1000) {
      await turn(ENCODER_CCS[0]!, 1);
      up += 1;
    }
    expect(cutoff.getValue()).toBe(18000);
    expect(up).toBeLessThan(150);
    await surface.detach();
  });

  it("treats a stepped 0/1 control as a discrete one: one click each way", async () => {
    const { surface, press, turn, mode } = build();
    await surface.attach();
    await press(DEVICES_MODE_CC);

    await turn(ENCODER_CCS[1]!, 1);
    expect(mode.getValue()).toBe(1);
    await turn(ENCODER_CCS[1]!, 127);
    expect(mode.getValue()).toBe(0);
    await surface.detach();
  });

  it("steps an enum and sets a boolean by direction, both previously unreachable from an encoder", async () => {
    const { surface, press, turn, shape, on } = build();
    await surface.attach();
    await press(DEVICES_MODE_CC);

    await turn(ENCODER_CCS[2]!, 1);
    expect(shape.getValue()).toBe("square");
    await turn(ENCODER_CCS[2]!, 127);
    expect(shape.getValue()).toBe("sine");

    await turn(ENCODER_CCS[3]!, 3);
    expect(on.getValue()).toBe(true);
    await turn(ENCODER_CCS[3]!, 127);
    expect(on.getValue()).toBe(false);
    await surface.detach();
  });
});
