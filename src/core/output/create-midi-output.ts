import { encodeMidiMessage } from "../message/codec.js";
import type { RawMidiOutput, MidiOutput } from "../types/output.js";

/**
 * Wrap a transport's RawMidiOutput into the MidiOutput consumers use.
 *
 * Intentionally thin, mirroring createMidiInput: lifecycle (port, state,
 * connect, disconnect, onStateChange, onError) passes straight through to
 * the transport, and send() encodes a message and hands the bytes to
 * sendRaw. All transport and device knowledge stays behind RawMidiOutput.
 *
 * `port`/`state` are exposed as getters so they always reflect the
 * transport's current value rather than a stale snapshot taken at wrap
 * time.
 */
export function createMidiOutput(transport: RawMidiOutput): MidiOutput {
  return {
    get port() {
      return transport.port;
    },
    get state() {
      return transport.state;
    },
    connect: () => transport.connect(),
    disconnect: () => transport.disconnect(),
    onStateChange: (listener) => transport.onStateChange(listener),
    onError: (listener) => transport.onError(listener),
    send: (message) => transport.sendRaw(encodeMidiMessage(message)),
  };
}
