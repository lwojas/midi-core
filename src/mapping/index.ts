export type {
  ChannelSelector,
  ControlChangeAddress,
  NoteAddress,
  PitchBendAddress,
  MidiAddress,
  MidiSource,
  MidiTarget,
  RelativeEncoding,
} from "./types/address.js";
export { isChannelSelector, isRelativeEncoding, matchesSource, RELATIVE_ENCODINGS } from "./types/address.js";

export type { ControlMapping } from "./types/mapping.js";

export { resolveIncomingValue, buildFeedbackMessage, decodeRelativeDelta } from "./value.js";

export { bindControlMapping } from "./bind.js";
