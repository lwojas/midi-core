import { describe, expect, it } from "vitest";
import { createMockSurfaceDevice } from "./mock-surface-device.js";

describe("createMockSurfaceDevice", () => {
  it("pairs the profile with mock ports whose ids match profile.ports", () => {
    const device = createMockSurfaceDevice();

    expect(device.input.port.id).toBe("main-in");
    expect(device.input.port.type).toBe("input");
    expect(device.output.port.id).toBe("main-out");
    expect(device.output.port.type).toBe("output");
  });

  it("names the ports after the profile's own identity", () => {
    const device = createMockSurfaceDevice();
    expect(device.input.port.name).toBe(device.profile.identity.model);
    expect(device.input.port.manufacturer).toBe(device.profile.identity.manufacturer);
  });

  it("returns a fresh pair of ports on every call", () => {
    const first = createMockSurfaceDevice();
    const second = createMockSurfaceDevice();
    expect(first.input).not.toBe(second.input);
  });
});
