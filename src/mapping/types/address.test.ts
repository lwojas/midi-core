import { describe, expect, it } from "vitest";
import type { MidiMessage } from "../../core/types/message.js";
import { isChannelSelector, matchesSource, type MidiSource } from "./address.js";

describe("isChannelSelector", () => {
  it("accepts a valid channel and 'any'", () => {
    expect(isChannelSelector(0)).toBe(true);
    expect(isChannelSelector(15)).toBe(true);
    expect(isChannelSelector("any")).toBe(true);
  });

  it("rejects out-of-range channels and other values", () => {
    expect(isChannelSelector(16)).toBe(false);
    expect(isChannelSelector(-1)).toBe(false);
    expect(isChannelSelector("all")).toBe(false);
    expect(isChannelSelector(undefined)).toBe(false);
  });
});

describe("matchesSource — control-change", () => {
  const source: MidiSource = { address: { type: "control-change", controller: 74 }, channel: 0 };

  it("matches a CC on the right controller and channel", () => {
    const message: MidiMessage = { type: "control-change", channel: 0, controller: 74, value: 100 };
    expect(matchesSource(message, source)).toBe(true);
  });

  it("rejects a different controller number", () => {
    const message: MidiMessage = { type: "control-change", channel: 0, controller: 75, value: 100 };
    expect(matchesSource(message, source)).toBe(false);
  });

  it("rejects a different channel", () => {
    const message: MidiMessage = { type: "control-change", channel: 1, controller: 74, value: 100 };
    expect(matchesSource(message, source)).toBe(false);
  });

  it("rejects a different message type", () => {
    const message: MidiMessage = { type: "note-on", channel: 0, note: 74, velocity: 100 };
    expect(matchesSource(message, source)).toBe(false);
  });

  it("matches any channel when the selector is 'any'", () => {
    const anySource: MidiSource = { address: { type: "control-change", controller: 74 }, channel: "any" };
    const message: MidiMessage = { type: "control-change", channel: 9, controller: 74, value: 1 };
    expect(matchesSource(message, anySource)).toBe(true);
  });
});

describe("matchesSource — note", () => {
  const source: MidiSource = { address: { type: "note", note: 36 }, channel: 0 };

  it("matches note-on and note-off for the right note", () => {
    const on: MidiMessage = { type: "note-on", channel: 0, note: 36, velocity: 127 };
    const off: MidiMessage = { type: "note-off", channel: 0, note: 36, velocity: 0 };
    expect(matchesSource(on, source)).toBe(true);
    expect(matchesSource(off, source)).toBe(true);
  });

  it("rejects a different note number", () => {
    const message: MidiMessage = { type: "note-on", channel: 0, note: 37, velocity: 127 };
    expect(matchesSource(message, source)).toBe(false);
  });
});

describe("matchesSource — pitch-bend", () => {
  const source: MidiSource = { address: { type: "pitch-bend" }, channel: 0 };

  it("matches pitch bend on the right channel", () => {
    const message: MidiMessage = { type: "pitch-bend", channel: 0, value: 8192 };
    expect(matchesSource(message, source)).toBe(true);
  });

  it("rejects a different channel", () => {
    const message: MidiMessage = { type: "pitch-bend", channel: 1, value: 8192 };
    expect(matchesSource(message, source)).toBe(false);
  });
});
