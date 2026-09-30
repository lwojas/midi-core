import type { MidiConnection } from "./connection.js";
import type { MidiMessage } from "./message.js";

/**
 * What a transport (a future Web MIDI adapter, the mock device in ECS-32,
 * ...) must provide for an output port: the connection lifecycle from
 * MidiConnection, plus a way to send raw bytes.
 *
 * sendRaw does not throw for transport-level failures (e.g. the port
 * having gone away mid-send) -- those are reported through the
 * connection's existing onError, the same channel used for every other
 * transport error (ECS-27). This is the seam between a concrete transport
 * and Core's generic output engine; it carries no device knowledge.
 */
export interface RawMidiOutput extends MidiConnection {
  sendRaw(bytes: Uint8Array): void;
}

/**
 * What Core hands to consumers: connection lifecycle plus the ability to
 * send a normalized MidiMessage. No raw bytes, no transport, no device
 * knowledge -- this is the only output surface a consumer should ever
 * need to depend on.
 *
 * send() throws MidiEncodeError synchronously if `message`'s fields are
 * out of range -- that's the caller's own data, a programming error worth
 * surfacing immediately. Transport-level send failures are not thrown;
 * like any other transport error, they surface through onError.
 */
export interface MidiOutput extends MidiConnection {
  send(message: MidiMessage): void;
}
