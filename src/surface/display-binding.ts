import type { Control, ControlDef } from "../control-api/types/control.js";
import type { MidiMessage } from "../core/types/message.js";
import type { DeviceDisplayDefinition, DisplayLineTemplate } from "../profile/types/display.js";

/**
 * Builds the raw SysEx message that writes `text` to one line of a declarative device display (ECS-137),
 * generically: `prefix`, then `line.lineId`, then `textPrefix`, then `charCount` ASCII bytes (space-padded or
 * truncated to fit), then F7. No device knowledge beyond what `DeviceDisplayDefinition`/`DisplayLineTemplate`
 * already declare — the same "describes, doesn't invent" byte-template mechanism `DeviceModeProfile.bankPrefix`
 * already uses for fader banks, extended to a variable-length text payload.
 *
 * Non-ASCII characters are not transliterated or rejected here — each character's code point is masked to 7 bits
 * (`& 0x7f`), the same "don't guess, don't throw" stance the rest of this layer takes for input it can't interpret
 * cleanly; a caller that needs stricter validation can check `text` against `charCount`/ASCII-only itself before
 * calling this.
 */
export function buildDisplayMessage(display: DeviceDisplayDefinition, line: DisplayLineTemplate, text: string): MidiMessage {
  const characters = text.slice(0, display.charCount).padEnd(display.charCount, " ");
  const textBytes = Array.from(characters, (character) => character.charCodeAt(0) & 0x7f);
  return {
    type: "sysex",
    raw: Uint8Array.of(...display.prefix, line.lineId, ...display.textPrefix, ...textBytes, 0xf7),
  };
}

/**
 * The plain text a display line shows for `control`: a string control's own value, or — for every other kind — the
 * control's existing `label` and current value (`"Cutoff 0.50 Hz"`, `"Playing on"`), so a parameter's name and
 * value reach a display from the one place the Control API already keeps them rather than a parallel text control.
 * Device-agnostic and layout-free: character budget, padding and encoding stay in `buildDisplayMessage()`.
 */
export function describeControlText(control: Control<ControlDef>): string {
  const { def } = control;
  const value = control.getValue();
  if (def.kind === "string") return String(value);
  if (def.kind === "number") {
    const number = value as number;
    const text = Number.isInteger(number) ? String(number) : number.toFixed(2);
    return `${def.label} ${text}${def.unit ? ` ${def.unit}` : ""}`;
  }
  if (def.kind === "boolean") return `${def.label} ${value ? "on" : "off"}`;
  return `${def.label} ${String(value)}`;
}
