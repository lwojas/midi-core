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
