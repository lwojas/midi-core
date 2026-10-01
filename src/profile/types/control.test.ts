import { describe, expect, it } from "vitest";
import {
  CONTROL_KINDS,
  CONTROL_VALUE_MODES,
  FEEDBACK_KINDS,
  isControlKind,
  isControlValueMode,
  isFeedbackKind,
} from "./control.js";

describe("isControlKind", () => {
  it("accepts every declared kind", () => {
    for (const kind of CONTROL_KINDS) {
      expect(isControlKind(kind)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isControlKind("key")).toBe(false);
    expect(isControlKind(undefined)).toBe(false);
  });
});

describe("isControlValueMode", () => {
  it("accepts every declared mode", () => {
    for (const mode of CONTROL_VALUE_MODES) {
      expect(isControlValueMode(mode)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isControlValueMode("incremental")).toBe(false);
  });
});

describe("isFeedbackKind", () => {
  it("accepts every declared kind", () => {
    for (const kind of FEEDBACK_KINDS) {
      expect(isFeedbackKind(kind)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isFeedbackKind("none")).toBe(false);
    expect(isFeedbackKind(1)).toBe(false);
  });
});
