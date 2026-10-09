import type { ControlDef, ControlValue, NumericControlDef } from "../control-api/types/control.js";
import { PITCH_BEND_MAX, PITCH_BEND_MIN, type MidiMessage } from "../core/types/message.js";
import { matchesSource, type MidiSource, type MidiTarget, type RelativeEncoding, type RgbColour } from "./types/address.js";

/**
 * Value normalisation between a MIDI message's native range and a
 * control's declared range — the two directions of a mapping.
 *
 * Only three (source, control kind) pairings are supported, by design:
 *
 * | source          | number | boolean | enum |
 * |-----------------|:------:|:-------:|:----:|
 * | control-change  |   ✓    |    ✓    |  ✓   |
 * | pitch-bend      |   ✓    |         |      |
 * | note            |        |    ✓    |      |
 *
 * Control Change is MIDI's generic continuous-or-stepped controller
 * message, so it's the only source general enough to drive all three
 * control kinds (a knob with detents can reasonably select an enum option,
 * or cross a threshold as a boolean). Pitch bend is a dedicated physical
 * gesture with a meaningful center — it only ever means a continuous
 * number. A note press/release is inherently a discrete event — it only
 * ever means a boolean. Any other pairing (e.g. pitch bend onto a boolean)
 * is a misconfigured mapping, not a case this contract models; resolving
 * one returns `undefined` rather than throwing, the same choice
 * `decodeMidiMessage` makes for input it can't interpret — a bad mapping
 * authored by a future device-profile layer shouldn't be able to take
 * down a live input handler.
 *
 * Both directions are deliberately a fixed linear scale (or, for enum, an
 * even bucket split across the native range) with no per-mapping curve,
 * transform, or condition. That's a real extension point — e.g. an
 * exponential taper for a filter cutoff knob, or a condition gating a
 * mapping on another control's value — but no concrete mapping needs it
 * yet, so it isn't built speculatively here (see docs/contracts/mapping.md).
 */

/**
 * The signed delta a relative encoder's raw CC byte (0-127) represents, per `encoding` (ECS-137). Pure, generic
 * accumulate-and-clamp mechanics — reusable by any relative-encoder device, never Push-specific — kept separate from
 * `normalizeRanged()`'s direct scaling, which assumes the raw byte *is* a position, not a step.
 *
 * `"twos-complement-7bit"`: a value under 64 is a positive delta as-is; 64 and above is negative, read as a signed
 * 7-bit two's-complement byte (`value - 128`) — confirmed hands-on on the Ableton Push mk1 (ECS-136 gate): clockwise
 * sends `1`, `2`, ...; counter-clockwise sends `127`, `126`, `125`, ... .
 */
export function decodeRelativeDelta(raw: number, encoding: RelativeEncoding): number {
  switch (encoding) {
    case "twos-complement-7bit":
      return raw < 64 ? raw : raw - 128;
  }
}

/**
 * The control value an incoming `message` resolves to, given `source`
 * (what to match) and `def` (the target control's range/kind). Returns
 * `undefined` when `message` doesn't match `source`, or when the matched
 * source kind doesn't pair with `def.kind` per the table above.
 *
 * `relative` (ECS-137), when supplied, means `source` is a relative control: a matching control-change message's raw
 * value is decoded to a signed delta via `decodeRelativeDelta()` and added onto `relative.current` (clamped/snapped
 * to `def`'s step), instead of being normalized onto `def`'s range directly. Only defined for a numeric `def` — a
 * relative delta onto a boolean or enum control isn't a pairing this contract models (same "report, don't guess"
 * stance as every unsupported pairing below), and only for a `control-change` source, the only MIDI message kind a
 * relative encoder's turn is modeled as.
 */
export function resolveIncomingValue<D extends ControlDef>(
  message: MidiMessage,
  source: MidiSource,
  def: D,
  relative?: { readonly encoding: RelativeEncoding; readonly current: ControlValue<D> },
): ControlValue<D> | undefined {
  if (!matchesSource(message, source)) return undefined;

  if (relative && source.address.type === "control-change" && message.type === "control-change") {
    if (def.kind !== "number") return undefined;
    const delta = decodeRelativeDelta(message.value, relative.encoding);
    const current = relative.current as unknown as number;
    return clampToStep(current + delta, def) as ControlValue<D>;
  }

  if (source.address.type === "control-change" && message.type === "control-change") {
    return normalizeRanged(message.value, 0, 127, def);
  }

  if (source.address.type === "pitch-bend" && message.type === "pitch-bend") {
    if (def.kind !== "number") return undefined;
    return normalizeRanged(message.value, PITCH_BEND_MIN, PITCH_BEND_MAX, def);
  }

  if (source.address.type === "note" && (message.type === "note-on" || message.type === "note-off")) {
    if (def.kind !== "boolean") return undefined;
    // Many controllers (Launchpad included) send release as Note On velocity 0, so velocity 0 is off here even though Core keeps it a Note On.
    const on = message.type === "note-on" && message.velocity > 0;
    return on as ControlValue<D>;
  }

  return undefined;
}

/**
 * The outgoing feedback message for `value`, given `target` (where to send
 * it) and `def` (the control's range/kind). Returns `undefined` when
 * `target`'s address kind doesn't pair with `def.kind` per the table above.
 *
 * `target.dimValue` (ECS-145): for a boolean control whose target declares one, `false` renders as `dimValue`
 * instead of the address kind's native minimum — a resting, dim-but-visible LED level in place of fully off, for a
 * control that's live in the current mode but not currently held/active. `true` is unaffected (still the native
 * maximum). Omitted, every boolean renders exactly as before this field existed: `false` is the native minimum,
 * `true` is the native maximum. Turning a control fully, truly off (e.g. when a mode stops binding it at all) is a
 * separate concern a caller gets by stripping `dimValue` from `target` before calling this, not a third value
 * passed in here — see `src/surface/bindings.ts`'s `offTarget()`.
 */
