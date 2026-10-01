import type { PortType } from "../../core/types/identity.js";
import type { MidiMessageType } from "../../core/types/message.js";

/**
 * One MIDI port a device exposes, as described by its profile.
 *
 * Reuses Core's `PortType` directly — a profile's port is still, at the
 * transport level, exactly what Core's discovery/identity contract already
 * models. Some controllers expose more than one input/output pair for a
 * single physical device (e.g. a standard port plus a separate DAW/control
 * port running a different mode); `role` names which one this is, and
 * `required` says whether the device is usable at all without it connected
 * (a device whose DAW port is optional vs. one that needs both to function).
 */
export interface DevicePortProfile {
  /** Profile-document-scoped id, referenced by `PhysicalControl.portId`. */
  readonly id: string;
  readonly type: PortType;
  /** Free-text role, e.g. "main", "daw-control". Not a fixed enum — device port layouts vary too much to close this list. */
  readonly role: string;
  readonly required: boolean;
  /** Normalized message kinds documented or observed on this port. */
  readonly messageTypes: readonly MidiMessageType[];
}
