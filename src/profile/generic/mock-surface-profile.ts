import type { PhysicalControl } from "../types/control.js";
import type { ControlGrid } from "../types/grid.js";
import type { DeviceIdentity } from "../types/identity.js";
import type { DevicePortProfile } from "../types/port.js";
import { DEVICE_PROFILE_SCHEMA_VERSION, type DeviceProfile } from "../types/profile.js";

/**
 * A fictional, non-vendor-specific device profile built the same way a
 * real one would be (`PhysicalControl`/`ControlGrid`, nothing invented
 * beyond this schema) — unlike `GENERIC_MIDI_DEVICE_PROFILE` (ECS-41),
 * which deliberately has *no* physical controls, this one exists
 * specifically to exercise the Control Surface layer end to end (ECS-77)
 * without needing a real controller or Launchpad-specific knowledge.
 *
 * Shape, per the ticket: eight continuous controls (`knob-1`..`knob-8`,
 * CC input only — the "eight controls -> eight track volumes" Mixer
 * proof needs), four buttons (`button-1`..`button-4`, note input only —
 * Transport), and an eight-pad row (`pad-1`..`pad-8`, note input *and*
 * note feedback — the "eight feedback outputs" the ticket names, and the
 * Step Grid's cells). No `sysex`/`handshake`: nothing about this device
 * needs either, and inventing one here would be exactly the kind of
 * profile this ticket's "do not expand into general device profiling"
 * warns against.
 *
 * Every control resolves a concrete `channel` (`0`) — unlike a profile
 * assembled from partial real-world evidence (ECS-62's `unresolved`
 * case), nothing here is partially known, so there's no reason to leave
 * it unresolved.
 */

export const MOCK_SURFACE_DEVICE_IDENTITY: DeviceIdentity = {
  id: "generic.mock-surface-device",
  manufacturer: "Generic",
  model: "Generic Mock Surface Device",
};

/** One full-duplex port pair, matching `createMockSurfaceDevice()`'s real mock ports by id. Feedback is a nice-to-have, not required to operate the device, so only the input port is `required`. */
export const MOCK_SURFACE_DEVICE_PORTS: readonly DevicePortProfile[] = [
  { id: "main-in", type: "input", role: "main", required: true, messageTypes: ["note-on", "note-off", "control-change"] },
  { id: "main-out", type: "output", role: "main", required: false, messageTypes: ["note-on", "note-off"] },
];

function knobControl(index: number): PhysicalControl {
  return {
    id: `knob-${index}`,
    label: `Knob ${index}`,
    kind: "knob",
    portId: "main-in",
    input: { address: { type: "control-change", controller: 10 + index }, channel: 0 },
  };
}

function buttonControl(index: number): PhysicalControl {
  return {
    id: `button-${index}`,
    label: `Button ${index}`,
    kind: "button",
    portId: "main-in",
    input: { address: { type: "note", note: 100 + index }, channel: 0 },
  };
}

function padControl(index: number): PhysicalControl {
  const note = 36 + index;
  return {
    id: `pad-${index}`,
    label: `Pad ${index}`,
    kind: "pad",
    portId: "main-in",
    input: { address: { type: "note", note }, channel: 0 },
    feedback: { kind: "velocity-color-led", address: { address: { type: "note", note }, channel: 0 }, paletteSize: 128 },
    feedbackPortId: "main-out",
  };
}

/** `knob-1`..`knob-8` — CC 11-18, channel 0. Input only. */
export const MOCK_SURFACE_KNOBS: readonly PhysicalControl[] = Array.from({ length: 8 }, (_, i) => knobControl(i + 1));

/** `button-1`..`button-4` — note 101-104, channel 0. Input only. */
export const MOCK_SURFACE_BUTTONS: readonly PhysicalControl[] = Array.from({ length: 4 }, (_, i) => buttonControl(i + 1));

/** `pad-1`..`pad-8` — note 37-44, channel 0. Input and feedback share the same note/channel (the same address reports a press and accepts an LED-color write, a real and common drum-pad convention), feedback going out on `main-out` instead of `main-in`. */
export const MOCK_SURFACE_PADS: readonly PhysicalControl[] = Array.from({ length: 8 }, (_, i) => padControl(i + 1));

export const MOCK_SURFACE_CONTROLS: readonly PhysicalControl[] = [
  ...MOCK_SURFACE_KNOBS,
  ...MOCK_SURFACE_BUTTONS,
  ...MOCK_SURFACE_PADS,
];

/** A single row of the eight pads — "a minimal profile-defined grid sufficient to demonstrate step input/playhead feedback," per the ticket; nothing here needs more than one dimension of paging to prove that. */
export const MOCK_SURFACE_STEP_GRID: ControlGrid = {
  id: "step-grid",
  label: "Step Grid",
  rows: 1,
  columns: MOCK_SURFACE_PADS.length,
  cells: MOCK_SURFACE_PADS.map((pad, column) => ({ row: 0, column, controlId: pad.id })),
};

export const MOCK_SURFACE_DEVICE_PROFILE: DeviceProfile = {
  schemaVersion: DEVICE_PROFILE_SCHEMA_VERSION,
  identity: MOCK_SURFACE_DEVICE_IDENTITY,
  ports: MOCK_SURFACE_DEVICE_PORTS,
  controls: MOCK_SURFACE_CONTROLS,
  grids: [MOCK_SURFACE_STEP_GRID],
};
