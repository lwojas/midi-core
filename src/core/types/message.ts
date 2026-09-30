/**
 * Normalized MIDI message model.
 *
 * Conservative by design: models exactly the message kinds Core needs to
 * carry values faithfully — Note On/Off, CC, pitch bend, program change,
 * channel and polyphonic aftertouch, the system real-time messages useful
 * for transport sync (clock/start/continue/stop), and SysEx kept opaque.
 * Anything else (other system common messages, Active Sensing, System
 * Reset, malformed input) decodes to UnknownMessage rather than being
 * force-fit into a shape Core doesn't actually understand.
 *
 * "Normalized" means multi-byte protocol fields are combined into single
 * values (e.g. pitch bend's two 7-bit bytes become one 0-16383 value) — it
 * does not mean Core reinterprets meaning. A Note On with velocity 0 stays
 * a NoteOnMessage; Core does not rewrite it to Note Off, even though many
 * MIDI implementations treat the two as equivalent. That's a convention,
 * not a structural fact, and applying it here would be Core making an
 * application-level judgment call.
 *
 * Raw byte retention: `raw` holds the exact bytes a message was decoded
 * from, when known. It's optional on every channel-voice/real-time message
 * because those are modeled without loss — encoding always re-derives
 * bytes from the normalized fields, never from `raw`. It's required on
 * SysExMessage and UnknownMessage because Core does not model their
 * contents at all; `raw` *is* the message there, and is what makes a
 * receive-then-resend round-trip faithful for the things Core doesn't
 * understand.
 */

export type Channel = number; // 0-15, matches the MIDI status byte's low nibble directly

export function isChannel(value: unknown): value is Channel {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 15;
}

/** A single MIDI data byte: 0-127. */
export function isDataByte(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 127;
}

export const PITCH_BEND_MIN = 0;
export const PITCH_BEND_MAX = 16383;
export const PITCH_BEND_CENTER = 8192;

export function isPitchBendValue(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= PITCH_BEND_MIN &&
    value <= PITCH_BEND_MAX
  );
}

interface BaseMessage {
  /** Exact bytes this message was decoded from, when known. */
  readonly raw?: Uint8Array;
}

export interface NoteOnMessage extends BaseMessage {
  readonly type: "note-on";
  readonly channel: Channel;
  readonly note: number; // 0-127
  readonly velocity: number; // 0-127; 0 is a valid Note On, not rewritten to Note Off
}

export interface NoteOffMessage extends BaseMessage {
  readonly type: "note-off";
  readonly channel: Channel;
  readonly note: number; // 0-127
  readonly velocity: number; // release velocity, 0-127
}

export interface ControlChangeMessage extends BaseMessage {
  readonly type: "control-change";
  readonly channel: Channel;
  readonly controller: number; // 0-127; Core assigns no meaning to controller numbers
  readonly value: number; // 0-127
}

export interface ProgramChangeMessage extends BaseMessage {
  readonly type: "program-change";
  readonly channel: Channel;
  readonly program: number; // 0-127
}

export interface ChannelPressureMessage extends BaseMessage {
  readonly type: "channel-pressure"; // channel aftertouch
  readonly channel: Channel;
  readonly pressure: number; // 0-127
}

export interface PolyPressureMessage extends BaseMessage {
  readonly type: "poly-pressure"; // polyphonic key aftertouch
  readonly channel: Channel;
  readonly note: number; // 0-127
  readonly pressure: number; // 0-127
}

export interface PitchBendMessage extends BaseMessage {
  readonly type: "pitch-bend";
  readonly channel: Channel;
  /** 14-bit value, 0-16383, center 8192. Not rescaled to any other range — that's an application/mapping concern. */
  readonly value: number;
}

export interface ClockMessage extends BaseMessage {
  readonly type: "clock";
}

export interface StartMessage extends BaseMessage {
  readonly type: "start";
}

export interface ContinueMessage extends BaseMessage {
  readonly type: "continue";
}

export interface StopMessage extends BaseMessage {
  readonly type: "stop";
}

export interface SysExMessage {
  readonly type: "sysex";
  /** Full message bytes, including the leading 0xF0 and trailing 0xF7. Opaque — Core does not interpret SysEx content. */
  readonly raw: Uint8Array;
}

export interface UnknownMessage {
  readonly type: "unknown";
  /** Any message Core doesn't model, preserved verbatim. */
  readonly raw: Uint8Array;
}

export type MidiMessage =
  | NoteOnMessage
  | NoteOffMessage
  | ControlChangeMessage
  | ProgramChangeMessage
  | ChannelPressureMessage
  | PolyPressureMessage
  | PitchBendMessage
  | ClockMessage
  | StartMessage
  | ContinueMessage
  | StopMessage
  | SysExMessage
  | UnknownMessage;

export type MidiMessageType = MidiMessage["type"];

export const MIDI_MESSAGE_TYPES: readonly MidiMessageType[] = [
  "note-on",
  "note-off",
  "control-change",
  "program-change",
  "channel-pressure",
  "poly-pressure",
  "pitch-bend",
  "clock",
  "start",
  "continue",
  "stop",
  "sysex",
  "unknown",
];

export function isMidiMessageType(value: unknown): value is MidiMessageType {
  return typeof value === "string" && (MIDI_MESSAGE_TYPES as readonly string[]).includes(value);
}
