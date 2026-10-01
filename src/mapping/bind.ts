import type { Control, ControlDef, Unsubscribe } from "../control-api/types/control.js";
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
  const unsubscribeInput = input.onMessage((message) => {
    const value = resolveIncomingValue(message, mapping.source, control.def);
    if (value !== undefined) control.setValue(value);
  });

  const feedback = mapping.feedback;
  const unsubscribeFeedback = feedback
    ? control.onChange((value) => {
        const feedbackMessage = buildFeedbackMessage(feedback, control.def, value);
        if (feedbackMessage !== undefined) output.send(feedbackMessage);
      })
    : undefined;

  return () => {
    unsubscribeInput();
    unsubscribeFeedback?.();
  };
}
