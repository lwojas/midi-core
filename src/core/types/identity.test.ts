import { describe, expect, it } from "vitest";
import { isPortType, PORT_TYPES } from "./identity.js";

describe("isPortType", () => {
  it("accepts every declared port type", () => {
    for (const type of PORT_TYPES) {
      expect(isPortType(type)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isPortType("duplex")).toBe(false);
    expect(isPortType(1)).toBe(false);
    expect(isPortType(undefined)).toBe(false);
  });
});
