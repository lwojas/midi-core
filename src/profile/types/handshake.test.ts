import { describe, expect, it } from "vitest";
import { HANDSHAKE_DIRECTIONS, isHandshakeDirection } from "./handshake.js";

describe("isHandshakeDirection", () => {
  it("accepts every declared direction", () => {
    for (const direction of HANDSHAKE_DIRECTIONS) {
      expect(isHandshakeDirection(direction)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isHandshakeDirection("receive")).toBe(false);
    expect(isHandshakeDirection(undefined)).toBe(false);
  });
});
