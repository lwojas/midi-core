import type { RawMidiOutput } from "../../core/types/output.js";
import { WebMidiPortBase } from "./web-midi-port.js";

export class WebMidiOutputTransport extends WebMidiPortBase implements RawMidiOutput {
  private readonly midiOutput: MIDIOutput;

  constructor(midiOutput: MIDIOutput) {
    super(midiOutput);
    this.midiOutput = midiOutput;
  }

  /**
   * Per the RawMidiOutput contract, this does not throw for transport
   * failures -- MIDIOutput.send() can throw (e.g. the port isn't open),
   * and that's reported through onError like any other transport error
   * (see docs/contracts/output.md), not propagated as an exception.
   */
  sendRaw(bytes: Uint8Array): void {
    try {
      this.midiOutput.send(Array.from(bytes));
    } catch (cause) {
      this.emitError({
        code: "send-failed",
        message: cause instanceof Error ? cause.message : "Failed to send MIDI message",
        portId: this.port.id,
        cause,
      });
    }
  }
}
