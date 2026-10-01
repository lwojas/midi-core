export type {
  ChannelSelector,
  ControlChangeAddress,
  NoteAddress,
  PitchBendAddress,
  MidiAddress,
  MidiSource,
  MidiTarget,
} from "./types/address.js";
export { isChannelSelector, matchesSource } from "./types/address.js";

export type { ControlMapping } from "./types/mapping.js";

export { resolveIncomingValue, buildFeedbackMessage } from "./value.js";

export { bindControlMapping } from "./bind.js";
