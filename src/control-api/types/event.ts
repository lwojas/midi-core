import type { Unsubscribe } from "./control.js";

/**
 * A discrete, momentary occurrence the application reports — a step firing
 * during playback, the playhead crossing a bar — as opposed to a Control's
 * persistent, gettable value. Modeling a fast-changing position as a
 * Control would force every consumer to poll it (the same tradeoff
 * `docs/contracts/control-api.md` notes webseq's own transport makes:
 * "position read by polling... rather than a subscription"); an Event
 * instead pushes each occurrence once, which is what feedback like an LED
 * chase or a momentary flash actually needs, and never accumulates a value
 * to read back. An event with nothing useful to say beyond "this happened"
 * carries no `payload`.
 */
export type SurfaceEventId = string;

export interface SurfaceEvent<P = undefined> {
  readonly id: SurfaceEventId;
  readonly payload: P;
}

export interface SurfaceEventSource {
  /** Notifies on every event this source reports, in order, from subscription onward. */
  onEvent(listener: (event: SurfaceEvent) => void): Unsubscribe;
}
