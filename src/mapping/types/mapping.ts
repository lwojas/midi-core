import type { ControlId } from "../../control-api/types/control.js";
import type { MidiSource, MidiTarget, RelativeEncoding } from "./address.js";

/**
 * One binding between a MIDI source and an application control.
 *
 * `feedback` is optional: a mapping with none is input-only (turning the
 * knob changes the control; nothing is sent back). Most controllers don't
 * need it — it's there for the ones that do (a motorized fader, an LED
 * ring) rather than assumed. It deliberately reuses `MidiSource`'s address
 * shape rather than being derived automatically from `source`, since
 * feedback commonly goes out on a different address than the one the
 * control was changed from (e.g. a different CC number for an LED ring).
 *
 * `relativeEncoding` is optional (ECS-137): omitted (the far more common
 * case) means `source`'s raw value is normalized straight onto `control`'s
 * range, exactly as before. Present, it means `source` reports relative
 * deltas (a device fact `generateControlMappings()` copies from the
 * originating `PhysicalControl.relativeEncoding`), and `bindControlMapping()`
 * decodes each message into a delta and accumulates it onto the control's
 * *current* value instead of normalizing it directly — see
 * `docs/contracts/mapping-runtime.md`.
 */
export interface ControlMapping {
  readonly id: string;
  readonly control: ControlId;
  readonly source: MidiSource;
  readonly feedback?: MidiTarget;
  readonly relativeEncoding?: RelativeEncoding;
}
