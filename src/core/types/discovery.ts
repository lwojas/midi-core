import type { MidiPortInfo } from "./identity.js";

/**
 * Discovery: enumerating currently available ports and observing when
 * ports appear or disappear. Independent of connection state and of any
 * device profile — a port can be discovered without ever being connected.
 */

export type DiscoveryChangeType = "added" | "removed";

export interface DiscoveryChange {
  readonly type: DiscoveryChangeType;
  readonly port: MidiPortInfo;
}

/** Unsubscribes the listener it was returned from. */
export type Unsubscribe = () => void;

export interface MidiDiscovery {
  /** Snapshot of currently known ports. */
  listPorts(): readonly MidiPortInfo[];
  /** Notifies on every port added/removed after subscription. */
  onChange(listener: (change: DiscoveryChange) => void): Unsubscribe;
}
