import { describe, expect, it } from "vitest";
import { LAUNCHPAD_MINI_MK3_DAW_SIDE_BUTTONS, LAUNCHPAD_MINI_MK3_FADER_CONTROLS, LAUNCHPAD_MINI_MK3_MODES, LAUNCHPAD_MINI_MK3_PROFILE } from "../devices/launchpad-mini-mk3.js";
import type { DeviceModeProfile } from "../types/mode.js";
import type { DeviceProfile } from "../types/profile.js";
import { validateDeviceProfile } from "./validate-profile.js";

const mixer = LAUNCHPAD_MINI_MK3_MODES[0] as DeviceModeProfile;

/** The Launchpad profile with its modes replaced, so each test changes one thing. */
function withModes(modes: unknown): DeviceProfile {
  return { ...LAUNCHPAD_MINI_MK3_PROFILE, modes } as DeviceProfile;
}

/**
 * The Launchpad as a device without the DAW interface would present itself: no DAW ports, so no fader controls, no
 * DAW side buttons, and no mode that needs them.
 */
function withoutDawPorts(): DeviceProfile {
  const dawIds = new Set([...LAUNCHPAD_MINI_MK3_FADER_CONTROLS, ...LAUNCHPAD_MINI_MK3_DAW_SIDE_BUTTONS].map((control) => control.id));
  return {
    ...LAUNCHPAD_MINI_MK3_PROFILE,
    ports: LAUNCHPAD_MINI_MK3_PROFILE.ports.filter((port) => !port.id.startsWith("daw-")),
    controls: LAUNCHPAD_MINI_MK3_PROFILE.controls.filter((control) => !dawIds.has(control.id)),
    modes: undefined,
  };
}

describe("validateDeviceProfile: modes (ECS-96)", () => {
  it("accepts the Launchpad's mixer-faders mode", () => {
    expect(validateDeviceProfile(LAUNCHPAD_MINI_MK3_PROFILE)).toEqual([]);
  });

  it("accepts a profile with no modes at all", () => {
    expect(validateDeviceProfile(withModes(undefined))).toEqual([]);
  });

  it("accepts a device without the DAW ports, with no DAW-only controls or mode declared", () => {
    expect(validateDeviceProfile(withoutDawPorts())).toEqual([]);
  });

  it("rejects a send port the device doesn't declare, because every mode sends on it", () => {
    const diagnostics = validateDeviceProfile(withModes([{ ...mixer, sendPortId: "nope" }]));
    expect(diagnostics.map((d) => d.code)).toContain("dangling-port-reference");
  });

  it("rejects a send port of the wrong type", () => {
    const diagnostics = validateDeviceProfile(withModes([{ ...mixer, sendPortId: "midi-in" }]));
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "invalid-mode", path: "modes[0].sendPortId" }));
  });

  it("rejects a fader port that isn't listed in requiredPortIds, since the mode could then run without it", () => {
    const diagnostics = validateDeviceProfile(withModes([{ ...mixer, requiredPortIds: [] }]));
    expect(diagnostics.filter((d) => d.code === "invalid-mode").map((d) => d.path)).toEqual([
      "modes[0].faders.inputPortId",
      "modes[0].faders.feedbackPortId",
    ]);
  });

  it("rejects a SysEx message without its closing F7", () => {
    const diagnostics = validateDeviceProfile(withModes([{ ...mixer, showLayout: [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x00, 0x0d] }]));
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "invalid-mode", path: "modes[0].showLayout" }));
  });

  it("rejects a byte out of range in an activate message", () => {
    const diagnostics = validateDeviceProfile(withModes([{ ...mixer, activate: [[0xf0, 0x00, 0x1ff, 0xf7]] }]));
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "invalid-mode", path: "modes[0].activate[0]" }));
  });

  it("rejects a fader bank of more than eight faders", () => {
    const [volume] = mixer.faders.banks;
    const nine = { ...volume!, controllers: [...volume!.controllers, 120] };
    const diagnostics = validateDeviceProfile(withModes([{ ...mixer, faders: { ...mixer.faders, banks: [nine] } }]));
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "invalid-mode", path: "modes[0].faders.banks[0].controllers" }));
  });

  it("rejects a bank whose fader CCs repeat", () => {
    const [volume] = mixer.faders.banks;
    const repeated = { ...volume!, controllers: [80, 80, 82, 83, 84, 85, 86, 87] };
    const diagnostics = validateDeviceProfile(withModes([{ ...mixer, faders: { ...mixer.faders, banks: [repeated] } }]));
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "invalid-mode", path: "modes[0].faders.banks[0].controllers[1]" }));
  });

  it("rejects a bank colour of 0, which would switch its faders off", () => {
    const [volume] = mixer.faders.banks;
    const off = { ...volume!, colour: 0 };
    const diagnostics = validateDeviceProfile(withModes([{ ...mixer, faders: { ...mixer.faders, banks: [off] } }]));
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "invalid-mode", path: "modes[0].faders.banks[0].colour" }));
  });

  it("rejects fader controls whose ports the device lacks, since the controls would dangle", () => {
    const profile = { ...LAUNCHPAD_MINI_MK3_PROFILE, ports: LAUNCHPAD_MINI_MK3_PROFILE.ports.filter((port) => !port.id.startsWith("daw-")) };
    expect(validateDeviceProfile(profile).map((d) => d.code)).toContain("dangling-port-reference");
  });

  it("rejects a fader channel outside 0-15", () => {
    const diagnostics = validateDeviceProfile(withModes([{ ...mixer, faders: { ...mixer.faders, inputChannel: 16 } }]));
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "invalid-mode", path: "modes[0].faders.inputChannel" }));
  });

  it("rejects two modes with the same id", () => {
    const diagnostics = validateDeviceProfile(withModes([mixer, { ...mixer }]));
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "duplicate-mode-id", path: "modes[1].id" }));
  });

  it("rejects a modes section that is not an array", () => {
    const diagnostics = validateDeviceProfile(withModes({ id: "mixer-faders" }));
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "invalid-mode", path: "modes" }));
  });
});
