import type { MidiMessageType } from "../../core/types/message.js";
import type { ProtocolFamily } from "../composition/types/protocol.js";

/**
 * The channel voice message kinds MIDI 1.0 defines for any compliant
 * device, independent of what any particular manufacturer builds on top.
 * Deliberately excludes real-time transport ("clock"/"start"/"continue"/
 * "stop") and "sysex": not every device uses clock sync, and SysEx is
 * inherently vendor-specific — neither is a safe assumption for a profile
 * that names no manufacturer. A concrete device profile that does need
 * either composes its own protocol binding for them alongside this one,
 * rather than this baseline assuming it for every device.
 */
export const GENERIC_MIDI_CHANNEL_VOICE_MESSAGE_TYPES: readonly MidiMessageType[] = [
  "note-on",
  "note-off",
  "control-change",
  "program-change",
  "channel-pressure",
  "poly-pressure",
  "pitch-bend",
];

/**
 * The generic MIDI protocol: every channel voice message kind, no fixed
 * `controls`. Unlike MCU or a vendor protocol, "generic MIDI" has no
 * standard control layout to template — any CC/note number could mean
 * anything, depending on the device — so this is `messageTypes` only,
 * exactly the case `docs/contracts/protocol-composition.md` already
 * designed for.
 */
export const GENERIC_MIDI_PROTOCOL: ProtocolFamily = {
  id: "generic-midi",
  name: "Generic MIDI",
  messageTypes: GENERIC_MIDI_CHANNEL_VOICE_MESSAGE_TYPES,
};
