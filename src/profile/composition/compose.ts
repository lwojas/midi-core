import type { MidiMessageType } from "../../core/types/message.js";
import type { DeviceIdentity } from "../types/identity.js";
import type { DevicePortProfile } from "../types/port.js";
import type { PhysicalControl } from "../types/control.js";
import type { ControlGrid } from "../types/grid.js";
import type { DeviceSysExProfile } from "../types/sysex.js";
import type { DeviceHandshake } from "../types/handshake.js";
import { DEVICE_PROFILE_SCHEMA_VERSION, type DeviceProfile } from "../types/profile.js";
import type { ProtocolBinding } from "./types/binding.js";
import type { ProtocolFamily } from "./types/protocol.js";

/**
 * Pure composition: turning reusable `ProtocolFamily`s plus device-specific
 * extensions into the flat `controls`/`messageTypes` shape
 * `docs/contracts/device-profile.md` already defines. Nothing here owns a
 * protocol registry — every function takes one as a `ReadonlyMap`, the same
 * "no single global registry assumed" stance `ControlRegistry` and
 * `MidiDiscovery` already take for their own lookups. A `ProtocolBinding`
 * whose `protocolId` isn't in the map contributes nothing rather than
 * throwing — the same "not this function's concern" choice
 * `resolveIncomingValue`/`buildFeedbackMessage` make for input they can't
 * resolve; catching a profile that references a nonexistent protocol is
 * ECS-42's job (profile validation and diagnostics), not this one's.
 */

/** The concrete `PhysicalControl`s one binding contributes, with ids prefixed by `binding.id` and `portId` set from `binding.portId`. */
export function composeProtocolControls(
  binding: ProtocolBinding,
  protocol: ProtocolFamily,
): readonly PhysicalControl[] {
  if (!protocol.controls) return [];
  return protocol.controls.map((template) => ({
    ...template,
    id: `${binding.id}.${template.id}`,
    portId: binding.portId,
  }));
}

/** Every protocol-contributed control across `bindings`, followed by `extensions` — the device's own controls, not covered by any protocol. */
export function composeDeviceControls(
  bindings: readonly ProtocolBinding[],
  protocols: ReadonlyMap<string, ProtocolFamily>,
  extensions: readonly PhysicalControl[],
): readonly PhysicalControl[] {
  const composed = bindings.flatMap((binding) => {
    const protocol = protocols.get(binding.protocolId);
    return protocol ? composeProtocolControls(binding, protocol) : [];
  });
  return [...composed, ...extensions];
}

/** `port`'s own declared `messageTypes`, unioned with every message type contributed by a protocol bound to it. */
export function composePortMessageTypes(
  port: DevicePortProfile,
  bindings: readonly ProtocolBinding[],
  protocols: ReadonlyMap<string, ProtocolFamily>,
): readonly MidiMessageType[] {
  const fromProtocols = bindings
    .filter((binding) => binding.portId === port.id)
    .flatMap((binding) => protocols.get(binding.protocolId)?.messageTypes ?? []);
  return Array.from(new Set([...port.messageTypes, ...fromProtocols]));
}

/**
 * Assembles a complete `DeviceProfile` from a device's own identity/ports/
 * grids/sysex/handshake plus `protocolBindings` (resolved against
 * `protocols`) and `extensions` — the composition this ticket exists to
 * define, built entirely from the smaller pieces above. Still produces
 * only a `DeviceProfile`; it doesn't validate one (ECS-42) or ship any
 * concrete `ProtocolFamily` (ECS-41, for the first one: a generic MIDI
 * baseline).
 */
export function composeDeviceProfile(args: {
  readonly identity: DeviceIdentity;
  readonly ports: readonly DevicePortProfile[];
  readonly protocols: ReadonlyMap<string, ProtocolFamily>;
  readonly protocolBindings: readonly ProtocolBinding[];
  readonly extensions?: readonly PhysicalControl[];
  readonly grids?: readonly ControlGrid[];
  readonly sysex?: DeviceSysExProfile;
  readonly handshake?: DeviceHandshake;
}): DeviceProfile {
  const { identity, ports, protocols, protocolBindings, extensions = [], grids, sysex, handshake } = args;

  return {
    schemaVersion: DEVICE_PROFILE_SCHEMA_VERSION,
    identity,
    ports: ports.map((port) => ({
      ...port,
      messageTypes: composePortMessageTypes(port, protocolBindings, protocols),
    })),
    controls: composeDeviceControls(protocolBindings, protocols, extensions),
    grids,
    sysex,
    handshake,
  };
}
