import type { Channel } from "../../core/types/message.js";

/**
 * Physical controls — the knobs, pads, buttons, faders, encoders and wheels
 * a device actually has, and where each one lives on the wire.
 *
 * `ControlSurfaceAddress` is deliberately its own type, not a reuse of
 * `mapping/types/address.ts`'s `MidiAddress`. That type is scoped to the
 * three message kinds that function as *application* controller surfaces
 * (control-change, note, pitch-bend) and explicitly leaves out program
 * change and aftertouch as not controller surfaces "in the same sense" —
 * a judgment call that belongs to the mapping contract, not to describing
 * a device. Real hardware does use program change (scene/preset buttons)
 * and aftertouch (pressure strips, pressure-sensitive pads) as physical
 * controls, so a profile's address model has to be broader than the one
 * the mapping layer scoped itself to. Keeping them separate also keeps
 * this schema's only dependency pointed at Core, not at the mapping layer.
 *
 * Unlike `mapping`'s `MidiSource.channel` (which allows `"any"`, because a
 * mapping is authored once and applied regardless of which channel a
 * device happens to use), a profile is describing one real device's actual
 * wiring, so `channel`, when present, is always a concrete `Channel` — never
 * `"any"`. It's optional only to let a profile record a *partially*
 * resolved fact (ECS-62): evidence sometimes documents a control's address
 * — a note or CC number — without ever stating which channel plain
 * reporting uses. Omitting `channel` lets that address still be recorded
 * (with the missing channel named in the generation pipeline's own
 * `unresolved`), rather than forcing a choice between inventing a channel
 * or discarding the whole `input`/`feedback` object and the address with
 * it.
 */

export interface ControlChangeAddress {
  readonly type: "control-change";
  readonly controller: number; // 0-127
}

export interface NoteAddress {
  readonly type: "note";
  readonly note: number; // 0-127
}

export interface PitchBendAddress {
  readonly type: "pitch-bend";
}

export interface ProgramChangeAddress {
  readonly type: "program-change";
  readonly program: number; // 0-127
}

export interface ChannelPressureAddress {
  readonly type: "channel-pressure";
}

export interface PolyPressureAddress {
  readonly type: "poly-pressure";
  readonly note: number; // 0-127
}

export type ControlSurfaceAddress =
  | ControlChangeAddress
  | NoteAddress
  | PitchBendAddress
  | ProgramChangeAddress
  | ChannelPressureAddress
  | PolyPressureAddress;

export interface ControlAddress {
  readonly address: ControlSurfaceAddress;
  /** Omitted means the address is documented but which channel it's reported/driven on isn't resolved yet — see the doc comment above. */
  readonly channel?: Channel;
}

/** The kinds of physical control this schema models. Keyboard keybeds are out of scope — see docs/contracts/device-profile.md. */
export type ControlKind = "button" | "pad" | "knob" | "encoder" | "fader" | "wheel";

export const CONTROL_KINDS: readonly ControlKind[] = ["button", "pad", "knob", "encoder", "fader", "wheel"];

export function isControlKind(value: unknown): value is ControlKind {
  return typeof value === "string" && (CONTROL_KINDS as readonly string[]).includes(value);
}

/**
 * How a continuous/incremental control reports its value. "relative" is a
 * real, common encoder behavior (each turn sends an increment/decrement,
 * not a position), purely descriptive of the device's wire behavior —
 * interpreting a relative value into an application control's range is a
 * mapping-layer concern, not this schema's. Omitted means "absolute",
 * the far more common case (faders, most knobs, pads' velocity).
 */
export type ControlValueMode = "absolute" | "relative";

export const CONTROL_VALUE_MODES: readonly ControlValueMode[] = ["absolute", "relative"];

export function isControlValueMode(value: unknown): value is ControlValueMode {
  return typeof value === "string" && (CONTROL_VALUE_MODES as readonly string[]).includes(value);
}

/**
 * Output/LED feedback a control supports. "motorized" covers physical
 * position feedback (a motorized fader), named in the same terms
 * docs/contracts/mapping.md already uses ("a motorized fader, an LED
 * ring") for the application-level feedback concept this describes the
 * device side of.
 */
export type FeedbackKind = "monochrome-led" | "velocity-color-led" | "rgb-led" | "motorized";

export const FEEDBACK_KINDS: readonly FeedbackKind[] = [
  "monochrome-led",
  "velocity-color-led",
  "rgb-led",
  "motorized",
];

export function isFeedbackKind(value: unknown): value is FeedbackKind {
  return typeof value === "string" && (FEEDBACK_KINDS as readonly string[]).includes(value);
}

export interface ControlFeedback {
  readonly kind: FeedbackKind;
  /** Where an outgoing feedback message for this control is sent — may differ from `PhysicalControl.input`'s address. */
  readonly address: ControlAddress;
  /** For "velocity-color-led": the number of distinct palette entries the device's value byte selects from (e.g. 128). Not meaningful for other kinds. */
  readonly paletteSize?: number;
  /**
   * For "rgb-led" (ECS-95): the SysEx bytes before the LED index, without the leading F0. The device's LED message is
   * F0, these bytes, the LED index (the control's note or controller), red, green, blue, F7.
   */
  readonly rgbSysExPrefix?: readonly number[];
}

/**
 * One physical control on the device. `input` and `feedback` are both
 * optional and independent: a control can be input-only (most buttons),
 * feedback-only (a pure indicator LED with no actuation), or both (a pad
 * whose press also lights its own LED). A profile with neither on some
 * control isn't a case this schema rules out here — see
 * docs/contracts/device-profile.md for why that's left to ECS-42.
 *
 * `portId` and `feedbackPortId` exist because a device's ports are split
 * by direction (`DevicePortProfile`/`PortType`), so one physical
 * bidirectional control can genuinely span two port entries. By
 * convention (ECS-62), `portId` always names the control's *input*-
 * direction port; `feedbackPortId` names `feedback`'s own port only when
 * it's a different port than `portId` and worth stating explicitly. Omit
 * `feedbackPortId` when the control has no `feedback`, or when which port
 * backs it hasn't been pinned down — see the profile's own
 * `fieldProvenance` (midi-profiler) for how that was determined.
 */
export interface PhysicalControl {
  readonly id: string;
  readonly label: string;
  readonly kind: ControlKind;
  /** The `DevicePortProfile.id` this control's `input` communicates on, by convention always the input-direction port. */
  readonly portId: string;
  readonly input?: ControlAddress;
  readonly feedback?: ControlFeedback;
  /** The `DevicePortProfile.id` this control's `feedback` is sent on, when worth naming explicitly and different from `portId`. */
  readonly feedbackPortId?: string;
  readonly valueMode?: ControlValueMode;
}
