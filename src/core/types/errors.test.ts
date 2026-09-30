import { describe, expect, it } from "vitest";
import { isMidiTransportErrorCode, MIDI_TRANSPORT_ERROR_CODES } from "./errors.js";

describe("isMidiTransportErrorCode", () => {
  it("accepts every declared code", () => {
    for (const code of MIDI_TRANSPORT_ERROR_CODES) {
      expect(isMidiTransportErrorCode(code)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isMidiTransportErrorCode("timeout")).toBe(false);
    expect(isMidiTransportErrorCode(42)).toBe(false);
  });
});
