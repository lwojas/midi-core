/**
 * Device identity within a profile.
 *
 * Distinct from Core's `MidiPortInfo` (see `core/types/identity.ts`):
 * `MidiPortInfo` identifies one connected *port* at runtime (its own id,
 * whatever name/manufacturer the transport reports); `DeviceIdentity`
 * identifies the *device model* a profile document describes, independent
 * of any session. A profile is not matched against a connected port by
 * anything defined here — per docs/architecture.md, matching by
 * name/manufacturer is a heuristic for a higher layer, not a Core or
 * profile-schema concern.
 */

export interface DeviceIdentity {
  /** Stable, profile-document-scoped id, e.g. "novation.launchpad-mini-mk3". Not a runtime port id. */
  readonly id: string;
  readonly manufacturer: string;
  /** Human-readable model name, e.g. "Launchpad Mini MK3". */
  readonly model: string;
}
