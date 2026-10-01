import type { Control, ControlId, Unsubscribe } from "./control.js";

/**
 * A lookup of the controls currently available from some owner (a track, an
 * FX instance, the transport, ...), and observation of controls being added
 * or removed — the Control API's equivalent of MIDI Core's MidiDiscovery,
 * for the same reason: enumerating what's there is a separate concern from
 * reading or changing any one of them.
 */

export type ControlRegistryChangeType = "added" | "removed";

export interface ControlRegistryChange {
  readonly type: ControlRegistryChangeType;
  readonly control: Control;
}

export interface ControlRegistry {
  /** Snapshot of currently available controls. */
  listControls(): readonly Control[];
  getControl(id: ControlId): Control | undefined;
  /** Notifies on every control added/removed after subscription. */
  onChange(listener: (change: ControlRegistryChange) => void): Unsubscribe;
}
