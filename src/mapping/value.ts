import type { ControlDef, ControlValue, NumericControlDef } from "../control-api/types/control.js";
import { PITCH_BEND_MAX, PITCH_BEND_MIN, type MidiMessage } from "../core/types/message.js";
import { matchesSource, type MidiSource, type MidiTarget, type RgbColour } from "./types/address.js";

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
 * The control value an incoming `message` resolves to, given `source`
 * (what to match) and `def` (the target control's range/kind). Returns
 * `undefined` when `message` doesn't match `source`, or when the matched
 * source kind doesn't pair with `def.kind` per the table above.
 */
export function resolveIncomingValue<D extends ControlDef>(
  message: MidiMessage,
  source: MidiSource,
  def: D,
): ControlValue<D> | undefined {
  if (!matchesSource(message, source)) return undefined;

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
      return {
        type: on ? "note-on" : "note-off",
        channel: target.channel,
        note: target.address.note,
        velocity: on ? 127 : 0,
      };
    }
  }
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
