import type { Unsubscribe } from "../../core/types/discovery.js";
import type { MidiPortInfo } from "../../core/types/identity.js";
import type { RawMidiInput } from "../../core/types/input.js";
import { MockPort } from "./mock-port.js";

/**
 * A mock input port: implements RawMidiInput with no real hardware behind
 * it. emitRawMessage() is the test-only hook standing in for "the device
 * just sent these bytes" -- feed it through createMidiInput() to get
 * normalized MidiMessages out the consumer-facing side (see
 * docs/contracts/input.md).
 */
export class MockMidiInput extends MockPort implements RawMidiInput {
  private readonly rawListeners = new Set<(bytes: Uint8Array) => void>();

  constructor(port: MidiPortInfo) {
    super(port);
  }

  onRawMessage(listener: (bytes: Uint8Array) => void): Unsubscribe {
    this.rawListeners.add(listener);
    return () => this.rawListeners.delete(listener);
  }

  /** Test control: simulate the device sending a raw MIDI message upstream. */
  emitRawMessage(bytes: Uint8Array): void {
    for (const listener of this.rawListeners) listener(bytes);
  }
}
