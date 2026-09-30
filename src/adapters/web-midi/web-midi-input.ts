import type { Unsubscribe } from "../../core/types/discovery.js";
import type { RawMidiInput } from "../../core/types/input.js";
import { WebMidiPortBase } from "./web-midi-port.js";

export class WebMidiInputTransport extends WebMidiPortBase implements RawMidiInput {
  private readonly midiInput: MIDIInput;
  private readonly rawListeners = new Set<(bytes: Uint8Array) => void>();

  constructor(midiInput: MIDIInput) {
    super(midiInput);
    this.midiInput = midiInput;
    this.midiInput.onmidimessage = (event) => {
      if (event.data) {
        for (const listener of this.rawListeners) listener(event.data);
      }
    };
  }

  onRawMessage(listener: (bytes: Uint8Array) => void): Unsubscribe {
    this.rawListeners.add(listener);
    return () => this.rawListeners.delete(listener);
  }
}
