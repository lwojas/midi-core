import { composeDeviceProfile } from "../composition/compose.js";
import type { ProtocolBinding } from "../composition/types/binding.js";
import type { ProtocolFamily } from "../composition/types/protocol.js";
import type { DeviceIdentity } from "../types/identity.js";
import type { DevicePortProfile } from "../types/port.js";
import type { DeviceProfile } from "../types/profile.js";
import { GENERIC_MIDI_PROTOCOL } from "./protocol.js";

/**
 * The baseline device profile: a device assumed to be nothing more than a
 * compliant MIDI device (`GENERIC_MIDI_PROTOCOL`, bound on an assumed
 * input+output pair) — no manufacturer, no fixed physical controls, no
 * SysEx, no setup, and no `ControlMapping`s (those belong to the
 * mapping layer, not a profile). `identity.manufacturer`/`model` name
 * what this is ("Generic", "Generic MIDI Device"), not a real vendor.
 *
 * Meant as a starting point, per the ticket, "before real device
 * profiles": a profile for a controller that isn't fully characterized
 * yet (or never will be) can compose `GENERIC_MIDI_PROTOCOL` the same way
 * this one does, adding its own `extensions` for whatever's actually
 * documented, instead of redeclaring the full channel-voice message set
 * from scratch.
 */

export const GENERIC_MIDI_DEVICE_IDENTITY: DeviceIdentity = {
  id: "generic.midi-device",
  manufacturer: "Generic",
  model: "Generic MIDI Device",
};

/**
 * Assumes one port pair, not any vendor-specific port layout. The input is required: it is how the device's messages
 * reach the app. The output is optional, because many devices only send (a pad controller whose lights are driven by its
 * own hardware), and nothing in the generic profile needs to send to them.
 */
export const GENERIC_MIDI_DEVICE_PORTS: readonly DevicePortProfile[] = [
  { id: "main-in", type: "input", role: "main", required: true, messageTypes: [] },
  { id: "main-out", type: "output", role: "main", required: false, messageTypes: [] },
];

const GENERIC_MIDI_PROTOCOL_REGISTRY: ReadonlyMap<string, ProtocolFamily> = new Map([
  [GENERIC_MIDI_PROTOCOL.id, GENERIC_MIDI_PROTOCOL],
]);

export const GENERIC_MIDI_DEVICE_PROTOCOL_BINDINGS: readonly ProtocolBinding[] = [
  { id: "generic-in", protocolId: GENERIC_MIDI_PROTOCOL.id, portId: "main-in" },
  { id: "generic-out", protocolId: GENERIC_MIDI_PROTOCOL.id, portId: "main-out" },
];

export const GENERIC_MIDI_DEVICE_PROFILE: DeviceProfile = composeDeviceProfile({
  identity: GENERIC_MIDI_DEVICE_IDENTITY,
  ports: GENERIC_MIDI_DEVICE_PORTS,
  protocols: GENERIC_MIDI_PROTOCOL_REGISTRY,
  protocolBindings: GENERIC_MIDI_DEVICE_PROTOCOL_BINDINGS,
});
