import type { DeviceIdentity } from "./identity.js";
import type { DevicePortProfile } from "./port.js";
import type { PhysicalControl } from "./control.js";
import type { ControlGrid } from "./grid.js";
import type { DeviceSysExProfile } from "./sysex.js";
import type { DeviceSetup } from "./setup.js";
import type { DeviceLayout } from "./layout.js";
import type { DeviceModeProfile } from "./mode.js";

/**
 * A device profile describes one device model: its identity, the ports it
 * exposes, the physical controls on it and where each lives on the wire,
 * how those controls are laid out (grids), what output/LED feedback they
 * support, and what vendor SysEx or connection setup it needs. It
 * describes the device, not application behavior — nothing here is a
 * `ControlMapping` (no `ControlId`, no reference to the Application
 * Control API), and nothing here is wired to a live `MidiInput`/
 * `MidiOutput`. Building `ControlMapping`s from a profile, loading/
 * composing profiles, and validating one are later, separate concerns —
 * see docs/contracts/device-profile.md.
 *
 * `schemaVersion` is this document shape's own version, not the device's
 * firmware version (that, if relevant at all, belongs under `identity` or
 * `setup`) — profiles are meant to be produced by a separate offline
 * tool (a MIDI profiler) and consumed here, so the producer and consumer
 * can evolve independently and detect a mismatch.
 */

export const DEVICE_PROFILE_SCHEMA_VERSION = "1.0";

export interface DeviceProfile {
  readonly schemaVersion: string;
  readonly identity: DeviceIdentity;
  readonly ports: readonly DevicePortProfile[];
  readonly controls: readonly PhysicalControl[];
  readonly grids?: readonly ControlGrid[];
  readonly sysex?: DeviceSysExProfile;
  readonly setup?: DeviceSetup;
  /** Which controls play which sequencer roles (ECS-90). Optional: a device without one gets no mode, page or transport bindings. */
  readonly layout?: DeviceLayout;
  /** Modes that need their own messages and ports (ECS-96). Optional: a device without them has no such modes. */
  readonly modes?: readonly DeviceModeProfile[];
}
