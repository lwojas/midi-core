import type { MidiPortInfo } from "../core/types/identity.js";
import { EXAMPLE_GRID_8X8_PROFILE } from "../profile/devices/example-grid-8x8.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import { LAUNCHPAD_MINI_MK3_PROFILE } from "../profile/devices/launchpad-mini-mk3.js";
import { PUSH_MK1_PROFILE } from "../profile/devices/push-mk1.js";
import { GENERIC_MIDI_DEVICE_PROFILE } from "../profile/generic/device-profile.js";

/**
 * How a device's DAW ports are named, relative to its MIDI pair (ECS-103). The DAW port's name is the MIDI port's name with
 * `from` replaced by `to`, so the pair is found from the system's port list. Only a device that has DAW ports declares this.
 */
export interface DawPortNames {
  readonly input: { readonly from: string; readonly to: string };
  readonly output: { readonly from: string; readonly to: string };
}

/**
 * A device the sequencer knows how to drive (ECS-90): its profile, which includes its layout, and how to recognise
 * its input port. This is the one place a device's control ids are named for the sequencer.
 */
export interface DeviceEntry {
  /** The profile's identity id, e.g. "novation.launchpad-mini-mk3". */
  readonly id: string;
  /** Human-readable name, e.g. "Novation Launchpad Mini [MK3]". */
  readonly label: string;
  /** What the sequencer's controls do on this device, for the user. */
  readonly help: string;
  /** The device profile, including the layout the sequencer uses (ECS-90). */
  readonly profile: DeviceProfile;
  /**
   * Matches an input port's reported name. Web MIDI often reports no manufacturer, so the name decides. Left out on the
   * generic entry, which is never found by name (see `resolveDevice`).
   */
  readonly portName?: RegExp;
  /** The device's DAW ports, when it has any (ECS-103). A device without them leaves this out. */
  readonly dawPortNames?: DawPortNames;
}

export const DEVICE_REGISTRY: readonly DeviceEntry[] = [
  {
    id: LAUNCHPAD_MINI_MK3_PROFILE.identity.id,
    label: `${LAUNCHPAD_MINI_MK3_PROFILE.identity.manufacturer} ${LAUNCHPAD_MINI_MK3_PROFILE.identity.model}`,
    help:
      "Launchpad Mini MK3: side buttons switch steps / mixer / transport. Steps: the grid is the selected pattern (rows are tracks 1-8, columns are beats); top buttons 95/96 page. Mixer: the top pad row mutes tracks 1-8. Transport: top buttons 91/92 play and stop.",
    portName: /launchpad mini (\[mk3\]|mk3)/i,
    profile: LAUNCHPAD_MINI_MK3_PROFILE,
    dawPortNames: { input: { from: "MIDI Out", to: "DAW Out" }, output: { from: "MIDI In", to: "DAW In" } },
  },
  {
    id: PUSH_MK1_PROFILE.identity.id,
    label: `${PUSH_MK1_PROFILE.identity.manufacturer} ${PUSH_MK1_PROFILE.identity.model}`,
    help:
      "Push 1 (User Mode, User button held): Note/Session switch steps/mixer, Stop switches to transport. " +
      "Steps: the 8x8 grid is the selected pattern (rows are tracks, columns are beats); the Arrow buttons page. " +
      "Mixer: the top pad row mutes tracks. Transport: Play/Record are bound; Stop/Clear have no dedicated button.",
    // Matches only the User Port, not the Live Port: this profile models User Mode's note/CC addressing, which the
    // Live Port doesn't speak (Ableton's own internal Live control-surface protocol, out of scope here).
    portName: /ableton push.*user port/i,
    profile: PUSH_MK1_PROFILE,
  },
  {
    id: EXAMPLE_GRID_8X8_PROFILE.identity.id,
    label: `${EXAMPLE_GRID_8X8_PROFILE.identity.manufacturer} ${EXAMPLE_GRID_8X8_PROFILE.identity.model}`,
    help: "Example 8x8 grid (a test fixture, not verified on hardware): the three left buttons switch steps / mixer / transport; the next two page the grid; the last four are transport.",
    portName: /example 8x8 grid/i,
    profile: EXAMPLE_GRID_8X8_PROFILE,
  },
];

/**
 * The entry for a device no registry entry names. It uses the generic profile: no layout, no setup, no DAW ports, so the
 * device connects and its messages can be seen, but nothing is bound to them. Mapping comes later (a MIDI learn step).
 */
export const GENERIC_DEVICE: DeviceEntry = {
  id: GENERIC_MIDI_DEVICE_PROFILE.identity.id,
  label: `${GENERIC_MIDI_DEVICE_PROFILE.identity.manufacturer} MIDI device`,
  help: "No device profile matches this input, so it connects generically: no controls are bound yet, and the log shows every message it sends.",
  profile: GENERIC_MIDI_DEVICE_PROFILE,
};

/** The registry entry for a connected input port, or `undefined` when no device is known for it. */
export function findDevice(port: Pick<MidiPortInfo, "name">): DeviceEntry | undefined {
  const { name } = port;
  if (!name) return undefined;
  return DEVICE_REGISTRY.find((entry) => entry.portName?.test(name));
}

/** The entry for a connected input port: its registry entry when one names it, otherwise the generic device. */
export function resolveDevice(port: Pick<MidiPortInfo, "name">): DeviceEntry {
  return findDevice(port) ?? GENERIC_DEVICE;
}

/** Whether a device's profile requires an output port. A device that doesn't can connect with its input alone. */
export function requiresOutput(entry: DeviceEntry): boolean {
  return entry.profile.ports.some((port) => port.type === "output" && port.required);
}

/**
 * The DAW ports that pair with a connected MIDI pair, found by name (ECS-103). `midi` holds the names of the MIDI input and
 * output. Each result is `undefined` when the device has no DAW ports, when a name is missing, or when the system doesn't
 * report the port. Such a device still works on its MIDI pair alone.
 */
export function findDawPorts(
  entry: DeviceEntry,
  ports: readonly MidiPortInfo[],
  midi: { readonly input?: string | null; readonly output?: string | null },
): { readonly input?: MidiPortInfo; readonly output?: MidiPortInfo } {
  const names = entry.dawPortNames;
  if (!names) return {};
  const find = (type: MidiPortInfo["type"], midiName: string | null | undefined, rule: { readonly from: string; readonly to: string }) =>
    midiName ? ports.find((port) => port.type === type && port.name === midiName.replace(rule.from, rule.to)) : undefined;
  return { input: find("input", midi.input, names.input), output: find("output", midi.output, names.output) };
}
