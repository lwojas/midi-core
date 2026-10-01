import { describe, expect, it } from "vitest";
import type { BooleanControlDef, EnumControlDef, NumericControlDef } from "../control-api/types/control.js";
import type { MidiMessage } from "../core/types/message.js";
import type { MidiSource, MidiTarget } from "./types/address.js";
import { buildFeedbackMessage, resolveIncomingValue } from "./value.js";

const cutoff: NumericControlDef = {
  id: "fx.filter.cutoff",
  label: "Cutoff",
  kind: "number",
  min: 40,
  max: 18000,
  step: 1,
  unit: "Hz",
  default: 18000,
};

const volume: NumericControlDef = {
  id: "track.1.volume",
  label: "Volume",
  kind: "number",
  min: 0,
  max: 1,
  default: 0.8,
};

const muted: BooleanControlDef = {
  id: "track.1.muted",
  label: "Mute",
  kind: "boolean",
  default: false,
};

const filterMode: EnumControlDef = {
  id: "fx.filter.mode",
  label: "Filter mode",
  kind: "enum",
  options: [
    { label: "Low pass", value: "lowpass" },
    { label: "Band pass", value: "bandpass" },
    { label: "High pass", value: "highpass" },
  ],
  default: "lowpass",
};

describe("resolveIncomingValue — control-change", () => {
  const source: MidiSource = { address: { type: "control-change", controller: 74 }, channel: 0 };

  it("scales a CC value onto a numeric control's range", () => {
    const message: MidiMessage = { type: "control-change", channel: 0, controller: 74, value: 0 };
    expect(resolveIncomingValue(message, source, cutoff)).toBe(40);

    const max: MidiMessage = { type: "control-change", channel: 0, controller: 74, value: 127 };
    expect(resolveIncomingValue(max, source, cutoff)).toBe(18000);
  });

  it("snaps a scaled numeric value onto the declared step", () => {
    const message: MidiMessage = { type: "control-change", channel: 0, controller: 74, value: 1 };
    const value = resolveIncomingValue(message, source, cutoff);
    expect(Number.isInteger(value)).toBe(true);
  });

  it("thresholds a CC value onto a boolean control at the midpoint", () => {
    const low: MidiMessage = { type: "control-change", channel: 0, controller: 74, value: 63 };
    const high: MidiMessage = { type: "control-change", channel: 0, controller: 74, value: 64 };
    expect(resolveIncomingValue(low, source, muted)).toBe(false);
    expect(resolveIncomingValue(high, source, muted)).toBe(true);
  });

  it("buckets a CC value onto an enum control's options", () => {
    const first: MidiMessage = { type: "control-change", channel: 0, controller: 74, value: 0 };
    const last: MidiMessage = { type: "control-change", channel: 0, controller: 74, value: 127 };
    expect(resolveIncomingValue(first, source, filterMode)).toBe("lowpass");
    expect(resolveIncomingValue(last, source, filterMode)).toBe("highpass");
  });

  it("returns undefined when the message doesn't match the source", () => {
    const message: MidiMessage = { type: "control-change", channel: 0, controller: 75, value: 100 };
    expect(resolveIncomingValue(message, source, cutoff)).toBeUndefined();
  });
});

describe("resolveIncomingValue — pitch-bend", () => {
  const source: MidiSource = { address: { type: "pitch-bend" }, channel: 0 };

  it("scales pitch bend onto a numeric control's range", () => {
    const center: MidiMessage = { type: "pitch-bend", channel: 0, value: 8192 };
    expect(resolveIncomingValue(center, source, volume)).toBeCloseTo(0.5, 2);
  });

  it("returns undefined for a non-numeric control", () => {
    const message: MidiMessage = { type: "pitch-bend", channel: 0, value: 8192 };
    expect(resolveIncomingValue(message, source, muted)).toBeUndefined();
  });
});

describe("resolveIncomingValue — note", () => {
  const source: MidiSource = { address: { type: "note", note: 36 }, channel: 0 };

  it("resolves note-on to true and note-off to false", () => {
    const on: MidiMessage = { type: "note-on", channel: 0, note: 36, velocity: 127 };
    const off: MidiMessage = { type: "note-off", channel: 0, note: 36, velocity: 0 };
    expect(resolveIncomingValue(on, source, muted)).toBe(true);
    expect(resolveIncomingValue(off, source, muted)).toBe(false);
  });

  it("returns undefined for a non-boolean control", () => {
    const on: MidiMessage = { type: "note-on", channel: 0, note: 36, velocity: 127 };
    expect(resolveIncomingValue(on, source, cutoff)).toBeUndefined();
  });
});

describe("buildFeedbackMessage — control-change", () => {
  const target: MidiTarget = { address: { type: "control-change", controller: 74 }, channel: 0 };

  it("scales a numeric control's value back onto the CC range", () => {
    expect(buildFeedbackMessage(target, cutoff, 40)).toEqual({
      type: "control-change",
      channel: 0,
      controller: 74,
      value: 0,
    });
    expect(buildFeedbackMessage(target, cutoff, 18000)).toEqual({
      type: "control-change",
      channel: 0,
      controller: 74,
      value: 127,
    });
  });

  it("maps a boolean control's value to the CC extremes", () => {
    expect(buildFeedbackMessage(target, muted, true)).toMatchObject({ value: 127 });
    expect(buildFeedbackMessage(target, muted, false)).toMatchObject({ value: 0 });
  });

  it("maps an enum control's option back to a representative CC value", () => {
    const message = buildFeedbackMessage(target, filterMode, "bandpass");
    expect(message).toMatchObject({ type: "control-change", channel: 0, controller: 74 });
    expect((message as { value: number }).value).toBeGreaterThan(0);
    expect((message as { value: number }).value).toBeLessThan(127);
  });

  it("returns undefined for a value that isn't a declared option", () => {
    expect(buildFeedbackMessage(target, filterMode, "notch")).toBeUndefined();
  });
});

describe("buildFeedbackMessage — pitch-bend", () => {
  const target: MidiTarget = { address: { type: "pitch-bend" }, channel: 0 };

  it("scales a numeric control's value onto the pitch bend range", () => {
    expect(buildFeedbackMessage(target, volume, 0.5)).toEqual({
      type: "pitch-bend",
      channel: 0,
      value: 8192,
    });
  });

  it("returns undefined for a non-numeric control", () => {
    expect(buildFeedbackMessage(target, muted, true)).toBeUndefined();
  });
});

describe("buildFeedbackMessage — note", () => {
  const target: MidiTarget = { address: { type: "note", note: 36 }, channel: 0 };

  it("maps a boolean control's value to note-on/note-off", () => {
    expect(buildFeedbackMessage(target, muted, true)).toEqual({
      type: "note-on",
      channel: 0,
      note: 36,
      velocity: 127,
    });
    expect(buildFeedbackMessage(target, muted, false)).toEqual({
      type: "note-off",
      channel: 0,
      note: 36,
      velocity: 0,
    });
  });

  it("returns undefined for a non-boolean control", () => {
    expect(buildFeedbackMessage(target, cutoff, 100)).toBeUndefined();
  });
});
