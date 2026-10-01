/**
 * A device's vendor SysEx needs, described rather than implemented: this
 * schema does not model SysEx message templates/byte layouts (e.g. a
 * palette-set or mode-switch message's exact structure) — that's real
 * protocol/codec work, a composition-model concern (ECS-40) once one
 * exists, not something to design speculatively here.
 */
export interface DeviceSysExProfile {
  /** 1 or 3 bytes, per the MIDI SysEx manufacturer-id convention. */
  readonly manufacturerId: readonly number[];
  /** Whether normal operation depends on vendor SysEx, vs. it only being used for optional extras. */
  readonly required: boolean;
  readonly notes?: string;
}
