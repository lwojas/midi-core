import type { Unsubscribe } from "./control.js";

/**
 * Application-originated context a surface reads to resolve a role
 * ("pad grid", "parameter page") against the application's current
 * selection — which track, pattern or parameter a physical control should
 * currently affect. The application is the only writer: it originates
 * selection from its own state (a user picking a track in its UI, a
 * sequencer advancing to the next pattern), never the surface and never a
 * MIDI message directly. A surface and a UI both just read this contract;
 * neither is an intermediary that computes or forwards selection on the
 * application's behalf.
 *
 * `scope` is owner-defined (e.g. "track", "pattern", "step-page"), the same
 * reasoning `docs/contracts/control-api.md` already applies to `ControlId`:
 * this contract doesn't assume a fixed set of selectable things. `Selection`
 * is deliberately the only shape here — a broader "context" envelope
 * carrying more than current selection has no concrete need yet (no mock
 * surface or sequencer integration requires one), so none is invented.
 */
export interface Selection {
  readonly scope: string;
  /** Opaque id within `scope`, matching whatever ids the owning domain already uses. */
  readonly id: string;
}

export interface SurfaceContext {
  /** Snapshot of all current selections, one per scope that has one. */
  listSelections(): readonly Selection[];
  getSelection(scope: string): Selection | undefined;
  /** Notifies with the new selection whenever one scope's selection changes. */
  onChange(listener: (selection: Selection) => void): Unsubscribe;
}
