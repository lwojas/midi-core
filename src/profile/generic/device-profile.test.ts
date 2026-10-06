import { describe, expect, it } from "vitest";
import { GENERIC_MIDI_CHANNEL_VOICE_MESSAGE_TYPES } from "./protocol.js";
import { GENERIC_MIDI_DEVICE_PROFILE } from "./device-profile.js";

describe("GENERIC_MIDI_DEVICE_PROFILE", () => {
  it("names no real manufacturer", () => {
    expect(GENERIC_MIDI_DEVICE_PROFILE.identity.manufacturer).toBe("Generic");
  });

  it("has no physical controls, grids, sysex or setup", () => {
    expect(GENERIC_MIDI_DEVICE_PROFILE.controls).toEqual([]);
    expect(GENERIC_MIDI_DEVICE_PROFILE.grids).toBeUndefined();
    expect(GENERIC_MIDI_DEVICE_PROFILE.sysex).toBeUndefined();
    expect(GENERIC_MIDI_DEVICE_PROFILE.setup).toBeUndefined();
  });

  it("composes the full generic channel-voice message set onto both ports", () => {
    for (const port of GENERIC_MIDI_DEVICE_PROFILE.ports) {
      expect(new Set(port.messageTypes)).toEqual(new Set(GENERIC_MIDI_CHANNEL_VOICE_MESSAGE_TYPES));
    }
  });

  it("assumes one port pair, with only the input required", () => {
    expect(GENERIC_MIDI_DEVICE_PROFILE.ports.map((port) => port.type)).toEqual(["input", "output"]);
    expect(GENERIC_MIDI_DEVICE_PROFILE.ports.map((port) => port.required)).toEqual([true, false]);
  });
});
