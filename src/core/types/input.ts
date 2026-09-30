import type { MidiConnection } from "./connection.js";
import type { Unsubscribe } from "./discovery.js";
import type { MidiMessage } from "./message.js";

/**
 * What a transport (a future Web MIDI adapter, the mock device in ECS-32,
 * ...) must provide for an input port: the connection lifecycle from
 * MidiConnection, plus a stream of raw incoming message bytes -- one
 * complete message per call, matching what decodeMidiMessage expects
 * (see docs/contracts/message-model.md). This is the seam between a
 * concrete transport and Core's generic input engine; it carries no
 * device knowledge.
 */
export interface RawMidiInput extends MidiConnection {
  onRawMessage(listener: (bytes: Uint8Array) => void): Unsubscribe;
}

/**
 * What Core hands to consumers: connection lifecycle plus a stream of
 * normalized MidiMessages. No raw bytes, no transport, no device
 * knowledge -- this is the only input surface a consumer should ever
 * need to depend on.
 */
export interface MidiInput extends MidiConnection {
  onMessage(listener: (message: MidiMessage) => void): Unsubscribe;
}
