import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PUSH_MK1_DISPLAY, PUSH_MK1_PROFILE } from "../profile/devices/push-mk1.js";
import { validateDeviceProfile } from "../profile/validation/validate-profile.js";
import { createControl } from "../control-api/control.js";
import { buildMeterText, createLineWriter, describeSegmentLabel, describeSegmentValue, DISPLAY_LINE_MIN_INTERVAL_MS } from "./display-binding.js";

const { charCount, segments, meter } = PUSH_MK1_DISPLAY;

describe("buildMeterText", () => {
  it("draws each level into its declared segment and leaves the rest blank, always charCount long", () => {
    const text = buildMeterText(charCount!, segments!, meter!, [0, 0.5, 1]);
    expect(text).toHaveLength(68);
    expect(text.slice(0, 8)).toBe("[      ]");
    expect(text.slice(8, 16)).toBe("[===   ]");
    expect(text.slice(17, 25)).toBe("[======]");
    expect(text.slice(25).trim()).toBe(""); // segments with no level stay blank
  });

  it("resolves to half cells, clamps out-of-range levels, and blanks a non-finite one", () => {
    const text = buildMeterText(charCount!, segments!, meter!, [1 / 12, -3, 7, Number.NaN]);
    expect(text.slice(0, 8)).toBe("[-     ]");
    expect(text.slice(8, 16)).toBe("[      ]");
    expect(text.slice(17, 25)).toBe("[======]");
    expect(text.slice(25, 33)).toBe("        ");
  });

  it("uses only printable ASCII, the characters verified to render on the Push display", () => {
    const text = buildMeterText(charCount!, segments!, meter!, [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1, 0.45]);
    for (const character of text) expect(character.charCodeAt(0)).toBeGreaterThanOrEqual(0x20);
    for (const character of text) expect(character.charCodeAt(0)).toBeLessThanOrEqual(0x7e);
  });

  it("keeps every Push segment inside the line", () => {
    for (const offset of segments!.offsets) expect(offset + segments!.width).toBeLessThanOrEqual(charCount);
  });
});

describe("createLineWriter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends an isolated write immediately, with no added latency", () => {
    const send = vi.fn();
    const writer = createLineWriter(send);
    writer.write("a");
    expect(send).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("coalesces writes inside the interval into one trailing write of the latest text", () => {
    const send = vi.fn();
    const writer = createLineWriter(send);
    writer.write("a");
    writer.write("b");
    writer.write("c");
    writer.write("d");
    expect(send.mock.calls.map(([text]) => text)).toEqual(["a"]);

    vi.advanceTimersByTime(DISPLAY_LINE_MIN_INTERVAL_MS);
    expect(send.mock.calls.map(([text]) => text)).toEqual(["a", "d"]);
    vi.advanceTimersByTime(DISPLAY_LINE_MIN_INTERVAL_MS * 5);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends nothing for a burst that ends back on the text already shown", () => {
    const send = vi.fn();
    const writer = createLineWriter(send);
    writer.write("a");
    writer.write("b");
    writer.write("a");
    vi.advanceTimersByTime(DISPLAY_LINE_MIN_INTERVAL_MS);
    expect(send).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("never sends faster than the interval, however fast it is written to", () => {
    const send = vi.fn();
    const writer = createLineWriter(send);
    for (let elapsed = 0; elapsed < 1000; elapsed += 1) {
      writer.write(String(elapsed));
      vi.advanceTimersByTime(1);
    }
    vi.advanceTimersByTime(DISPLAY_LINE_MIN_INTERVAL_MS);
    expect(send.mock.calls.length).toBeLessThanOrEqual(Math.ceil(1000 / DISPLAY_LINE_MIN_INTERVAL_MS) + 2);
    expect(send.mock.calls[send.mock.calls.length - 1]?.[0]).toBe("999"); // and still ends on the latest
  });

  it("paints straight away, dropping any pending write; dispose drops it too", () => {
    const send = vi.fn();
    const writer = createLineWriter(send);
    writer.write("a");
    writer.write("b");
    writer.paint("full");
    vi.advanceTimersByTime(DISPLAY_LINE_MIN_INTERVAL_MS * 2);
    expect(send.mock.calls.map(([text]) => text)).toEqual(["a", "full"]);

    writer.write("c");
    writer.write("d");
    writer.dispose();
    vi.advanceTimersByTime(DISPLAY_LINE_MIN_INTERVAL_MS * 2);
    expect(send.mock.calls.map(([text]) => text)).toEqual(["a", "full", "c"]);
  });
});

describe("display meter profile validation", () => {
  const validate = (display: object) => validateDeviceProfile({ ...PUSH_MK1_PROFILE, displays: [{ ...PUSH_MK1_DISPLAY, ...display }] });

  it("accepts the Push mk1's own declaration", () => {
    expect(validateDeviceProfile(PUSH_MK1_PROFILE).filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("rejects a segment that runs past the line, a non-ASCII glyph, and segments without a meter", () => {
    expect(validate({ segments: { width: 8, offsets: [0, 62] } })).toContainEqual(expect.objectContaining({ code: "invalid-display", path: "displays[0].segments.offsets[1]" }));
    expect(validate({ meter: { ...PUSH_MK1_DISPLAY.meter, full: "█" } })).toContainEqual(expect.objectContaining({ code: "invalid-display", path: "displays[0].meter" }));
    expect(validate({ meter: undefined })).toContainEqual(expect.objectContaining({ code: "invalid-display", path: "displays[0].meter" }));
  });
});

describe("describeSegmentValue / describeSegmentLabel", () => {
  const num = (min: number, max: number, value: number, step?: number) =>
    createControl({ id: "p", label: "Filter Cutoff", kind: "number", min, max, default: min, ...(step !== undefined ? { step } : {}) }, value);

  it("draws a continuous number as a proportional bar", () => {
    expect(describeSegmentValue(num(0, 1, 0), meter!, 8)).toBe("[      ]");
    expect(describeSegmentValue(num(0, 1, 0.5), meter!, 8)).toBe("[===   ]");
    expect(describeSegmentValue(num(0, 1, 1), meter!, 8)).toBe("[======]");
  });

  it("does not draw a bar for two-state, few-step, boolean or enum controls", () => {
    expect(describeSegmentValue(num(0, 1, 1, 1), meter!, 8)).toBe("[  ON  ]");
    expect(describeSegmentValue(num(0, 3, 2, 1), meter!, 8)).toBe("[  2   ]");
    const flag = createControl({ id: "b", label: "Bypass", kind: "boolean", default: false }, true);
    expect(describeSegmentValue(flag, meter!, 8)).toBe("[  ON  ]");
    const mode = createControl({ id: "e", label: "Type", kind: "enum", options: [{ label: "Low pass", value: "lp" }], default: "lp" }, "lp");
    expect(describeSegmentValue(mode, meter!, 8)).toBe("[LOW PA]");
    const text = createControl({ id: "s", label: "Name", kind: "string", default: "" }, "x");
    expect(describeSegmentValue(text, meter!, 8)).toBeUndefined();
  });

  it("uppercases a label and cuts it one column short of the segment", () => {
    expect(describeSegmentLabel(num(0, 1, 0), 8)).toBe("FILTER ");
    expect(describeSegmentLabel(createControl({ id: "r", label: "Resonance", kind: "number", min: 0, max: 1, default: 0 }, 0), 8)).toBe("RESONAN");
    expect(describeSegmentLabel(createControl({ id: "m", label: "Mix", kind: "number", min: 0, max: 1, default: 0 }, 0), 8)).toBe("MIX");
  });
});
