import type { Action } from "../control-api/types/action.js";
import type { BooleanControlDef } from "../control-api/types/control.js";
import type { Unsubscribe } from "../core/types/discovery.js";
import type { MidiInput } from "../core/types/input.js";
import type { MidiSource } from "../mapping/types/address.js";
import { resolveIncomingValue } from "../mapping/value.js";

/**
 * A synthetic, surface-local `BooleanControlDef` — never registered
 * anywhere, never exposed — purely so `resolveIncomingValue()` can be
 * reused as-is to turn an incoming message into "pressed"/"released" via
 * its existing note-press/release and CC-threshold rules, rather than
 * `bindActionTrigger()` re-deriving that logic a second time. Per the
 * ticket's "reuse existing MIDI input and value conversion
 * functionality."
 */
const TRIGGER_DEF: BooleanControlDef = { id: "__surface/action-trigger", label: "Action trigger", kind: "boolean", default: false };

/**
 * Binds a `MidiSource` to an `Action` — the MIDI → command counterpart
 * `bindControlMapping()` (`docs/contracts/mapping-runtime.md`) doesn't
 * cover, since `ControlMapping` only ever drives a `Control`'s
 * persistent value, and an `Action` has none (`docs/contracts/control-
 * api.md`: "`invoke()` returns nothing... `Action` exists only for the
 * remainder a read/write/observe shape doesn't fit"). Every message
 * `input` delivers is resolved against `source` via
 * `resolveIncomingValue()` using a synthetic boolean definition — the
 * same press/release and CC-threshold rules a mapping already applies —
 * and `action.invoke()` fires only on the transition into `true` (a
 * press, or crossing a CC threshold upward), never on release: an
 * `Action` is a fire-and-forget command, not a toggle, so there is
 * nothing to do on the matching "false" half of the same gesture.
 *
 * No feedback counterpart: `Action` has no value to report back, and
 * `docs/contracts/mapping.md`'s `ControlMapping.feedback` has nothing to
 * read from one.
 */
export function bindActionTrigger(input: MidiInput, source: MidiSource, action: Action): Unsubscribe {
  return input.onMessage((message) => {
    const pressed = resolveIncomingValue(message, source, TRIGGER_DEF);
    if (pressed === true) action.invoke();
  });
}
