import { MockMidiInput } from "../adapters/mock/mock-input.js";
import { MockMidiOutput } from "../adapters/mock/mock-output.js";
import { MOCK_SURFACE_DEVICE_PROFILE } from "../profile/generic/mock-surface-profile.js";
import type { DeviceProfile } from "../profile/types/profile.js";

export interface MockSurfaceDevice {
  readonly profile: DeviceProfile;
  readonly input: MockMidiInput;
  readonly output: MockMidiOutput;
}

/**
 * Pairs `MOCK_SURFACE_DEVICE_PROFILE` with a real `MockMidiInput`/
 * `MockMidiOutput` pair whose port ids match the profile's own
 * `"main-in"`/`"main-out"` — the same "profile plus real mock ports"
 * composition `createMockDevice()` (`src/adapters/mock/`) already proves
 * for Core, one layer up. Anything built against this (a
 * `ControlSurface`, or for now, `createMockSurfaceHarness()`) goes
 * through Core's real `MidiInput`/`MidiOutput`-shaped ports; it never
 * needs to know it isn't real hardware.
 */
export function createMockSurfaceDevice(): MockSurfaceDevice {
  const portInfo = { name: MOCK_SURFACE_DEVICE_PROFILE.identity.model, manufacturer: MOCK_SURFACE_DEVICE_PROFILE.identity.manufacturer };
  const input = new MockMidiInput({ id: "main-in", type: "input", ...portInfo });
  const output = new MockMidiOutput({ id: "main-out", type: "output", ...portInfo });

  return { profile: MOCK_SURFACE_DEVICE_PROFILE, input, output };
}
