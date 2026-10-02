import type { MidiMessageType } from "../../../core/types/message.js";
import type { PhysicalControl } from "../../types/control.js";

/**
 * A reusable protocol's control, identical in shape to a device's own
 * `PhysicalControl` in every way except which port it ends up bound to —
 * that's decided per-device by a `ProtocolBinding`, not by the protocol
 * itself (the same control layout can be bound to different devices'
 * different ports). `id` is scoped to the protocol, not globally unique;
 * composing a binding prefixes it (see `composeProtocolControls`).
 */
export type ProtocolControlTemplate = Omit<PhysicalControl, "portId">;

/**
 * A named, reusable protocol family — e.g. Mackie Control (MCU), MIDI
 * Clock/transport, MIDI Machine Control (MMC), or a vendor protocol. A
 * profile composes one or more of these (via `ProtocolBinding`) instead of
 * every device that speaks the same protocol hand-authoring the same
 * control layout again.
 *
 * Both fields are optional and independent, because not every protocol
 * has addressable controls of its own: MCU defines a fixed fader/encoder/
 * transport-button layout (`controls`); MIDI Clock/transport is purely
 * message-level (`messageTypes: ["clock", "start", "continue", "stop"]`,
 * no controls); MMC is command-based over SysEx, so it's represented the
 * same way Core and `docs/contracts/device-profile.md` already draw that
 * line — `messageTypes: ["sysex"]`, with the exact command encoding left
 * unmodeled (see "What's deliberately not here" in
 * docs/contracts/protocol-composition.md).
 */
export interface ProtocolFamily {
  readonly id: string;
  readonly name: string;
  readonly messageTypes?: readonly MidiMessageType[];
  readonly controls?: readonly ProtocolControlTemplate[];
}
