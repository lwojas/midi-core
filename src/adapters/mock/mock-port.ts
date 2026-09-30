import type { MidiConnection } from "../../core/types/connection.js";
import type { Unsubscribe } from "../../core/types/discovery.js";
import type { MidiTransportError } from "../../core/types/errors.js";
import type { MidiPortInfo } from "../../core/types/identity.js";
import type { ConnectionState } from "../../core/types/lifecycle.js";
import { isValidTransition } from "../../core/types/lifecycle.js";

/**
 * Shared lifecycle simulation for a mock MIDI input or output port.
 *
 * Unlike WebMidiPortBase (which forwards whatever state real hardware
 * reports, since hardware doesn't necessarily respect Core's own state
 * machine -- see docs/contracts/bidirectional.md), a mock port has no
 * hardware to defer to: it *is* a reference implementation of the
 * lifecycle contract in docs/contracts/discovery-lifecycle.md. Every state
 * change here, whether driven by connect()/disconnect() or a simulate*()
 * test helper, is checked against isValidTransition(); an invalid one
 * throws rather than being silently allowed, so tests written against
 * this mock exercise the same rules real implementations must follow.
 */
export abstract class MockPort implements MidiConnection {
  readonly port: MidiPortInfo;
  state: ConnectionState = "available";

  private readonly stateListeners = new Set<(state: ConnectionState, previous: ConnectionState) => void>();
  private readonly errorListeners = new Set<(error: MidiTransportError) => void>();

  protected constructor(port: MidiPortInfo) {
    this.port = port;
  }

  async connect(): Promise<void> {
    if (this.state === "connected") return;
    this.transitionTo("connecting");
    this.transitionTo("connected");
  }

  async disconnect(): Promise<void> {
    if (this.state === "disconnected") return;
    this.transitionTo("disconnecting");
    this.transitionTo("disconnected");
  }

  onStateChange(listener: (state: ConnectionState, previous: ConnectionState) => void): Unsubscribe {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onError(listener: (error: MidiTransportError) => void): Unsubscribe {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /** Test control: move the port back to "available" -- after an error, or a disconnected device re-appearing. */
  simulateAvailable(): void {
    this.transitionTo("available");
  }

  /** Test control: report a transport error, e.g. permission-denied or connection-failed. */
  simulateError(error: MidiTransportError): void {
    this.transitionTo("error");
    this.emitError(error);
  }

  /** Test control: simulate the device disappearing mid-operation, bypassing the graceful "disconnecting" step. */
  simulateDisconnect(): void {
    this.transitionTo("disconnected");
  }

  protected emitError(error: MidiTransportError): void {
    for (const listener of this.errorListeners) listener(error);
  }

  private transitionTo(next: ConnectionState): void {
    const previous = this.state;
    if (previous === next) return;
    if (!isValidTransition(previous, next)) {
      throw new Error(`Invalid MIDI connection state transition: ${previous} -> ${next}`);
    }
    this.state = next;
    for (const listener of this.stateListeners) listener(next, previous);
  }
}
