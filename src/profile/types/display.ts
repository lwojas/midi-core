/**
 * A text display's SysEx template — declarative byte layout, describing a device's LCD/text-line protocol
 * the same way `DeviceModeProfile.bankPrefix`/`bankEntry` describe a fader bank message: a fixed
 * prefix, a per-line id byte, a fixed byte sequence, then a fixed-width text payload the application fills in. This
 * is the shape `push-mk1.ts`'s own comment named as missing ("this profile doesn't model text-display feedback as a
 * `PhysicalControl` — there's no control kind for a multi-line text display") since neither `sysex` nor `setup`
 * models a byte template with a variable payload.
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

/**
 * Where a display's encoder-aligned segments sit within a line's `charCount` text (e.g. the Push mk1's 8 segments of
 * 8 characters, one above each encoder). Declarative data only: a segment is `width` characters starting at
 * `offsets[i]`, in physical left-to-right order, so a generic renderer can place per-column content without knowing
 * which device's LCD this is.
 */
export interface DisplaySegmentLayout {
  readonly width: number;
  readonly offsets: readonly number[];
}

/**
 * The characters a segment's level bar is drawn with. A segment of `width` characters renders as `open`, then
 * `width - 2` interior cells (each `empty`, `half` or `full`), then `close`, so a level resolves to half-cell steps.
 * Each is one printable character the device's display is verified to render (for the Push mk1, ASCII 32-126 only).
 */
export interface DisplayMeterGlyphs {
  readonly open: string;
  readonly close: string;
  readonly empty: string;
  readonly half: string;
  readonly full: string;
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
  /** Optional: where the encoder-aligned segments sit in a line. Needed (with `meter`) for a `DisplayMeterBinding`. */
  readonly segments?: DisplaySegmentLayout;
  /** Optional: the characters a segment's level bar is drawn with. Needed (with `segments`) for a `DisplayMeterBinding`. */
  readonly meter?: DisplayMeterGlyphs;
}
