/**
 * A standalone, versioned document of user-assigned mapping edits (ECS-137) — the "editable mapping-data" half of
 * the boundary the ECS-136 architecture gate drew, superseding ECS-92's former webseq-owned, app-persisted
 * direction. Deliberately *not* part of `DeviceProfile` itself: `docs/contracts/device-profile.md` already states a
 * layout override "belongs outside the profile document: a profile is generated offline, and regenerating it would
 * discard them." This is that separate document.
 *
 * `layoutOverrides`/`bindingOverrides` are left untyped here on purpose: their concrete shape (which `DeviceLayout`
 * roles and which bindings are actually safe/meaningful to override, and how) is ECS-142's job to define once a
 * validated schema exists — inventing one speculatively here, ahead of that ticket, is exactly the "no speculative
 * framework" this project's contracts avoid elsewhere. `validateDeviceOverrides()` (ECS-137's own scope) therefore
 * checks only this document's own shape and its version relationship to the profile it claims to apply to; it does
 * not reach into either override field's contents.
 */
export const DEVICE_OVERRIDES_SCHEMA_VERSION = "1.0";

export interface DeviceOverrides {
  /** This document shape's own version — checked against `DEVICE_OVERRIDES_SCHEMA_VERSION`, the same role `DeviceProfile.schemaVersion` plays for a profile. */
  readonly schemaVersion: string;
  /** The `DeviceIdentity.id` of the profile these overrides apply to. */
  readonly profileId: string;
  /**
   * The profile's own `schemaVersion` at the time these overrides were authored/saved, so a later profile
   * regeneration can be detected as stale (the profile's shape may have moved on) rather than silently applied.
   */
  readonly profileSchemaVersion: string;
  /** Layout-role overrides (e.g. a reassigned mode button). Shape defined by ECS-142, not here. */
  readonly layoutOverrides?: unknown;
  /** Binding overrides (e.g. a reassigned control-id target). Shape defined by ECS-142, not here. */
  readonly bindingOverrides?: unknown;
}
