import { describe, expect, it } from "vitest";
import { decodeMidiMessage, encodeMidiMessage, MidiEncodeError } from "./codec.js";
import type { MidiMessage } from "../types/message.js";

describe("decodeMidiMessage", () => {
  it("decodes Note On, retaining velocity 0 as Note On (not rewritten to Note Off)", () => {
    const msg = decodeMidiMessage(Uint8Array.of(0x90, 60, 0));
    expect(msg).toMatchObject({ type: "note-on", channel: 0, note: 60, velocity: 0 });
  });

  it("decodes Note Off on a non-zero channel", () => {
    const msg = decodeMidiMessage(Uint8Array.of(0x83, 60, 64));
    expect(msg).toMatchObject({ type: "note-off", channel: 3, note: 60, velocity: 64 });
  });

  it("decodes Control Change", () => {
    const msg = decodeMidiMessage(Uint8Array.of(0xb0, 7, 100));
    expect(msg).toMatchObject({ type: "control-change", channel: 0, controller: 7, value: 100 });
  });

  it("decodes Program Change (single data byte)", () => {
    const msg = decodeMidiMessage(Uint8Array.of(0xc5, 12));
    expect(msg).toMatchObject({ type: "program-change", channel: 5, program: 12 });
  });

  it("decodes Channel Pressure (single data byte)", () => {
    const msg = decodeMidiMessage(Uint8Array.of(0xd0, 80));
    expect(msg).toMatchObject({ type: "channel-pressure", channel: 0, pressure: 80 });
  });

  it("decodes Polyphonic Key Pressure", () => {
    const msg = decodeMidiMessage(Uint8Array.of(0xa0, 60, 90));
    expect(msg).toMatchObject({ type: "poly-pressure", channel: 0, note: 60, pressure: 90 });
  });

  it("decodes Pitch Bend by combining LSB/MSB into a 14-bit value, center = 8192", () => {
    const center = decodeMidiMessage(Uint8Array.of(0xe0, 0x00, 0x40));
    expect(center).toMatchObject({ type: "pitch-bend", channel: 0, value: 8192 });

    const min = decodeMidiMessage(Uint8Array.of(0xe0, 0x00, 0x00));
    expect(min).toMatchObject({ type: "pitch-bend", value: 0 });

    const max = decodeMidiMessage(Uint8Array.of(0xe0, 0x7f, 0x7f));
    expect(max).toMatchObject({ type: "pitch-bend", value: 16383 });
  });

  it.each([
    [0xf8, "clock"],
    [0xfa, "start"],
    [0xfb, "continue"],
    [0xfc, "stop"],
  ] as const)("decodes system real-time status 0x%s as %s", (status, type) => {
    const msg = decodeMidiMessage(Uint8Array.of(status));
    expect(msg.type).toBe(type);
  });

  it("decodes SysEx as opaque, keeping the full byte range", () => {
    const bytes = Uint8Array.of(0xf0, 0x7d, 0x01, 0x02, 0xf7);
    const msg = decodeMidiMessage(bytes);
    expect(msg.type).toBe("sysex");
    expect(msg.raw).toBe(bytes);
  });

  it("falls back to unknown for unmodeled system common messages", () => {
    const msg = decodeMidiMessage(Uint8Array.of(0xf1, 0x00)); // MTC quarter frame
    expect(msg.type).toBe("unknown");
  });

  it("falls back to unknown for Active Sensing and System Reset", () => {
    expect(decodeMidiMessage(Uint8Array.of(0xfe)).type).toBe("unknown");
    expect(decodeMidiMessage(Uint8Array.of(0xff)).type).toBe("unknown");
  });

  it("is total: never throws on empty or truncated input", () => {
    expect(decodeMidiMessage(Uint8Array.of()).type).toBe("unknown");
    expect(decodeMidiMessage(Uint8Array.of(0x90)).type).toBe("unknown"); // missing data bytes
    expect(decodeMidiMessage(Uint8Array.of(0x90, 60)).type).toBe("unknown"); // missing velocity
  });

  it("falls back to unknown for out-of-range data bytes instead of throwing", () => {
    const msg = decodeMidiMessage(Uint8Array.of(0x90, 60, 255));
    expect(msg.type).toBe("unknown");
  });

  it("preserves the exact input bytes as raw for every message kind", () => {
    const bytes = Uint8Array.of(0x90, 60, 100);
    const msg = decodeMidiMessage(bytes);
    expect(msg.raw).toBe(bytes);
  });
});

