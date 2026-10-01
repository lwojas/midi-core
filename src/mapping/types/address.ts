import { isChannel, type Channel, type MidiMessage } from "../../core/types/message.js";

/**
 * MIDI ↔ Control mapping — source/target addressing.
 *
 * A `MidiAddress` names one place on the wire a mapping cares about: a CC
 * number, a note number, or pitch bend (which has no further identifying
 * field — one wheel per channel). It says nothing about a control; it's
 * reused on both sides of a mapping:
 *
 * - `MidiSource` — what an incoming message must match to drive a control.
 *   `channel` may be `"any"`, since a mapping is commonly authored once and
 *   applied regardless of which channel a device happens to send on.
 * - `MidiTarget` — where an outgoing feedback message is sent. `channel`
 *   must be concrete — there's no such thing as sending to "any channel".
 *
 * Only the three address kinds below are modeled, deliberately: they're
 * the MIDI messages that function as continuous/discrete application
 * controls (a knob/fader, a pad/button, a wheel). Program change and the
 * aftertouch/real-time messages Core also models aren't controller
 * surfaces in the same sense, and adding them speculatively before a
 * concrete mapping needs them would be exactly the overengineering this
 * contract is scoped to avoid.
 */

export type ChannelSelector = Channel | "any";

export function isChannelSelector(value: unknown): value is ChannelSelector {
  return value === "any" || isChannel(value);
}

export interface ControlChangeAddress {
  readonly type: "control-change";
  readonly controller: number; // 0-127
}

/**
 * A note's press/release pair, addressed as one unit. `note-on` resolves
 * to `true`, `note-off` to `false` — the mapping layer's own discrete
 * on/off reading of the pair, kept separate from Core's refusal to treat
 * velocity-0 Note On as Note Off (see message-model.md). Core stays
 * literal about the wire; this layer is allowed to assign meaning.
 */
export interface NoteAddress {
  readonly type: "note";
  readonly note: number; // 0-127
}

export interface PitchBendAddress {
  readonly type: "pitch-bend";
}

export type MidiAddress = ControlChangeAddress | NoteAddress | PitchBendAddress;

export interface MidiSource {
  readonly address: MidiAddress;
  readonly channel: ChannelSelector;
}

export interface MidiTarget {
  readonly address: MidiAddress;
  readonly channel: Channel;
}

/** Whether `message` is the kind of event `source` listens for, on a matching channel. */
export function matchesSource(message: MidiMessage, source: MidiSource): boolean {
  const { address } = source;

  switch (address.type) {
    case "control-change":
      return (
        message.type === "control-change" &&
        message.controller === address.controller &&
        matchesChannel(message.channel, source.channel)
      );
    case "note":
      return (
        (message.type === "note-on" || message.type === "note-off") &&
        message.note === address.note &&
        matchesChannel(message.channel, source.channel)
      );
    case "pitch-bend":
      return message.type === "pitch-bend" && matchesChannel(message.channel, source.channel);
  }
}

function matchesChannel(channel: Channel, selector: ChannelSelector): boolean {
  return selector === "any" || selector === channel;
}
