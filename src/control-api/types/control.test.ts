import { describe, expect, it } from "vitest";
import {
  CONTROL_VALUE_KINDS,
  isControlValueKind,
  isValidControlValue,
  type BooleanControlDef,
  type EnumControlDef,
  type NumericControlDef,
  type StringControlDef,
} from "./control.js";

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

const playbackStatus: EnumControlDef = {
  id: "transport.status",
  label: "Playback status",
  kind: "enum",
  options: [
    { label: "Stopped", value: "stopped" },
    { label: "Playing", value: "playing" },
    { label: "Paused", value: "paused" },
  ],
  default: "stopped",
};

const patternName: StringControlDef = {
  id: "sequencer.pattern-name",
  label: "Pattern name",
  kind: "string",
  maxLength: 16,
  default: "",
};

describe("isControlValueKind", () => {
  it("accepts every declared kind", () => {
    for (const kind of CONTROL_VALUE_KINDS) {
      expect(isControlValueKind(kind)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isControlValueKind("array")).toBe(false);
    expect(isControlValueKind(1)).toBe(false);
    expect(isControlValueKind(undefined)).toBe(false);
  });
});

describe("isValidControlValue — number", () => {
  it("accepts values within range respecting step", () => {
    expect(isValidControlValue(cutoff, 40)).toBe(true);
    expect(isValidControlValue(cutoff, 18000)).toBe(true);
    expect(isValidControlValue(cutoff, 440)).toBe(true);
  });

  it("accepts any value within range when step is omitted (continuous)", () => {
    expect(isValidControlValue(volume, 0.123456)).toBe(true);
  });

  it("rejects out-of-range values", () => {
    expect(isValidControlValue(cutoff, 39)).toBe(false);
    expect(isValidControlValue(cutoff, 18001)).toBe(false);
  });

  it("rejects values that don't land on the declared step", () => {
    expect(isValidControlValue(cutoff, 40.5)).toBe(false);
  });

  it("rejects non-numeric or non-finite values", () => {
    expect(isValidControlValue(cutoff, "440")).toBe(false);
    expect(isValidControlValue(cutoff, NaN)).toBe(false);
    expect(isValidControlValue(cutoff, Infinity)).toBe(false);
  });
});

describe("isValidControlValue — boolean", () => {
  it("accepts true and false", () => {
    expect(isValidControlValue(muted, true)).toBe(true);
    expect(isValidControlValue(muted, false)).toBe(true);
  });

  it("rejects non-boolean values", () => {
    expect(isValidControlValue(muted, 1)).toBe(false);
    expect(isValidControlValue(muted, "true")).toBe(false);
  });
});

describe("isValidControlValue — enum", () => {
  it("accepts a declared option's value", () => {
    expect(isValidControlValue(playbackStatus, "playing")).toBe(true);
  });

  it("rejects a value not among the declared options", () => {
    expect(isValidControlValue(playbackStatus, "recording")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidControlValue(playbackStatus, 1)).toBe(false);
  });
});

describe("isValidControlValue — string (ECS-137)", () => {
  it("accepts a string within maxLength", () => {
    expect(isValidControlValue(patternName, "Intro")).toBe(true);
  });

  it("accepts any length when maxLength is omitted", () => {
    const unbounded: StringControlDef = { id: "notes", label: "Notes", kind: "string", default: "" };
    expect(isValidControlValue(unbounded, "a".repeat(1000))).toBe(true);
  });

  it("rejects a string longer than maxLength", () => {
    expect(isValidControlValue(patternName, "This name is definitely too long")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidControlValue(patternName, 1)).toBe(false);
  });
});
