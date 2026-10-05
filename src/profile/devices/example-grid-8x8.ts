import type { PhysicalControl } from "../types/control.js";
import type { ControlGrid } from "../types/grid.js";
import type { DeviceIdentity } from "../types/identity.js";
import type { DeviceLayout } from "../types/layout.js";
import type { DevicePortProfile } from "../types/port.js";
import { DEVICE_PROFILE_SCHEMA_VERSION, type DeviceProfile } from "../types/profile.js";

/**
 * ECS-90: a second device profile, so the sequencer configuration can be shown to be device-independent. It is a
 * realistic 8x8 pad controller with three mode buttons, two page buttons and four transport buttons, all on one
 * row, and it is NOT transcribed from a real device. Its addresses are chosen to differ from the Launchpad's
 * (notes instead of control changes for the buttons, channel 2 instead of channel 1, a different note range for
 * the pads), so a configuration that quietly assumed the Launchpad's layout would fail here.
 *
 * Nothing about this device has been verified against hardware. Treat it as a test fixture with a device's shape.
 */

export const EXAMPLE_GRID_8X8_IDENTITY: DeviceIdentity = {
  id: "example.grid-8x8",
  manufacturer: "Example",
  model: "8x8 Grid Controller",
};

export const EXAMPLE_GRID_8X8_PORTS: readonly DevicePortProfile[] = [
  { id: "midi-in", type: "input", role: "main", required: true, messageTypes: ["note-on", "note-off"] },
  { id: "midi-out", type: "output", role: "main", required: false, messageTypes: ["note-on", "note-off"] },
];

const CHANNEL = 2;

/** Pad (row, column), both 0-based from the top left, is note 36 + row * 8 + column. */
function padControl(row: number, column: number): PhysicalControl {
  const note = 36 + row * 8 + column;
  return {
    id: `pad-${row}-${column}`,
    label: `Pad ${row},${column}`,
    kind: "pad",
    portId: "midi-in",
    input: { address: { type: "note", note }, channel: CHANNEL },
    feedback: { kind: "velocity-color-led", address: { address: { type: "note", note }, channel: CHANNEL }, paletteSize: 128 },
    feedbackPortId: "midi-out",
  };
}

export const EXAMPLE_GRID_8X8_PADS: readonly PhysicalControl[] = Array.from({ length: 8 }, (_, row) => row).flatMap((row) =>
  Array.from({ length: 8 }, (_, column) => padControl(row, column)),
);

/** Notes 104-111, left to right: three mode buttons, two page buttons, then the four transport buttons. */
const BUTTON_NAMES = ["mode-a", "mode-b", "mode-c", "page-left", "page-right", "play", "stop", "record", "clear"] as const;

function buttonControl(index: number): PhysicalControl {
  const note = 104 + index;
  return {
    id: `button-${BUTTON_NAMES[index]}`,
    label: `Button ${BUTTON_NAMES[index]} (note ${note})`,
    kind: "button",
    portId: "midi-in",
    input: { address: { type: "note", note }, channel: CHANNEL },
  };
}

export const EXAMPLE_GRID_8X8_BUTTONS: readonly PhysicalControl[] = BUTTON_NAMES.map((_, index) => buttonControl(index));

export const EXAMPLE_GRID_8X8_CONTROLS: readonly PhysicalControl[] = [...EXAMPLE_GRID_8X8_PADS, ...EXAMPLE_GRID_8X8_BUTTONS];

export const EXAMPLE_GRID_8X8_PAD_GRID: ControlGrid = {
  id: "grid",
  label: "8x8 pad grid",
  rows: 8,
  columns: 8,
  cells: EXAMPLE_GRID_8X8_PADS.map((pad, index) => ({ row: Math.floor(index / 8), column: index % 8, controlId: pad.id })),
  paging: { rows: 8, columns: 8 },
};

/** ECS-90: the sequencer's roles on this device, as its own usage defines them. */
export const EXAMPLE_GRID_8X8_LAYOUT: DeviceLayout = {
  modeButtons: [
    { controlId: "button-mode-a", mode: "steps" },
    { controlId: "button-mode-b", mode: "mixer" },
    { controlId: "button-mode-c", mode: "transport" },
  ],
  pageLeft: "button-page-left",
  pageRight: "button-page-right",
  transport: { play: "button-play", stop: "button-stop", record: "button-record", clear: "button-clear" },
};

export const EXAMPLE_GRID_8X8_PROFILE: DeviceProfile = {
  schemaVersion: DEVICE_PROFILE_SCHEMA_VERSION,
  identity: EXAMPLE_GRID_8X8_IDENTITY,
  ports: EXAMPLE_GRID_8X8_PORTS,
  controls: EXAMPLE_GRID_8X8_CONTROLS,
  grids: [EXAMPLE_GRID_8X8_PAD_GRID],
  layout: EXAMPLE_GRID_8X8_LAYOUT,
};
