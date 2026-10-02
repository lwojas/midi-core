import { describe, expect, it } from "vitest";
import type { PhysicalControl } from "../types/control.js";
import type { DevicePortProfile } from "../types/port.js";
import type { ProtocolBinding } from "./types/binding.js";
import type { ProtocolFamily } from "./types/protocol.js";
import {
  composeDeviceControls,
  composeDeviceProfile,
  composePortMessageTypes,
  composeProtocolControls,
} from "./compose.js";

/** Fictional protocol families for the test — ECS-40 ships no concrete ones (see ECS-41). */
const faderProtocol: ProtocolFamily = {
  id: "fictional-fader-bank",
  name: "Fictional Fader Bank",
  controls: [
    {
      id: "fader-1",
      label: "Fader 1",
      kind: "fader",
      input: { address: { type: "control-change", controller: 7 }, channel: 0 },
    },
  ],
};

const clockProtocol: ProtocolFamily = {
  id: "midi-clock-transport",
  name: "MIDI Clock/Transport",
  messageTypes: ["clock", "start", "continue", "stop"],
};

const protocols = new Map<string, ProtocolFamily>([
  [faderProtocol.id, faderProtocol],
  [clockProtocol.id, clockProtocol],
]);

const faderBinding: ProtocolBinding = { id: "strip", protocolId: faderProtocol.id, portId: "main-in" };
const clockBinding: ProtocolBinding = { id: "clock", protocolId: clockProtocol.id, portId: "main-in" };
const unresolvedBinding: ProtocolBinding = { id: "ghost", protocolId: "does-not-exist", portId: "main-in" };

describe("composeProtocolControls", () => {
  it("prefixes template ids with the binding id and sets portId from the binding", () => {
    const controls = composeProtocolControls(faderBinding, faderProtocol);
    expect(controls).toEqual([
      {
        id: "strip.fader-1",
        label: "Fader 1",
        kind: "fader",
        portId: "main-in",
        input: { address: { type: "control-change", controller: 7 }, channel: 0 },
      },
    ]);
  });

  it("returns an empty list for a protocol with no controls", () => {
    expect(composeProtocolControls(clockBinding, clockProtocol)).toEqual([]);
  });
});

describe("composeDeviceControls", () => {
  it("concatenates every bound protocol's controls with the device's own extensions", () => {
    const extension: PhysicalControl = {
      id: "vendor-pad-1",
      label: "Vendor Pad 1",
      kind: "pad",
      portId: "main-in",
      input: { address: { type: "note", note: 36 }, channel: 0 },
    };

    const controls = composeDeviceControls([faderBinding, clockBinding], protocols, [extension]);
    expect(controls.map((control) => control.id)).toEqual(["strip.fader-1", "vendor-pad-1"]);
  });

  it("silently skips a binding whose protocolId isn't in the registry", () => {
    const controls = composeDeviceControls([unresolvedBinding], protocols, []);
    expect(controls).toEqual([]);
  });
});

describe("composePortMessageTypes", () => {
  const port: DevicePortProfile = {
    id: "main-in",
    type: "input",
    role: "main",
    required: true,
    messageTypes: ["note-on", "note-off"],
  };

  it("unions the port's own message types with every protocol bound to it, deduplicated", () => {
    const types = composePortMessageTypes(port, [faderBinding, clockBinding], protocols);
    expect(new Set(types)).toEqual(new Set(["note-on", "note-off", "clock", "start", "continue", "stop"]));
  });

  it("ignores protocols bound to a different port", () => {
    const otherPortBinding: ProtocolBinding = { id: "clock-2", protocolId: clockProtocol.id, portId: "main-out" };
    const types = composePortMessageTypes(port, [otherPortBinding], protocols);
    expect(types).toEqual(["note-on", "note-off"]);
  });
});

describe("composeDeviceProfile", () => {
  it("assembles a full DeviceProfile from identity, ports, bindings and extensions", () => {
    const ports: DevicePortProfile[] = [
      { id: "main-in", type: "input", role: "main", required: true, messageTypes: ["note-on", "note-off"] },
    ];

    const profile = composeDeviceProfile({
      identity: { id: "test.fictional-device", manufacturer: "Test Fixture Co.", model: "Fictional Device" },
      ports,
      protocols,
      protocolBindings: [faderBinding, clockBinding],
    });

    expect(profile.schemaVersion).toBe("1.0");
    expect(profile.controls.map((control) => control.id)).toEqual(["strip.fader-1"]);
    expect(new Set(profile.ports[0]?.messageTypes)).toEqual(
      new Set(["note-on", "note-off", "clock", "start", "continue", "stop"]),
    );
  });
});
