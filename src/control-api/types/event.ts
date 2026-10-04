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
  /**
   * Notifies on every event this source reports, in order, from
   * subscription onward. Typed `SurfaceEvent<unknown>`, not the bare
   * (so `P`-defaulted-to-`undefined`) `SurfaceEvent` — ECS-70 found that
   * the bare form couldn't type this contract's own payload-bearing
   * examples (a step-triggered/transport-tick event's `{ step: 3 }`); a
   * listener narrows on `event.id` to know what `payload` actually is,
   * the same way a `SurfaceEventSource` was already understood to report
   * more than one kind of event.
   */
  onEvent(listener: (event: SurfaceEvent<unknown>) => void): Unsubscribe;
}