describe("encodeMidiMessage", () => {
  it("encodes channel voice messages back to their wire bytes", () => {
    const cases: Array<[MidiMessage, number[]]> = [
      [{ type: "note-on", channel: 0, note: 60, velocity: 100 }, [0x90, 60, 100]],
      [{ type: "note-off", channel: 3, note: 60, velocity: 64 }, [0x83, 60, 64]],
      [{ type: "poly-pressure", channel: 0, note: 60, pressure: 90 }, [0xa0, 60, 90]],
      [{ type: "control-change", channel: 0, controller: 7, value: 100 }, [0xb0, 7, 100]],
      [{ type: "program-change", channel: 5, program: 12 }, [0xc5, 12]],
      [{ type: "channel-pressure", channel: 0, pressure: 80 }, [0xd0, 80]],
      [{ type: "pitch-bend", channel: 0, value: 8192 }, [0xe0, 0x00, 0x40]],
      [{ type: "clock" }, [0xf8]],
      [{ type: "start" }, [0xfa]],
      [{ type: "continue" }, [0xfb]],
      [{ type: "stop" }, [0xfc]],
    ];

    for (const [message, expected] of cases) {
      expect(Array.from(encodeMidiMessage(message))).toEqual(expected);
    }
  });

  it("passes SysEx and Unknown through verbatim via raw", () => {
    const sysex = Uint8Array.of(0xf0, 0x7d, 0x01, 0xf7);
    expect(encodeMidiMessage({ type: "sysex", raw: sysex })).toBe(sysex);

    const unknown = Uint8Array.of(0xfe);
    expect(encodeMidiMessage({ type: "unknown", raw: unknown })).toBe(unknown);
  });

  it("ignores a stale `raw` and always re-derives bytes from fields", () => {
    const stale = Uint8Array.of(0x90, 1, 1);
    const message: MidiMessage = { type: "note-on", channel: 0, note: 60, velocity: 100, raw: stale };
    expect(Array.from(encodeMidiMessage(message))).toEqual([0x90, 60, 100]);
  });

  it("throws MidiEncodeError on an out-of-range channel", () => {
    expect(() =>
      encodeMidiMessage({ type: "note-on", channel: 16, note: 60, velocity: 100 }),
    ).toThrow(MidiEncodeError);
  });

  it("throws MidiEncodeError on an out-of-range data byte", () => {
    expect(() =>
      encodeMidiMessage({ type: "note-on", channel: 0, note: 60, velocity: 200 }),
    ).toThrow(MidiEncodeError);
  });

  it("throws MidiEncodeError on an out-of-range pitch bend value", () => {
    expect(() => encodeMidiMessage({ type: "pitch-bend", channel: 0, value: 99999 })).toThrow(
      MidiEncodeError,
    );
  });
});

describe("round-trip", () => {
  const wireBytes: Uint8Array[] = [
    Uint8Array.of(0x90, 60, 100),
    Uint8Array.of(0x90, 60, 0),
    Uint8Array.of(0x83, 60, 64),
    Uint8Array.of(0xa4, 40, 20),
    Uint8Array.of(0xb0, 7, 100),
    Uint8Array.of(0xc5, 12),
    Uint8Array.of(0xd2, 80),
    Uint8Array.of(0xe0, 0x00, 0x40),
    Uint8Array.of(0xf8),
    Uint8Array.of(0xfa),
    Uint8Array.of(0xfb),
    Uint8Array.of(0xfc),
  ];

  it("encode(decode(bytes)) reproduces the original bytes for every modeled message", () => {
    for (const bytes of wireBytes) {
      const decoded = decodeMidiMessage(bytes);
      expect(decoded.type).not.toBe("unknown");
      expect(Array.from(encodeMidiMessage(decoded))).toEqual(Array.from(bytes));
    }
  });

  it("round-trips SysEx and unmodeled messages byte-for-byte via raw", () => {
    for (const bytes of [Uint8Array.of(0xf0, 1, 2, 0xf7), Uint8Array.of(0xff)]) {
      const decoded = decodeMidiMessage(bytes);
      expect(Array.from(encodeMidiMessage(decoded))).toEqual(Array.from(bytes));
    }
  });
});
