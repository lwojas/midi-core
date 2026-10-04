import { describe, expect, it } from "vitest";
import {
  SURFACE_LIFECYCLE_STATES,
  isSurfaceAttachable,
  isSurfaceLifecycleState,
  isValidSurfaceTransition,
  type SurfaceLifecycleState,
} from "./lifecycle.js";

describe("isSurfaceLifecycleState", () => {
  it("accepts every declared state", () => {
    for (const state of SURFACE_LIFECYCLE_STATES) {
      expect(isSurfaceLifecycleState(state)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isSurfaceLifecycleState("connected")).toBe(false);
    expect(isSurfaceLifecycleState(null)).toBe(false);
  });
});

describe("isValidSurfaceTransition", () => {
  it("allows the happy path: detached -> attaching -> attached -> detaching -> detached", () => {
    const path: SurfaceLifecycleState[] = ["detached", "attaching", "attached", "detaching", "detached"];
    for (let i = 0; i < path.length - 1; i++) {
      expect(isValidSurfaceTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("allows giving up mid-attach by going straight to detaching", () => {
    expect(isValidSurfaceTransition("attaching", "detaching")).toBe(true);
  });

  it("allows attaching/attached/detaching to fail into error", () => {
    expect(isValidSurfaceTransition("attaching", "error")).toBe(true);
    expect(isValidSurfaceTransition("attached", "error")).toBe(true);
    expect(isValidSurfaceTransition("detaching", "error")).toBe(true);
  });

  it("allows recovering from error only back to detached", () => {
    expect(isValidSurfaceTransition("error", "detached")).toBe(true);
    expect(isValidSurfaceTransition("error", "attached")).toBe(false);
  });

  it("rejects skipping straight from detached to attached", () => {
    expect(isValidSurfaceTransition("detached", "attached")).toBe(false);
  });

  it("does not treat a state transitioning to itself as valid", () => {
    for (const state of SURFACE_LIFECYCLE_STATES) {
      expect(isValidSurfaceTransition(state, state)).toBe(false);
    }
  });
});

describe("isSurfaceAttachable", () => {
  it("is true when every required port is available or connected", () => {
    expect(isSurfaceAttachable(["available", "available"])).toBe(true);
    expect(isSurfaceAttachable(["connected", "available"])).toBe(true);
  });

  it("is true for no required ports (vacuously attachable)", () => {
    expect(isSurfaceAttachable([])).toBe(true);
  });

  it("is false if any required port isn't available or connected", () => {
    expect(isSurfaceAttachable(["available", "disconnected"])).toBe(false);
    expect(isSurfaceAttachable(["connecting"])).toBe(false);
    expect(isSurfaceAttachable(["error"])).toBe(false);
  });
});
