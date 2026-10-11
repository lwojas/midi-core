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
 * What one segment shows for `control`, chosen by what the control *is* (its own `kind`/`min`/`max`/`step`/`options`,
 * the same metadata the encoder's scaling reads) -- one `width`-character string:
 *
 * - a continuous number: a level bar, `open`, `width - 2` interior cells (`full`/`half`/`empty`), `close`, so a value
 *   resolves to half-cell steps and only changes the text when it crosses one;
 * - a two-state number (one `step` across its range) or a boolean: `ON`/`OFF` in the brackets, not a bar that
 *   pretends to be continuous;
 * - a number with only a few steps (fewer positions than the bar has half-cells): its value, in the brackets;
 * - an enum: the current option's label, in the brackets.
 *
 * A text value is uppercased and truncated to the interior, centred. `undefined` for a string control, which has no
 * compact value form.
 */
export function describeSegmentValue(control: Control<ControlDef>, glyphs: DisplayMeterGlyphs, width: number): string | undefined {
  const { def } = control;
  const interior = width - 2;
  const framed = (text: string) => {
    const clipped = text.toUpperCase().slice(0, interior);
    const left = Math.floor((interior - clipped.length) / 2);
    return glyphs.open + " ".repeat(left) + clipped + " ".repeat(interior - clipped.length - left) + glyphs.close;
  };
  if (def.kind === "string") return undefined;
  const value = control.getValue();
  if (def.kind === "boolean") return framed(value ? "on" : "off");
  if (def.kind === "enum") return framed(def.options.find((option) => option.value === value)?.label ?? String(value));

  const { min, max } = def;
  const positions = def.step !== undefined && def.step > 0 && max > min ? Math.round((max - min) / def.step) + 1 : Infinity;
  if (positions === 2) return framed(value === min ? "off" : "on");
  const number = value as number;
  if (positions <= interior * 2) return framed(Number.isInteger(number) ? String(number) : number.toFixed(1));
  return levelBar(max > min ? (number - min) / (max - min) : 0, glyphs, width);
}

/** One level bar: `open`, `width - 2` interior cells at half-cell resolution, `close`. `level` is clamped to 0-1. */
function levelBar(level: number, glyphs: DisplayMeterGlyphs, width: number): string {
  const interior = width - 2;
  const halves = Math.round(Math.min(1, Math.max(0, level)) * interior * 2);
  const bar = [glyphs.open];
  for (let cell = 0; cell < interior; cell += 1) {
    const filled = halves - cell * 2;
    bar.push(filled >= 2 ? glyphs.full : filled === 1 ? glyphs.half : glyphs.empty);
  }
  bar.push(glyphs.close);
  return bar.join("");
}

/**
 * A line of per-segment text: `cells[i]` is written into segment `i` of `segments`, clipped to the segment's width
 * (`undefined` leaves that segment blank, for a position with no control behind it). Pure placement from declared
 * data (`DisplaySegmentLayout`) -- no device knowledge, so which offsets a given LCD uses stays in its profile.
 */
export function buildSegmentText(charCount: number, segments: DisplaySegmentLayout, cells: ReadonlyArray<string | undefined>): string {
  const characters = new Array<string>(charCount).fill(" ");
  segments.offsets.forEach((offset, index) => {
    const cell = cells[index];
    if (cell === undefined) return;
    Array.from(cell.slice(0, segments.width)).forEach((character, position) => {
      characters[offset + position] = character;
    });
  });
  return characters.join("");
}

/**
 * A segment's name, from the control's existing `label`: uppercased and truncated to one column short of the
 * segment, so two labels in neighbouring segments (which sit flush) never run together. Deterministic and simple:
 * a name is cut to fit, never abbreviated (`"Filter Cutoff"` in an 8-wide segment reads `"FILTER "`, `"Resonance"`
 * reads `"RESONAN"`).
 */
export function describeSegmentLabel(control: Control<ControlDef>, width: number): string {
  return control.def.label.toUpperCase().slice(0, Math.max(0, width - 1));
}

/**
 * The line text for a row of per-segment level bars: `levels[i]` is a 0-1 fraction drawn into segment `i` of
 * `segments` (`undefined` leaves that segment blank). See `describeSegmentValue()` for the value forms a live control
 * gets; this is the bar alone, from a bare fraction.
 */
export function buildMeterText(
  charCount: number,
  segments: DisplaySegmentLayout,
  glyphs: DisplayMeterGlyphs,
  levels: ReadonlyArray<number | undefined>,
): string {
  return buildSegmentText(
    charCount,
    segments,
    levels.map((level) => (level === undefined || !Number.isFinite(level) ? undefined : levelBar(level, glyphs, segments.width))),
  );
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
