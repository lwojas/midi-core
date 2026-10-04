import type { SurfaceEvent, SurfaceEventSource } from "../control-api/types/event.js";
import type { Unsubscribe } from "../core/types/discovery.js";
import type { MidiMessage } from "../core/types/message.js";
import type { MidiOutput } from "../core/types/output.js";

/**
 * Converts one `SurfaceEvent` into an outgoing `MidiMessage`, or
 * `undefined` when this particular occurrence shouldn't produce feedback
 * right now (e.g. a `transport.tick` for a different step than the one a
 * given binding lights).
 */
export type EventFeedbackEncoder = (event: SurfaceEvent<unknown>) => MidiMessage | undefined;

/**
 * Binds a `SurfaceEventSource`'s momentary occurrences to outgoing MIDI
 * feedback — the event-driven counterpart to `bindControlMapping()`'s
 * Control → MIDI direction (`docs/contracts/mapping-runtime.md`), for
 * exactly the case `docs/contracts/control-api.md`'s own "Feedback"
 * section already named but nothing before ECS-73 wired:
 * `Control.onChange()` and `SurfaceEventSource.onEvent()` are "both
 * read-only subscriptions a mapping or Control Surface layer drives
 * outgoing MIDI from." A step-trigger chase light or a playhead tick is
 * exactly that: nothing to read back, just "this happened, send this."
 *
 * No echo suppression: unlike a `Control`, an event has no notion of
 * "the value I just set" to echo back — feedback here flows one
 * direction only (application → MIDI; nothing feeds a `SurfaceEvent`
 * from incoming MIDI in this project), so ECS-57's queue-matching
 * problem doesn't exist for this binding.
 */
export function bindEventFeedback(source: SurfaceEventSource, encode: EventFeedbackEncoder, output: MidiOutput): Unsubscribe {
  return source.onEvent((event) => {
    const message = encode(event);
    if (message !== undefined) output.send(message);
  });
}
