import {
  isChannel,
  isDataByte,
  isPitchBendValue,
  type MidiMessage,
} from "../types/message.js";

/**
 * Encoding/decoding between raw MIDI bytes and the normalized MidiMessage
 * model. This is where the raw-byte-retention decision (see message.ts)
 * actually plays out.
 */

export class MidiEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MidiEncodeError";
  }
}

const STATUS = {
  NOTE_OFF: 0x80,
  NOTE_ON: 0x90,
  POLY_PRESSURE: 0xa0,
  CONTROL_CHANGE: 0xb0,
  PROGRAM_CHANGE: 0xc0,
  CHANNEL_PRESSURE: 0xd0,
  PITCH_BEND: 0xe0,
} as const;

const SYSEX_START = 0xf0;

const SYSTEM_REAL_TIME: Readonly<Record<number, "clock" | "start" | "continue" | "stop">> = {
  0xf8: "clock",
  0xfa: "start",
  0xfb: "continue",
  0xfc: "stop",
};

/**
 * Decode a single, complete MIDI message's bytes (as delivered by e.g. a
 * Web MIDI `MIDIMessageEvent.data`) into a normalized MidiMessage.
 *
 * Total: this never throws. Anything not modeled here, or structurally
 * malformed (truncated data bytes, out-of-range values), decodes to an
 * UnknownMessage carrying the original bytes — callers always get a
 * value back regardless of what a device actually sent. Multi-message
 * buffers and running status are not handled here; callers are expected
 * to hand this one complete message at a time.
 */
export function decodeMidiMessage(bytes: Uint8Array): MidiMessage {
  const raw = bytes;
  const status = bytes[0];

  if (status === undefined || status < 0x80) {
    return { type: "unknown", raw };
  }

  if (status === SYSEX_START) {
    return { type: "sysex", raw };
  }

  const realTime = SYSTEM_REAL_TIME[status];
  if (realTime !== undefined) {
    return { type: realTime, raw };
  }

  const channel = status & 0x0f;
  const d1 = bytes[1];
  const d2 = bytes[2];

  switch (status & 0xf0) {
    case STATUS.NOTE_ON:
      if (d1 === undefined || d2 === undefined || !isDataByte(d1) || !isDataByte(d2)) break;
      return { type: "note-on", channel, note: d1, velocity: d2, raw };
    case STATUS.NOTE_OFF:
      if (d1 === undefined || d2 === undefined || !isDataByte(d1) || !isDataByte(d2)) break;
      return { type: "note-off", channel, note: d1, velocity: d2, raw };
    case STATUS.POLY_PRESSURE:
      if (d1 === undefined || d2 === undefined || !isDataByte(d1) || !isDataByte(d2)) break;
      return { type: "poly-pressure", channel, note: d1, pressure: d2, raw };
    case STATUS.CONTROL_CHANGE:
      if (d1 === undefined || d2 === undefined || !isDataByte(d1) || !isDataByte(d2)) break;
      return { type: "control-change", channel, controller: d1, value: d2, raw };
    case STATUS.PROGRAM_CHANGE:
      if (d1 === undefined || !isDataByte(d1)) break;
      return { type: "program-change", channel, program: d1, raw };
    case STATUS.CHANNEL_PRESSURE:
      if (d1 === undefined || !isDataByte(d1)) break;
      return { type: "channel-pressure", channel, pressure: d1, raw };
    case STATUS.PITCH_BEND:
      if (d1 === undefined || d2 === undefined || !isDataByte(d1) || !isDataByte(d2)) break;
      return { type: "pitch-bend", channel, value: d1 | (d2 << 7), raw };
  }

  return { type: "unknown", raw };
}

function assertChannel(channel: number): void {
  if (!isChannel(channel)) {
    throw new MidiEncodeError(`Invalid channel: ${channel} (expected an integer 0-15)`);
  }
}

function assertDataByte(value: number, field: string): void {
  if (!isDataByte(value)) {
    throw new MidiEncodeError(`Invalid ${field}: ${value} (expected an integer 0-127)`);
  }
}

/**
 * Encode a MidiMessage into wire bytes.
 *
 * For every message type Core models, bytes are always re-derived from
 * the normalized fields — `raw` on the input (if present, e.g. from a
 * prior decode) is ignored, so encode's output is guaranteed consistent
 * with the fields you pass it. For SysExMessage and UnknownMessage,
 * `raw` *is* the message, since Core has no fields to derive it from.
 *
 * Throws MidiEncodeError if a field is out of range — unlike decode,
 * this is the caller's own data, so a bad value is a programming error
 * worth surfacing rather than silently swallowing.
 */
export function encodeMidiMessage(message: MidiMessage): Uint8Array {
  switch (message.type) {
    case "note-on":
      assertChannel(message.channel);
      assertDataByte(message.note, "note");
      assertDataByte(message.velocity, "velocity");
      return Uint8Array.of(STATUS.NOTE_ON | message.channel, message.note, message.velocity);
    case "note-off":
      assertChannel(message.channel);
      assertDataByte(message.note, "note");
      assertDataByte(message.velocity, "velocity");
      return Uint8Array.of(STATUS.NOTE_OFF | message.channel, message.note, message.velocity);
    case "poly-pressure":
      assertChannel(message.channel);
      assertDataByte(message.note, "note");
      assertDataByte(message.pressure, "pressure");
      return Uint8Array.of(STATUS.POLY_PRESSURE | message.channel, message.note, message.pressure);
    case "control-change":
      assertChannel(message.channel);
      assertDataByte(message.controller, "controller");
      assertDataByte(message.value, "value");
      return Uint8Array.of(STATUS.CONTROL_CHANGE | message.channel, message.controller, message.value);
    case "program-change":
      assertChannel(message.channel);
      assertDataByte(message.program, "program");
      return Uint8Array.of(STATUS.PROGRAM_CHANGE | message.channel, message.program);
    case "channel-pressure":
      assertChannel(message.channel);
      assertDataByte(message.pressure, "pressure");
      return Uint8Array.of(STATUS.CHANNEL_PRESSURE | message.channel, message.pressure);
    case "pitch-bend":
      assertChannel(message.channel);
      if (!isPitchBendValue(message.value)) {
        throw new MidiEncodeError(`Invalid pitch bend value: ${message.value} (expected an integer 0-16383)`);
      }
      return Uint8Array.of(
        STATUS.PITCH_BEND | message.channel,
        message.value & 0x7f,
        (message.value >> 7) & 0x7f,
      );
    case "clock":
      return Uint8Array.of(0xf8);
    case "start":
      return Uint8Array.of(0xfa);
    case "continue":
      return Uint8Array.of(0xfb);
    case "stop":
      return Uint8Array.of(0xfc);
    case "sysex":
    case "unknown":
      return message.raw;
  }
}
