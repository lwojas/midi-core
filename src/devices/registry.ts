import type { MidiPortInfo } from "../core/types/identity.js";
import type { SequencerDevice, SequencerLayout } from "../configurations/sequencer.js";
import { EXAMPLE_GRID_8X8_PROFILE } from "../profile/devices/example-grid-8x8.js";
import { LAUNCHPAD_MINI_MK3_PROFILE } from "../profile/devices/launchpad-mini-mk3.js";

/**
 * A device the sequencer knows how to drive (ECS-90): its profile, its sequencer layout, and how to recognise its
 * input port. This is the one place a device's control ids are named for the sequencer.
 */
export interface DeviceEntry extends SequencerDevice {
  /** The profile's identity id, e.g. "novation.launchpad-mini-mk3". */
  readonly id: string;
  /** Human-readable name, e.g. "Novation Launchpad Mini [MK3]". */
  readonly label: string;
  /** What the sequencer's controls do on this device, for the user. */
  readonly help: string;
  /** Matches an input port's reported name. Web MIDI often reports no manufacturer, so the name decides. */
  readonly portName: RegExp;
}

const LAUNCHPAD_MINI_MK3_LAYOUT: SequencerLayout = {
  modeButtons: [
    { controlId: "side-89", mode: "steps" },
    { controlId: "side-79", mode: "mixer" },
    { controlId: "side-69", mode: "transport" },
  ],
  pageLeft: "top-95",
  pageRight: "top-96",
  transport: { play: "top-91", stop: "top-92", record: "top-93", clear: "top-94" },
};

const EXAMPLE_GRID_8X8_LAYOUT: SequencerLayout = {
  modeButtons: [
    { controlId: "button-mode-a", mode: "steps" },
    { controlId: "button-mode-b", mode: "mixer" },
    { controlId: "button-mode-c", mode: "transport" },
  ],
  pageLeft: "button-page-left",
  pageRight: "button-page-right",
  transport: { play: "button-play", stop: "button-stop", record: "button-record", clear: "button-clear" },
};

export const DEVICE_REGISTRY: readonly DeviceEntry[] = [
  {
    id: LAUNCHPAD_MINI_MK3_PROFILE.identity.id,
    label: `${LAUNCHPAD_MINI_MK3_PROFILE.identity.manufacturer} ${LAUNCHPAD_MINI_MK3_PROFILE.identity.model}`,
    help:
      "Launchpad Mini MK3: side buttons switch steps / mixer / transport. Steps: the grid is the selected pattern (rows are tracks 1-8, columns are beats); top buttons 95/96 page. Mixer: the top pad row mutes tracks 1-8. Transport: top buttons 91/92 play and stop.",
    portName: /launchpad mini (\[mk3\]|mk3)/i,
    profile: LAUNCHPAD_MINI_MK3_PROFILE,
    layout: LAUNCHPAD_MINI_MK3_LAYOUT,
  },
  {
    id: EXAMPLE_GRID_8X8_PROFILE.identity.id,
    label: `${EXAMPLE_GRID_8X8_PROFILE.identity.manufacturer} ${EXAMPLE_GRID_8X8_PROFILE.identity.model}`,
    help: "Example 8x8 grid (a test fixture, not verified on hardware): the three left buttons switch steps / mixer / transport; the next two page the grid; the last four are transport.",
    portName: /example 8x8 grid/i,
    profile: EXAMPLE_GRID_8X8_PROFILE,
    layout: EXAMPLE_GRID_8X8_LAYOUT,
  },
];

/** The registry entry for a connected input port, or `undefined` when no device is known for it. */
export function findDevice(port: Pick<MidiPortInfo, "name">): DeviceEntry | undefined {
  const { name } = port;
  if (!name) return undefined;
  return DEVICE_REGISTRY.find((entry) => entry.portName.test(name));
}
