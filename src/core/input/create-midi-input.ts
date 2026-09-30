import { decodeMidiMessage } from "../message/codec.js";
import type { RawMidiInput, MidiInput } from "../types/input.js";

/**
 * Wrap a transport's RawMidiInput into the MidiInput consumers use.
 *
 * This is intentionally thin: lifecycle (port, state, connect, disconnect,
 * onStateChange, onError) passes straight through to the transport, and
 * onMessage decodes each raw message and forwards it. All transport and
 * device knowledge stays behind RawMidiInput -- a consumer holding a
 * MidiInput cannot observe which transport is underneath.
 *
 * `port`/`state` are exposed as getters so they always reflect the
 * transport's current value rather than a stale snapshot taken at wrap
 * time.
 */
export function createMidiInput(transport: RawMidiInput): MidiInput {
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
    onMessage: (listener) => transport.onRawMessage((bytes) => listener(decodeMidiMessage(bytes))),
  };
}
