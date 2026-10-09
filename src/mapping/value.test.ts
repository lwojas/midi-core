import { describe, expect, it } from "vitest";
import type { BooleanControlDef, EnumControlDef, NumericControlDef } from "../control-api/types/control.js";
import type { MidiMessage } from "../core/types/message.js";
import type { MidiSource, MidiTarget } from "./types/address.js";
import { buildFeedbackMessage, decodeRelativeDelta, resolveIncomingValue } from "./value.js";

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

describe("decodeRelativeDelta — twos-complement-7bit (ECS-137)", () => {
  it.each([
    [0, 0],
    [1, 1],
    [2, 2],
    [63, 63],
    [64, -64],
    [65, -63],
    [127, -1],
    [126, -2],
  ])("decodes raw %i to delta %i", (raw, delta) => {
    expect(decodeRelativeDelta(raw, "twos-complement-7bit")).toBe(delta);
  });
});

describe("resolveIncomingValue — relative control-change (ECS-137)", () => {
  const source: MidiSource = { address: { type: "control-change", controller: 71 }, channel: 0 };
  const level: NumericControlDef = { id: "mixer.send.1", label: "Send 1", kind: "number", min: 0, max: 127, step: 1, default: 64 };

  it("accumulates a positive delta onto the control's current value, not the raw byte", () => {
    const message: MidiMessage = { type: "control-change", channel: 0, controller: 71, value: 2 };
    const result = resolveIncomingValue(message, source, level, { encoding: "twos-complement-7bit", current: 64 });
    expect(result).toBe(66);
  });

  it("accumulates a negative delta (the two's-complement half of the byte range)", () => {
    const message: MidiMessage = { type: "control-change", channel: 0, controller: 71, value: 127 };
    const result = resolveIncomingValue(message, source, level, { encoding: "twos-complement-7bit", current: 64 });
    expect(result).toBe(63);
  });

  it("clamps at the control's max rather than overflowing", () => {
    const message: MidiMessage = { type: "control-change", channel: 0, controller: 71, value: 10 };
    const result = resolveIncomingValue(message, source, level, { encoding: "twos-complement-7bit", current: 120 });
    expect(result).toBe(127);
  });

  it("clamps at the control's min rather than underflowing", () => {
    const message: MidiMessage = { type: "control-change", channel: 0, controller: 71, value: 127 };
    const result = resolveIncomingValue(message, source, level, { encoding: "twos-complement-7bit", current: 0 });
    expect(result).toBe(0);
  });

  it("returns undefined for a non-numeric control -- a relative delta onto a boolean/enum isn't a modeled pairing", () => {
    const message: MidiMessage = { type: "control-change", channel: 0, controller: 71, value: 2 };
    expect(resolveIncomingValue(message, source, muted, { encoding: "twos-complement-7bit", current: false })).toBeUndefined();
  });

  it("still returns undefined for a non-matching source, exactly as the non-relative path does", () => {
    const message: MidiMessage = { type: "control-change", channel: 0, controller: 72, value: 2 };
    expect(resolveIncomingValue(message, source, level, { encoding: "twos-complement-7bit", current: 64 })).toBeUndefined();
  });

  it("regression: omitting `relative` resolves the same CC via the existing direct-scaling path, unchanged", () => {
    const message: MidiMessage = { type: "control-change", channel: 0, controller: 71, value: 2 };
    // Direct scaling, not accumulation: raw 2 onto a 0-127 range is just 2, regardless of any "current" value.
    expect(resolveIncomingValue(message, source, level)).toBe(2);
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

  it("resolves note-on with velocity 0 to false (a release, as Launchpad-style devices send it)", () => {
    const releaseAsNoteOn: MidiMessage = { type: "note-on", channel: 0, note: 36, velocity: 0 };
    expect(resolveIncomingValue(releaseAsNoteOn, source, muted)).toBe(false);
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

describe("buildFeedbackMessage — dim/full two-tier feedback (ECS-145)", () => {
  it("control-change: renders false as dimValue and true as the native max, when dimValue is declared", () => {
    const target: MidiTarget = { address: { type: "control-change", controller: 85 }, channel: 0, dimValue: 1 };
    expect(buildFeedbackMessage(target, muted, false)).toEqual({ type: "control-change", channel: 0, controller: 85, value: 1 });
    expect(buildFeedbackMessage(target, muted, true)).toEqual({ type: "control-change", channel: 0, controller: 85, value: 127 });
  });

  it("control-change: falls back to plain 0/127 when dimValue is omitted, exactly as before this field existed", () => {
    const target: MidiTarget = { address: { type: "control-change", controller: 85 }, channel: 0 };
    expect(buildFeedbackMessage(target, muted, false)).toMatchObject({ value: 0 });
    expect(buildFeedbackMessage(target, muted, true)).toMatchObject({ value: 127 });
  });

  it("control-change: dimValue has no effect on a non-boolean control", () => {
    const target: MidiTarget = { address: { type: "control-change", controller: 74 }, channel: 0, dimValue: 1 };
    expect(buildFeedbackMessage(target, cutoff, 40)).toMatchObject({ value: 0 });
  });

  it("note: renders false as a low-velocity note-on (not note-off) when dimValue is declared", () => {
    const target: MidiTarget = { address: { type: "note", note: 36 }, channel: 0, dimValue: 1 };
    expect(buildFeedbackMessage(target, muted, false)).toEqual({ type: "note-on", channel: 0, note: 36, velocity: 1 });
    expect(buildFeedbackMessage(target, muted, true)).toEqual({ type: "note-on", channel: 0, note: 36, velocity: 127 });
  });

  it("note: falls back to note-on/note-off when dimValue is omitted, exactly as before this field existed", () => {
    const target: MidiTarget = { address: { type: "note", note: 36 }, channel: 0 };
    expect(buildFeedbackMessage(target, muted, false)).toEqual({ type: "note-off", channel: 0, note: 36, velocity: 0 });
  });
});

describe("buildFeedbackMessage — rgb-led (ECS-95)", () => {
  const lamp: BooleanControlDef = { id: "lamp", label: "Lamp", kind: "boolean", default: false };
  const target: MidiTarget = {
    address: { type: "note", note: 51 },
    channel: 0,
    rgbPrefix: [0x00, 0x20, 0x29, 0x02, 0x0d, 0x03, 0x03],
  };

  it("sends a device SysEx with the LED index and the lit colour when on", () => {
    expect(buildFeedbackMessage(target, lamp, true, { red: 0, green: 0, blue: 127 })).toEqual({
      type: "sysex",
      raw: Uint8Array.of(0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x03, 0x03, 51, 0, 0, 127, 0xf7),
    });
  });

  it("sends black when off, whatever colour the control was lit with", () => {
    expect(buildFeedbackMessage(target, lamp, false, { red: 127, green: 0, blue: 0 })).toEqual({
      type: "sysex",
      raw: Uint8Array.of(0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x03, 0x03, 51, 0, 0, 0, 0xf7),
    });
  });

  it("lights white when on with no colour of its own", () => {
    const message = buildFeedbackMessage(target, lamp, true);
    expect(message && message.type === "sysex" ? Array.from(message.raw) : undefined).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x03, 0x03, 51, 127, 127, 127, 0xf7]);
  });

  it("uses a control-change LED index for a controller button", () => {
    const button: MidiTarget = { address: { type: "control-change", controller: 91 }, channel: 0, rgbPrefix: [0x00, 0x20, 0x29, 0x02, 0x0d, 0x03, 0x03] };
    const raw = buildFeedbackMessage(button, lamp, true, { red: 0, green: 127, blue: 0 });
    expect(raw && raw.type === "sysex" ? Array.from(raw.raw).slice(8, 12) : undefined).toEqual([91, 0, 127, 0]);
  });

  it("has no RGB form for a non-boolean control, so a number sends nothing", () => {
    const level: NumericControlDef = { id: "level", label: "Level", kind: "number", min: 0, max: 127, default: 0 };
    expect(buildFeedbackMessage(target, level, 50)).toBeUndefined();
  });
});
