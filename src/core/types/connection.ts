import type { MidiPortInfo } from "./identity.js";
import type { ConnectionState } from "./lifecycle.js";
import type { MidiTransportError } from "./errors.js";
import type { Unsubscribe } from "./discovery.js";

/**
 * Connect/disconnect behavior and connection state for a single port.
 * Says nothing about what flows over the connection once open — that's
 * the input/output contract (ECS-28/29/30), not this one.
 */
export interface MidiConnection {
  readonly port: MidiPortInfo;
  readonly state: ConnectionState;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  onStateChange(listener: (state: ConnectionState, previous: ConnectionState) => void): Unsubscribe;
  onError(listener: (error: MidiTransportError) => void): Unsubscribe;
}
