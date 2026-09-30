export type { PortId, PortType, MidiPortInfo } from "./types/identity.js";
export { PORT_TYPES, isPortType } from "./types/identity.js";

export type { ConnectionState, ConnectionStateChange } from "./types/lifecycle.js";
export { CONNECTION_STATES, isConnectionState, isValidTransition } from "./types/lifecycle.js";

export type {
  MidiTransportErrorCode,
  MidiTransportError,
} from "./types/errors.js";
export { MIDI_TRANSPORT_ERROR_CODES, isMidiTransportErrorCode } from "./types/errors.js";

export type {
  DiscoveryChangeType,
  DiscoveryChange,
  Unsubscribe,
  MidiDiscovery,
} from "./types/discovery.js";

export type { MidiConnection } from "./types/connection.js";

export type {
  Channel,
  NoteOnMessage,
  NoteOffMessage,
  ControlChangeMessage,
  ProgramChangeMessage,
  ChannelPressureMessage,
  PolyPressureMessage,
  PitchBendMessage,
  ClockMessage,
  StartMessage,
  ContinueMessage,
  StopMessage,
  SysExMessage,
  UnknownMessage,
  MidiMessage,
  MidiMessageType,
} from "./types/message.js";
export {
  isChannel,
  isDataByte,
  isPitchBendValue,
  isMidiMessageType,
  MIDI_MESSAGE_TYPES,
  PITCH_BEND_MIN,
  PITCH_BEND_MAX,
  PITCH_BEND_CENTER,
} from "./types/message.js";

export { decodeMidiMessage, encodeMidiMessage, MidiEncodeError } from "./message/codec.js";

export type { RawMidiInput, MidiInput } from "./types/input.js";
export { createMidiInput } from "./input/create-midi-input.js";
