import type { Control, ControlDef } from "../control-api/types/control.js";
import type { MidiMessage } from "../core/types/message.js";
import type { DeviceDisplayDefinition, DisplayLineTemplate, DisplayMeterGlyphs, DisplaySegmentLayout } from "../profile/types/display.js";

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

/**
 * The line text for a row of per-segment level bars: `levels[i]` is a 0-1 fraction drawn into segment `i` of
 * `segments` (`undefined` leaves that segment blank, for a position with no control behind it). Pure formatting from
 * declared data (`DisplaySegmentLayout`, `DisplayMeterGlyphs`) -- no device knowledge, so which characters and
 * offsets a given LCD uses stays in its profile. A bar is `open`, `width - 2` interior cells, `close`; the
 * interior resolves to half-cell steps (`full`/`half`/`empty`), so a level reads at a glance and only changes the
 * text (and so only costs a display write) when it crosses one of those steps.
 */
export function buildMeterText(
  charCount: number,
  segments: DisplaySegmentLayout,
  glyphs: DisplayMeterGlyphs,
  levels: ReadonlyArray<number | undefined>,
): string {
  const characters = new Array<string>(charCount).fill(" ");
  const interior = segments.width - 2;
  segments.offsets.forEach((offset, index) => {
    const level = levels[index];
    if (level === undefined || !Number.isFinite(level)) return;
    const halves = Math.round(Math.min(1, Math.max(0, level)) * interior * 2);
    const bar = [glyphs.open];
    for (let cell = 0; cell < interior; cell += 1) {
      const filled = halves - cell * 2;
      bar.push(filled >= 2 ? glyphs.full : filled === 1 ? glyphs.half : glyphs.empty);
    }
    bar.push(glyphs.close);
    bar.forEach((character, position) => {
      characters[offset + position] = character;
    });
  });
  return characters.join("");
}

/**
 * Minimum gap between two writes to one display line. A turning encoder changes a line's text on every detent;
 * past this rate the intermediate texts are unreadable anyway, and only the latest matters. About 25 writes a second
 * keeps a line visibly live while bounding the SysEx traffic one line can generate.
 */
export const DISPLAY_LINE_MIN_INTERVAL_MS = 40;

/**
 * Serializes and coalesces writes to one display line. The first write after a quiet period goes out immediately,
 * so an isolated change has no added latency; writes arriving within `minIntervalMs` of the last one replace each
 * other and the latest goes out when the interval elapses (an update that lands back on the text already shown
 * sends nothing). `paint()` always writes straight away, for a mode's initial/full repaint. Nothing is queued: at
 * most one write is ever pending per line.
 */
export function createLineWriter(send: (text: string) => void, minIntervalMs: number = DISPLAY_LINE_MIN_INTERVAL_MS) {
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let lastSent: string | undefined;
  let pending: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const emit = (text: string) => {
    lastSent = text;
    lastSentAt = Date.now();
    send(text);
  };
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };

  return {
    paint(text: string): void {
      cancel();
      emit(text);
    },
    write(text: string): void {
      const wait = lastSentAt + minIntervalMs - Date.now();
      if (timer === undefined && wait <= 0) {
        if (text !== lastSent) emit(text);
        return;
      }
      pending = text;
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        const next = pending;
        pending = undefined;
        if (next !== undefined && next !== lastSent) emit(next);
      }, Math.max(0, wait));
    },
    dispose: cancel,
  };
}
