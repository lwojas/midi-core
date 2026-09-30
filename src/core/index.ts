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
