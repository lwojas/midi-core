import { describe, expect, it } from "vitest";
import {
  CONNECTION_STATES,
  isConnectionState,
  isValidTransition,
  type ConnectionState,
} from "./lifecycle.js";

describe("isConnectionState", () => {
  it("accepts every declared state", () => {
    for (const state of CONNECTION_STATES) {
      expect(isConnectionState(state)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isConnectionState("open")).toBe(false);
    expect(isConnectionState(null)).toBe(false);
  });
});

describe("isValidTransition", () => {
  it("allows the happy path: available -> connecting -> connected -> disconnecting -> disconnected", () => {
    const path: ConnectionState[] = [
      "available",
      "connecting",
      "connected",
      "disconnecting",
      "disconnected",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(isValidTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("allows a re-appearing port to go disconnected -> available", () => {
    expect(isValidTransition("disconnected", "available")).toBe(true);
  });

  it("allows connecting/connected to fail into error", () => {
    expect(isValidTransition("connecting", "error")).toBe(true);
    expect(isValidTransition("connected", "error")).toBe(true);
  });

  it("rejects skipping straight from available to connected", () => {
    expect(isValidTransition("available", "connected")).toBe(false);
  });

  it("rejects transitions out of a terminal-for-now state like disconnected to connected", () => {
    expect(isValidTransition("disconnected", "connected")).toBe(false);
  });

  it("does not treat a state transitioning to itself as valid", () => {
    for (const state of CONNECTION_STATES) {
      expect(isValidTransition(state, state)).toBe(false);
    }
  });
});
