import { describe, expect, it } from "vitest";
import {
  isChannel,
  isDataByte,
  isMidiMessageType,
  isPitchBendValue,
  MIDI_MESSAGE_TYPES,
  PITCH_BEND_CENTER,
  PITCH_BEND_MAX,
  PITCH_BEND_MIN,
} from "./message.js";

describe("isChannel", () => {
  it("accepts 0-15", () => {
    expect(isChannel(0)).toBe(true);
    expect(isChannel(15)).toBe(true);
  });

  it("rejects out-of-range or non-integer values", () => {
    expect(isChannel(-1)).toBe(false);
    expect(isChannel(16)).toBe(false);
    expect(isChannel(1.5)).toBe(false);
    expect(isChannel("1")).toBe(false);
  });
});

describe("isDataByte", () => {
  it("accepts 0-127", () => {
    expect(isDataByte(0)).toBe(true);
    expect(isDataByte(127)).toBe(true);
  });

  it("rejects out-of-range or non-integer values", () => {
    expect(isDataByte(-1)).toBe(false);
    expect(isDataByte(128)).toBe(false);
    expect(isDataByte(63.5)).toBe(false);
  });
});

describe("isPitchBendValue", () => {
  it("accepts the full 14-bit range and the documented center", () => {
    expect(isPitchBendValue(PITCH_BEND_MIN)).toBe(true);
    expect(isPitchBendValue(PITCH_BEND_MAX)).toBe(true);
    expect(isPitchBendValue(PITCH_BEND_CENTER)).toBe(true);
  });

  it("rejects out-of-range values", () => {
    expect(isPitchBendValue(-1)).toBe(false);
    expect(isPitchBendValue(16384)).toBe(false);
  });
});

describe("isMidiMessageType", () => {
  it("accepts every declared type", () => {
    for (const type of MIDI_MESSAGE_TYPES) {
      expect(isMidiMessageType(type)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isMidiMessageType("aftertouch")).toBe(false);
    expect(isMidiMessageType(1)).toBe(false);
  });
});
