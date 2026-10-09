/**
 * A text display's SysEx template (ECS-137) — declarative byte layout, describing a device's LCD/text-line protocol
 * the same way `DeviceModeProfile.bankPrefix`/`bankEntry` (ECS-96) already describe a fader bank message: a fixed
 * prefix, a per-line id byte, a fixed byte sequence, then a fixed-width text payload the application fills in. This
 * is the shape `push-mk1.ts`'s own comment named as missing ("this profile doesn't model text-display feedback as a
 * `PhysicalControl` — there's no control kind for a multi-line text display") and the ECS-136 gate's architecture
 * proposal designed from scratch, since neither `sysex` nor `setup` modeled a byte template with a variable payload.
 *
 * Deliberately not a `PhysicalControl`: a display has no input semantics (nothing to press, no address to read from)
 * — it only ever drives a new `StringControlDef` `Control` outward, via a `DisplayBinding`
 * (`src/surface/types/bindings.ts`), so it's its own sibling list on `DeviceProfile`, exactly as `modes` is.
 */
export interface DisplayLineTemplate {
  /** Profile-document-scoped id, unique within this display's `lines`. Named by a `DisplayBinding.lineId`. */
  readonly id: string;
  readonly label: string;
  /** The byte identifying this line within the display's SysEx template (e.g. Push mk1's 0x18-0x1b, one per line). */
  readonly lineId: number;
}

export interface DeviceDisplayDefinition {
  /** Profile-document-scoped id, unique among the profile's `displays`. Named by a `DisplayBinding.displayId`. */
  readonly id: string;
  readonly label: string;
  /** `DevicePortProfile.id` of the output port this display's SysEx is sent on. */
  readonly portId: string;
  readonly lines: readonly DisplayLineTemplate[];
  /** The SysEx bytes before the line id byte, from F0 (the same "from F0" convention `bankPrefix` uses). */
  readonly prefix: readonly number[];
  /** The fixed bytes between the line id byte and the start of text (e.g. Push mk1's 00 45 00). */
  readonly textPrefix: readonly number[];
  /** The fixed number of ASCII text bytes the line carries; shorter text is space-padded, longer text truncated. */
  readonly charCount: number;
}
