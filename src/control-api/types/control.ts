/**
 * Application Control API — abstract controls/state.
 *
 * A Control represents one piece of application state a user or automated
 * source can read and change: a track's volume, a filter's cutoff, the
 * transport's playback status. The shape here is deliberately generic and
 * id-keyed rather than a fixed set of named fields (no `TrackControls` with
 * a hardcoded `volume`/`pan`/`mute`) — what controls exist, and what they're
 * called, is defined by whatever constructs them, not by this contract.
 *
 * This is independent of MIDI, UI and automation: nothing here references
 * a MIDI message, a DOM/React type, or an automation lane/event. Any of
 * those can be a source that calls setValue(), or a consumer that calls
 * getValue()/onChange() — the control itself doesn't know or care which.
 */

export type ControlId = string;

export type ControlValueKind = "number" | "boolean" | "enum" | "string";

export const CONTROL_VALUE_KINDS: readonly ControlValueKind[] = ["number", "boolean", "enum", "string"];

export function isControlValueKind(value: unknown): value is ControlValueKind {
  return typeof value === "string" && (CONTROL_VALUE_KINDS as readonly string[]).includes(value);
}

interface BaseControlDef {
  readonly id: ControlId;
  /** Human-readable label, e.g. for a UI or a MIDI-mapping picker. Not meant to be parsed. */
  readonly label: string;
}

/** A continuous or stepped numeric control, e.g. filter cutoff, track volume, tempo. */
export interface NumericControlDef extends BaseControlDef {
  readonly kind: "number";
  readonly min: number;
  readonly max: number;
  /** Granularity values are expected to land on, e.g. 1 for whole BPM. Omitted means continuous. */
  readonly step?: number;
  /** Display unit, e.g. "Hz", "dB", "%". Purely informational — Control API does no unit conversion. */
  readonly unit?: string;
  readonly default: number;
}

/** A two-state control, e.g. mute, solo, bypass. */
export interface BooleanControlDef extends BaseControlDef {
  readonly kind: "boolean";
  readonly default: boolean;
}

export interface EnumControlOption {
  readonly label: string;
  readonly value: string;
}

/**
 * A discrete control chosen from a fixed set of named options, e.g.
 * transport playback status or a filter's mode. Option values are always
 * strings: an implementation whose native representation is a numeric code
 * (e.g. a DSP engine's filter-mode enum) maps between that code and the
 * option's string value at its own adapter boundary, not here — Control
 * API does not encode any particular engine's representation.
 */
export interface EnumControlDef extends BaseControlDef {
  readonly kind: "enum";
  readonly options: readonly EnumControlOption[];
  readonly default: string;
}

/**
 * A free-text control, e.g. the current pattern name shown on a device's LCD (ECS-137). Generic application state —
 * not Push-specific, not tied to any particular display protocol; `src/surface/types/bindings.ts`'s `DisplayBinding`
 * is what pairs a control like this with a device's actual text-display SysEx template.
 */
export interface StringControlDef extends BaseControlDef {
  readonly kind: "string";
  /** The longest value a consumer can usefully show (e.g. a display's fixed character width). Omitted means no limit. */
  readonly maxLength?: number;
  readonly default: string;
}

export type ControlDef = NumericControlDef | BooleanControlDef | EnumControlDef | StringControlDef;

/** The value type a given ControlDef's Control reads and accepts. */
export type ControlValue<D extends ControlDef> = D extends NumericControlDef
  ? number
  : D extends BooleanControlDef
    ? boolean
    : D extends EnumControlDef
      ? string
      : D extends StringControlDef
        ? string
        : never;

/** Unsubscribes the listener it was returned from. */
export type Unsubscribe = () => void;

/**
 * A single control: its fixed definition, its current value, and a way to
 * change and observe it. Deliberately as small as MidiConnection in the
 * MIDI Core contract — reading, setting and observing is the whole
 * surface. What's bound to id/def (a track's volume, an FX instance's
 * cutoff) and what calls setValue() (UI, a MIDI mapping, automation) are
 * both the concern of layers built on top of this one.
 */
export interface Control<D extends ControlDef = ControlDef> {
  readonly def: D;
  getValue(): ControlValue<D>;
  setValue(value: ControlValue<D>): void;
  onChange(listener: (value: ControlValue<D>, previous: ControlValue<D>) => void): Unsubscribe;
}

function isOnStep(value: number, def: NumericControlDef): boolean {
  if (def.step === undefined || def.step <= 0) return true;
  const steps = (value - def.min) / def.step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

/**
 * Whether `value` is a legal value for `def` — the right JS type, within
 * range/step for a number, or a declared option for an enum. Pure
 * validation only, mirroring isChannel/isDataByte in the MIDI message
 * model: this contract defines what "valid" means, it doesn't clamp or
 * coerce a value into range.
 */
export function isValidControlValue(def: ControlDef, value: unknown): boolean {
  switch (def.kind) {
    case "number":
      return typeof value === "number" && Number.isFinite(value) && value >= def.min && value <= def.max && isOnStep(value, def);
    case "boolean":
      return typeof value === "boolean";
    case "enum":
      return typeof value === "string" && def.options.some((option) => option.value === value);
    case "string":
      return typeof value === "string" && (def.maxLength === undefined || value.length <= def.maxLength);
  }
}
