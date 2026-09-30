import type { MidiPortInfo } from "../../core/types/identity.js";
import type { RawMidiOutput } from "../../core/types/output.js";
import { MockPort } from "./mock-port.js";

/**
 * A mock output port: implements RawMidiOutput with no real hardware
 * behind it. sendRaw() records bytes for assertions instead of sending
 * them anywhere; simulateSendFailures() flips it to report send-failed
 * transport errors instead, exercising the error path from
 * docs/contracts/output.md without needing a real device to refuse a send.
 */
export class MockMidiOutput extends MockPort implements RawMidiOutput {
  private readonly sent: Uint8Array[] = [];
  private failSends = false;

  constructor(port: MidiPortInfo) {
    super(port);
  }

  /** Bytes passed to sendRaw so far, in order. */
  get sentMessages(): readonly Uint8Array[] {
    return this.sent;
  }

  /** Test control: make subsequent sendRaw calls report a transport failure instead of recording bytes. */
  simulateSendFailures(shouldFail: boolean): void {
    this.failSends = shouldFail;
  }

  sendRaw(bytes: Uint8Array): void {
    if (this.failSends) {
      this.emitError({
        code: "send-failed",
        message: "Simulated send failure",
        portId: this.port.id,
      });
      return;
    }
    this.sent.push(bytes);
  }

  /** Test control: clear recorded sent messages. */
  clearSentMessages(): void {
    this.sent.length = 0;
  }
}
