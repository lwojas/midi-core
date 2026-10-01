import type { Control, ControlDef, ControlValue, Unsubscribe } from "../control-api/types/control.js";
import type { MidiInput } from "../core/types/input.js";
import type { MidiOutput } from "../core/types/output.js";
import type { ControlMapping } from "./types/mapping.js";
import { buildFeedbackMessage, resolveIncomingValue } from "./value.js";

/**
 * Wires one `ControlMapping` to a live `MidiInput`/`MidiOutput`/`Control`:
 * the runtime the mapping contract (docs/contracts/mapping.md) was designed
 * for, built only from pieces that already exist (`resolveIncomingValue()`,
 * `buildFeedbackMessage()`, Core's input/output, a `Control`) — still no
 * device knowledge, since all four are supplied by the caller.
 *
 * - Every message `input` delivers is resolved against `mapping.source` and
 *   `control.def`; a resolved value is pushed into `control` via
 *   `setValue()`. A message that doesn't match the source, or doesn't pair
 *   with the control's kind, is silently ignored (the same "not every
 *   caller's concern" stance `resolveIncomingValue()` itself takes).
 * - If `mapping.feedback` is set, every change to `control`'s value is
 *   converted back to a `MidiMessage` via `buildFeedbackMessage()` and sent
 *   through `output`. A mapping with no `feedback` is input-only, matching
 *   `docs/contracts/mapping.md`.
 *
 * Echo suppression (ECS-57): this function is the one piece of code sitting
 * between both directions for a given `(mapping, control)` pair, so it's
 * the one place that can actually tell "this change came from MIDI" apart
 * from any other caller of `setValue()` (a UI, automation, another
 * mapping) — every resolved incoming value is queued *before* pushing it
 * into `control`; `onChange` is skipped exactly when it reports the value
 * at the front of that queue, since that's the control confirming a
 * change this function itself made, not a new one to echo. Any other
 * change (a different value, or one that doesn't match the oldest pending
 * entry) still sends feedback normally.
 *
 * A queue, not a single remembered value: a `Control` backed by something
 * like a UI framework's state (dispatch now, notify on a later render) can
 * fall behind a fast, continuous stream of incoming messages -- several
 * more messages may arrive and each call `setValue()` before the *first*
 * one's `onChange` ever fires. A single "last value I set" slot gets
 * overwritten by those later messages before the earlier one is confirmed,
 * so when that earlier, now-stale confirmation finally arrives it no
 * longer matches -- and leaks through as feedback for a value the user has
 * already moved past (observed exactly this way integrating against a
 * real Launchpad Mini fader: `out:` lines echoing values several steps
 * behind the live `in:` stream). Matching strictly in arrival order against
 * a queue, instead of only the most recent entry, is what a FIFO channel
 * between two different clocks (real-time MIDI input vs. a UI's own
 * render/notify cycle) actually requires.
 *
 * This needs no device knowledge and nothing from the caller beyond what
 * `bindControlMapping` already has — real hardware testing (see
 * docs/contracts/mapping-runtime.md) showed why it matters: without it, a
 * continuous control whose device reflects incoming values as its own
 * position/LED state (a touch fader, an LED ring) fights itself on every
 * move.
 *
 * Binding several controls (e.g. a device's whole control layout) is just
 * calling this once per mapping; each call returns its own independent
 * `Unsubscribe`.
 */
export function bindControlMapping<D extends ControlDef>(
  mapping: ControlMapping,
  input: MidiInput,
  output: MidiOutput,
  control: Control<D>,
): Unsubscribe {
  const feedback = mapping.feedback;
  // Only tracked when feedback exists -- nothing ever drains it otherwise.
  const pendingFromMidi: ControlValue<D>[] = [];

  const unsubscribeInput = input.onMessage((message) => {
    const value = resolveIncomingValue(message, mapping.source, control.def);
    if (value === undefined) return;
    if (feedback) pendingFromMidi.push(value);
    control.setValue(value);
  });

  const unsubscribeFeedback = feedback
    ? control.onChange((value) => {
        if (pendingFromMidi.length > 0 && pendingFromMidi[0] === value) {
          pendingFromMidi.shift();
          return;
        }

        const feedbackMessage = buildFeedbackMessage(feedback, control.def, value);
        if (feedbackMessage !== undefined) output.send(feedbackMessage);
      })
    : undefined;

  return () => {
    unsubscribeInput();
    unsubscribeFeedback?.();
  };
}