export function buildFeedbackMessage<D extends ControlDef>(
  target: MidiTarget,
  def: D,
  value: ControlValue<D>,
  lit?: RgbColour,
): MidiMessage | undefined {
  if (target.rgbPrefix !== undefined) return buildRgbFeedbackMessage(target, def, value, lit);
  switch (target.address.type) {
    case "control-change": {
      if (def.kind === "boolean" && target.dimValue !== undefined) {
        const on = value as unknown as boolean;
        return { type: "control-change", channel: target.channel, controller: target.address.controller, value: on ? 127 : target.dimValue };
      }
      const native = denormalizeRanged(value, def, 0, 127);
      return native === undefined
        ? undefined
        : { type: "control-change", channel: target.channel, controller: target.address.controller, value: native };
    }
    case "pitch-bend": {
      if (def.kind !== "number") return undefined;
      const native = denormalizeRanged(value, def, PITCH_BEND_MIN, PITCH_BEND_MAX);
      return native === undefined ? undefined : { type: "pitch-bend", channel: target.channel, value: native };
    }
    case "note": {
      if (def.kind !== "boolean") return undefined;
      const on = value as unknown as boolean;
      if (on && lit !== undefined && target.colourPalette !== undefined) {
        const match = target.colourPalette.find((entry) => coloursEqual(entry.colour, lit));
        if (match !== undefined) {
          return { type: "note-on", channel: target.channel, note: target.address.note, velocity: match.velocity };
        }
      }
      if (target.dimValue !== undefined) {
        return { type: "note-on", channel: target.channel, note: target.address.note, velocity: on ? 127 : target.dimValue };
      }
      return {
        type: on ? "note-on" : "note-off",
        channel: target.channel,
        note: target.address.note,
        velocity: on ? 127 : 0,
      };
    }
  }
}

/** Exact per-channel match (ECS-150) — `colourPalette` entries are discrete confirmed points, not a continuous scale to find the nearest of. */
function coloursEqual(a: RgbColour, b: RgbColour): boolean {
  return a.red === b.red && a.green === b.green && a.blue === b.blue;
}

/** An RGB LED with no colour of its own is lit white. Off is black. */
const RGB_DEFAULT_LIT: RgbColour = { red: 127, green: 127, blue: 127 };
const RGB_OFF: RgbColour = { red: 0, green: 0, blue: 0 };

/**
 * A boolean control on an RGB LED (ECS-95), as a device SysEx message: on shows `lit` (or white), off is black. The
 * LED index is the note or controller the control's address names, which is how the device numbers its LEDs in
 * Programmer mode. Anything else has no RGB form.
 */
function buildRgbFeedbackMessage<D extends ControlDef>(target: MidiTarget, def: D, value: ControlValue<D>, lit: RgbColour | undefined): MidiMessage | undefined {
  if (def.kind !== "boolean" || target.rgbPrefix === undefined) return undefined;
  const led = target.address.type === "note" ? target.address.note : target.address.type === "control-change" ? target.address.controller : undefined;
  if (led === undefined) return undefined;
  const on = value as unknown as boolean;
  const { red, green, blue } = on ? (lit ?? RGB_DEFAULT_LIT) : RGB_OFF;
  return { type: "sysex", raw: Uint8Array.of(0xf0, ...target.rgbPrefix, led, red, green, blue, 0xf7) };
}

function normalizeRanged<D extends ControlDef>(
  native: number,
  nativeMin: number,
  nativeMax: number,
  def: D,
): ControlValue<D> | undefined {
  const t = (native - nativeMin) / (nativeMax - nativeMin);

  switch (def.kind) {
    case "number":
      return clampToStep(def.min + t * (def.max - def.min), def) as ControlValue<D>;
    case "boolean":
      return (t >= 0.5) as ControlValue<D>;
    case "enum": {
      const option = def.options[bucketIndex(t, def.options.length)];
      return option === undefined ? undefined : (option.value as ControlValue<D>);
    }
  }
}

function denormalizeRanged<D extends ControlDef>(
  value: ControlValue<D>,
  def: D,
  nativeMin: number,
  nativeMax: number,
): number | undefined {
  switch (def.kind) {
    case "number": {
      const t = ((value as unknown as number) - def.min) / (def.max - def.min);
      return Math.round(nativeMin + t * (nativeMax - nativeMin));
    }
    case "boolean":
      return (value as unknown as boolean) ? nativeMax : nativeMin;
    case "enum": {
      const index = def.options.findIndex((option) => option.value === (value as unknown as string));
      if (index === -1) return undefined;
      const bucketWidth = (nativeMax - nativeMin + 1) / def.options.length;
      return Math.min(nativeMax, Math.floor(nativeMin + index * bucketWidth + bucketWidth / 2));
    }
  }
}

function bucketIndex(t: number, bucketCount: number): number {
  if (bucketCount <= 0) return -1;
  return Math.min(bucketCount - 1, Math.floor(t * bucketCount));
}

function clampToStep(value: number, def: NumericControlDef): number {
  let result = value;
  if (def.step !== undefined && def.step > 0) {
    const steps = Math.round((value - def.min) / def.step);
    result = def.min + steps * def.step;
  }
  return Math.min(def.max, Math.max(def.min, result));
}
