import type { MidiConnection } from "../../core/types/connection.js";
import type { Unsubscribe } from "../../core/types/discovery.js";
import type { MidiTransportError } from "../../core/types/errors.js";
import type { MidiPortInfo } from "../../core/types/identity.js";
import type { ConnectionState } from "../../core/types/lifecycle.js";
import { derivePortState, toPortInfo } from "./port-info.js";

/**
 * Shared lifecycle wiring for a Web MIDI input or output port.
 *
 * connect()/disconnect() delegate straight to MIDIPort.open()/close() and
 * let a rejection propagate as-is -- that's standard Promise semantics
 * and needs no extra machinery. Hardware-driven state changes (from the
 * port's own `onstatechange`, e.g. a physical unplug) are mapped via
 * derivePortState() and forwarded directly through onStateChange; they
 * are not validated against Core's isValidTransition table, since real
 * hardware doesn't necessarily respect it and nothing in the lifecycle
 * contract requires adapters to enforce it (see
 * docs/contracts/discovery-lifecycle.md).
 */
export abstract class WebMidiPortBase implements MidiConnection {
  readonly port: MidiPortInfo;
  state: ConnectionState;

  protected readonly midiPort: MIDIPort;
  private readonly stateListeners = new Set<(state: ConnectionState, previous: ConnectionState) => void>();
  private readonly errorListeners = new Set<(error: MidiTransportError) => void>();

  protected constructor(midiPort: MIDIPort) {
    this.midiPort = midiPort;
    this.port = toPortInfo(midiPort);
    this.state = derivePortState(midiPort);
    midiPort.onstatechange = () => this.handleStateChange();
  }

  async connect(): Promise<void> {
    await this.midiPort.open();
  }

  async disconnect(): Promise<void> {
    await this.midiPort.close();
  }

  onStateChange(listener: (state: ConnectionState, previous: ConnectionState) => void): Unsubscribe {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onError(listener: (error: MidiTransportError) => void): Unsubscribe {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  protected emitError(error: MidiTransportError): void {
    for (const listener of this.errorListeners) listener(error);
  }

  private handleStateChange(): void {
    const previous = this.state;
    const next = derivePortState(this.midiPort);
    if (next === previous) return;
    this.state = next;
    for (const listener of this.stateListeners) listener(next, previous);
  }
}
