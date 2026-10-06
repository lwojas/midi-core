import type { PhysicalControl } from "../types/control.js";
import type { ControlGrid } from "../types/grid.js";
import type { DeviceIdentity } from "../types/identity.js";
import type { DeviceLayout } from "../types/layout.js";
import type { DeviceModeProfile } from "../types/mode.js";
import type { DevicePortProfile } from "../types/port.js";
import { DEVICE_PROFILE_SCHEMA_VERSION, type DeviceProfile } from "../types/profile.js";
import type { DeviceSetup } from "../types/setup.js";
import type { DeviceSysExProfile } from "../types/sysex.js";

/**
 * ECS-79: this project's first real-device `DeviceProfile` — the Novation
 * Launchpad Mini [MK3], selected per the ticket's own criteria (documented
 * MIDI implementation, an inspectable third-party Ableton script, and
 * physical hardware on hand) and already evidenced as feasible by the
 * profiler exercise this transcribes (midi-profiler's ECS-47/ECS-62,
 * `profiles/novation-launchpad-mini-mk3/report.json` — ECS-47's own commit
 * message calls it "the first real device profile," and the profiler
 * repo's generation pipeline reported zero validation diagnostics against
 * it).
 *
 * Transcribed, not hand-authored: every id/address/label below reproduces
 * that generated document's `profile` field exactly, re-expressed as the
 * same kind of generator functions `mock-surface-profile.ts` already uses
 * (the pad grid and three button groups are each a fixed arithmetic
 * sequence of note/CC numbers, not independently-researched one-offs) —
 * written this way for readability, not because midi-core re-derives
 * anything the profiler didn't already determine.
 *
 * **One correction applied here, not present in the generated document**:
 * every control with `feedback` is missing `feedbackPortId`. This device's
 * feedback (lighting an LED) and input (reporting a press) share the same
 * note/CC address but travel on two different physical ports (`midi-in`
 * for input, `midi-out` for feedback) — exactly the case
 * `docs/contracts/device-profile.md`'s `feedbackPortId` field exists for
 * ("named explicitly... different from portId"). The profiler's generation
 * pipeline (ECS-44/ECS-62, midi-profiler repo) never populates it, even
 * when input and output are genuinely different ports — `validateDeviceProfile()`
 * doesn't catch this (it only checks a *present* `feedbackPortId` resolves
 * to a real port, not that one is present when needed), so every
 * feedback-bearing mapping this profile could generate would silently fail
 * to bind at all (`generateControlMappings()` defaults a missing
 * `feedbackPortId` to `portId`, i.e. `midi-in` — not an output port —
 * so `bindSurfaceMode()`'s "no MidiOutput resolves" case drops the whole
 * mapping, input included). See docs/hardware-validation.md's "Findings"
 * section — recorded there as a midi-profiler generation-pipeline gap, not
 * fixed there, since that repo is out of this ticket's scope.
 *
 * **Deliberately not modeled, same as the generated document**: the
 * Session/DAW-Fader address scheme on the `daw-in`/`daw-out` ports, the
 * bootloader-mode pad layout, and global brightness/LED-feedback
 * configuration SysEx — all five of the generated document's own
 * `unresolved` entries, none of which this device's Programmer-mode
 * control surface (the only mode this profile addresses) needs.
 */

export const LAUNCHPAD_MINI_MK3_IDENTITY: DeviceIdentity = {
  id: "novation.launchpad-mini-mk3",
  manufacturer: "Novation",
  model: "Launchpad Mini [MK3]",
};

/** `daw-in`/`daw-out` are real ports this device exposes but this profile doesn't address any control over (see the doc comment above) — declared, not required, so a caller matching `profile.ports` against discovery isn't surprised by a port with nothing using it. */
export const LAUNCHPAD_MINI_MK3_PORTS: readonly DevicePortProfile[] = [
  { id: "midi-in", type: "input", role: "main", required: true, messageTypes: ["note-on", "note-off", "control-change", "sysex"] },
  { id: "midi-out", type: "output", role: "main", required: true, messageTypes: ["note-on", "note-off", "control-change", "sysex"] },
  { id: "daw-in", type: "input", role: "daw-control", required: false, messageTypes: ["note-on", "note-off", "control-change", "channel-pressure", "poly-pressure"] },
  { id: "daw-out", type: "output", role: "daw-control", required: false, messageTypes: ["note-on", "note-off", "control-change"] },
];

/**
 * ECS-95: the device's RGB LED message, without its leading F0 (manufacturer 00 20 29, device 02, LED lighting 0D 03,
 * RGB colourspec 03). A feedback is F0, this prefix, the LED index (the note or controller), red, green, blue, F7, with
 * each colour 0-127 (manual, LED lighting SysEx). Used on every lit control so a mode can show its own colour.
 */
export const LAUNCHPAD_RGB_SYSEX_PREFIX: readonly number[] = [0x00, 0x20, 0x29, 0x02, 0x0d, 0x03, 0x03];

/** Programmer-mode pad addressing: note = (8 - row) * 10 + (column + 1), row/column both 0-based top-left-origin — row 0 is notes 81-88, row 7 is notes 11-18, matching the device's own row-major note numbering (manual p.10). */
function padControl(row: number, column: number): PhysicalControl {
  const note = (8 - row) * 10 + (column + 1);
  return {
    id: `pad-${note}`,
    label: `Pad (note ${note})`,
    kind: "pad",
    portId: "midi-in",
    input: { address: { type: "note", note }, channel: 0 },
    feedback: { kind: "rgb-led", address: { address: { type: "note", note }, channel: 0 }, rgbSysExPrefix: LAUNCHPAD_RGB_SYSEX_PREFIX },
    feedbackPortId: "midi-out",
  };
}

export const LAUNCHPAD_MINI_MK3_PADS: readonly PhysicalControl[] = Array.from({ length: 8 }, (_, row) => row).flatMap((row) =>
  Array.from({ length: 8 }, (_, column) => padControl(row, column)),
);

/** CC 91-98, left to right — Programmer-mode's generic top-row buttons. No verified silkscreen label exists (see the doc comment above), so labels stay positional. */
function topRowButton(index: number): PhysicalControl {
  const controller = 91 + index;
  return {
    id: `top-${controller}`,
    label: `Top row button (CC ${controller})`,
    kind: "button",
    portId: "midi-in",
    input: { address: { type: "control-change", controller }, channel: 0 },
    feedback: { kind: "rgb-led", address: { address: { type: "control-change", controller }, channel: 0 }, rgbSysExPrefix: LAUNCHPAD_RGB_SYSEX_PREFIX },
    feedbackPortId: "midi-out",
  };
}

export const LAUNCHPAD_MINI_MK3_TOP_ROW: readonly PhysicalControl[] = Array.from({ length: 8 }, (_, i) => topRowButton(i));

/** CC 89, 79, ..., 19 top to bottom — Programmer-mode's generic side-column buttons (scene launch, stock firmware). */
function sideColumnButton(index: number): PhysicalControl {
  const controller = 89 - index * 10;
  return {
    id: `side-${controller}`,
    label: `Side column button (CC ${controller})`,
    kind: "button",
    portId: "midi-in",
    input: { address: { type: "control-change", controller }, channel: 0 },
    feedback: { kind: "rgb-led", address: { address: { type: "control-change", controller }, channel: 0 }, rgbSysExPrefix: LAUNCHPAD_RGB_SYSEX_PREFIX },
    feedbackPortId: "midi-out",
  };
}

export const LAUNCHPAD_MINI_MK3_SIDE_COLUMN: readonly PhysicalControl[] = Array.from({ length: 8 }, (_, i) => sideColumnButton(i));

/** CC 99 — the single Logo button, its own control (not part of either row/column sequence). */
export const LAUNCHPAD_MINI_MK3_LOGO: PhysicalControl = {
  id: "logo",
  label: "Logo button (CC 99)",
  kind: "button",
  portId: "midi-in",
  input: { address: { type: "control-change", controller: 99 }, channel: 0 },
  feedback: { kind: "rgb-led", address: { address: { type: "control-change", controller: 99 }, channel: 0 }, rgbSysExPrefix: LAUNCHPAD_RGB_SYSEX_PREFIX },
  feedbackPortId: "midi-out",
};

/**
 * ECS-96: the DAW Fader layout, as a mode of this device. It needs the DAW ports, which some Launchpads don't have, so
 * the mode is unavailable on a device without them. Each fader sends its own CC on `daw-in` (channel 5) and shows its
 * colour from `daw-out` (channel 6, controller = fader index, value = palette entry 1-127). The banks' CCs are fixed
 * here so the profile can name the fader controls; the sequencer sends a bank to make its CCs live.
 */
export const LAUNCHPAD_MINI_MK3_MODES: readonly DeviceModeProfile[] = [
  {
    id: "mixer-faders",
    description: "DAW Fader layout: fader banks on the DAW ports, with colour as their level feedback.",
    sendPortId: "midi-out",
    requiredPortIds: ["daw-in", "daw-out"],
    activate: [[0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x10, 0x01, 0xf7]],
    showLayout: [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x00, 0x0d, 0xf7],
    deactivate: [
      [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x00, 0x7f, 0xf7],
      [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x10, 0x00, 0xf7],
    ],
    bankPrefix: [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x01, 0x00, 0x00],
    // Each fader's entry is its index, type (0 unipolar, 1 bipolar), CC and colour, in that order.
    bankEntry: ["index", "type", "controller", "colour"],
    bankTypes: { unipolar: 0, bipolar: 1 },
    // In this layout the side buttons send on the DAW port, so these are the DAW-port versions of the side column.
    modeButtons: [
      { controlId: "daw-side-89", mode: "steps" },
      { controlId: "daw-side-79", mode: "mixer" },
      { controlId: "daw-side-69", mode: "faders-volume" },
      { controlId: "daw-side-59", mode: "faders-pan" },
      { controlId: "daw-side-49", mode: "faders-send" },
    ],
    // The arrows on the DAW port: up, down, left and right, as the device sends them in this layout (CC 91-94).
    pageButtons: { pageUp: "daw-top-91", pageDown: "daw-top-92", pageLeft: "daw-top-93", pageRight: "daw-top-94" },
    faders: {
      inputPortId: "daw-in",
      inputChannel: 4,
      feedbackPortId: "daw-out",
      feedbackChannel: 5,
      banks: [
        { id: "volume", bipolar: false, colour: 37, controllers: [80, 81, 82, 83, 84, 85, 86, 87] },
        { id: "pan", bipolar: true, colour: 21, controllers: [88, 89, 90, 91, 92, 93, 94, 95] },
        { id: "send", bipolar: false, colour: 13, controllers: [102, 103, 104, 105, 106, 107, 108, 109] },
      ],
    },
  },
];

/**
 * ECS-96: the side buttons and the arrows as the DAW port sends them in the fader layout (CC 89-39 and 91-94, channel 1, on `daw-in`). The
 * device sends them on this port only while a fader mode is shown, so a fader mode switches away from them on this port.
 */
export const LAUNCHPAD_MINI_MK3_DAW_SIDE_BUTTONS: readonly PhysicalControl[] = [
  ...[89, 79, 69, 59, 49, 39].map((controller) => ({
    id: `daw-side-${controller}`,
    label: `DAW side button (CC ${controller})`,
    kind: "button" as const,
    portId: "daw-in",
    input: { address: { type: "control-change" as const, controller }, channel: 0 },
  })),
  // The DAW-port arrows (ECS-96): page up, down, left and right through tracks in the fader layout.
  ...[91, 92, 93, 94].map((controller, index) => ({
    id: `daw-top-${controller}`,
    label: `DAW arrow ${["up", "down", "left", "right"][index]} (CC ${controller})`,
    kind: "button" as const,
    portId: "daw-in",
    input: { address: { type: "control-change" as const, controller }, channel: 0 },
  })),
];

/**
 * The fader controls of every bank in the mixer-faders mode (ECS-96), generated from the banks so each fader's CC,
 * channel and colour feedback are declared once. Input is the fader's CC on `daw-in`; feedback is the colour set on
 * `daw-out`, a palette entry selected by the value byte (`velocity-color-led`, 128 palette entries).
 */
export const LAUNCHPAD_MINI_MK3_FADER_CONTROLS: readonly PhysicalControl[] = LAUNCHPAD_MINI_MK3_MODES.flatMap((mode) =>
  mode.faders.banks.flatMap((bank) =>
    bank.controllers.map((controller, index): PhysicalControl => ({
      id: `fader-${bank.id}-${index}`,
      label: `${bank.id} fader ${index + 1} (CC ${controller})`,
      kind: "fader",
      portId: mode.faders.inputPortId,
      input: { address: { type: "control-change", controller }, channel: mode.faders.inputChannel },
      feedback: {
        kind: "velocity-color-led",
        paletteSize: 128,
        address: { address: { type: "control-change", controller: index }, channel: mode.faders.feedbackChannel },
      },
      feedbackPortId: mode.faders.feedbackPortId,
    })),
  ),
);

/** 64 pads + 8 top-row + 8 side-column + 1 logo = 81 controls, matching the generated document's own count, plus the mixer-faders banks (ECS-96). */
export const LAUNCHPAD_MINI_MK3_CONTROLS: readonly PhysicalControl[] = [
  ...LAUNCHPAD_MINI_MK3_PADS,
  ...LAUNCHPAD_MINI_MK3_TOP_ROW,
  ...LAUNCHPAD_MINI_MK3_SIDE_COLUMN,
  LAUNCHPAD_MINI_MK3_LOGO,
  ...LAUNCHPAD_MINI_MK3_FADER_CONTROLS,
  ...LAUNCHPAD_MINI_MK3_DAW_SIDE_BUTTONS,
];

export const LAUNCHPAD_MINI_MK3_PAD_GRID: ControlGrid = {
  id: "pads",
  label: "8x8 pad grid",
  rows: 8,
  columns: 8,
  cells: LAUNCHPAD_MINI_MK3_PADS.map((pad, index) => ({ row: Math.floor(index / 8), column: index % 8, controlId: pad.id })),
  paging: { rows: 8, columns: 8 },
};

/**
 * Vendor SysEx is one of several ways to reach Programmer mode and light
 * the surface (the Programmer/Live mode switch message, or the device's
 * own setup menu), and Note/CC-based colour-setting fully covers lighting
 * without any SysEx, so normal operation doesn't depend on it.
 */
export const LAUNCHPAD_MINI_MK3_SYSEX: DeviceSysExProfile = {
  manufacturerId: [0x00, 0x20, 0x29],
  required: false,
  notes:
    "Vendor SysEx is one of several ways to reach Programmer mode and light the surface (the Programmer/Live mode switch message, or the device's own setup menu) and Note/CC-based colour-setting fully covers lighting without any SysEx, so normal operation doesn't depend on it.",
};

/**
 * Programmer mode is the one thing this device needs before its note/CC addressing
 * applies: a fresh device starts in Live/Session mode. Setup runs on every connect
 * (`docs/contracts/device-setup.md`). The Device Inquiry reply is checked against
 * the Novation id and Launchpad Mini [MK3] family code; the four revision bytes
 * are a wildcard. Bootloader mode replies differently and will fail this
 * step, which is reported rather than skipped.
 */
export const LAUNCHPAD_MINI_MK3_SETUP: DeviceSetup = {
  inputPortId: "midi-in",
  outputPortId: "midi-out",
  steps: [
    {
      id: "device-inquiry-request",
      description: "Universal Device Inquiry, to identify the device.",
      send: [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7],
    },
    {
      id: "device-inquiry-reply",
      description: "Device Inquiry reply: Novation id 00 20 29, Launchpad Mini [MK3] family 13 01. The four revision bytes after the family member are wildcards.",
      expect: [0xf0, 0x7e, 0x00, 0x06, 0x02, 0x00, 0x20, 0x29, 0x13, 0x01, 0x00, 0x00, null, null, null, null, 0xf7],
    },
    {
      id: "enter-programmer-mode",
      description: "Switch into Programmer mode so the note/CC addressing in this profile is active.",
      send: [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x0e, 0x01, 0xf7],
    },
  ],
};

/**
 * ECS-90 / ECS-95: the sequencer's roles on this device. Side buttons switch steps / mixer. Side-69 is free (ECS-96): it was
 * the transport mode, and transport gets its own surface in a separate issue, so transport has no mode button for now. The first four
 * top-row buttons (CC 91-94) are the arrows: up and down page through tracks, left and right page through time.
 * Transport moved to the side column (CC 59-29, under the mode buttons) because the arrows take CC 91-94. The top-row
 * arrows are assumed to read up, down, left, right from the left, matching the device's user guide; confirm on hardware.
 * This is the Launchpad's usage, not a fact about the hardware, which is why it lives in the profile as a default and
 * can be overridden in the app.
 */
export const LAUNCHPAD_MINI_MK3_LAYOUT: DeviceLayout = {
  modeButtons: [
    { controlId: "side-89", mode: "steps" },
    { controlId: "side-79", mode: "mixer" },
    { controlId: "side-69", mode: "faders-volume" },
    { controlId: "side-59", mode: "faders-pan" },
    { controlId: "side-49", mode: "faders-send" },
  ],
  pageUp: "top-91",
  pageDown: "top-92",
  pageLeft: "top-93",
  pageRight: "top-94",
  transport: { play: "side-59", stop: "side-49", record: "side-39", clear: "side-29" },
};


export const LAUNCHPAD_MINI_MK3_PROFILE: DeviceProfile = {
  schemaVersion: DEVICE_PROFILE_SCHEMA_VERSION,
  identity: LAUNCHPAD_MINI_MK3_IDENTITY,
  ports: LAUNCHPAD_MINI_MK3_PORTS,
  controls: LAUNCHPAD_MINI_MK3_CONTROLS,
  grids: [LAUNCHPAD_MINI_MK3_PAD_GRID],
  sysex: LAUNCHPAD_MINI_MK3_SYSEX,
  setup: LAUNCHPAD_MINI_MK3_SETUP,
  layout: LAUNCHPAD_MINI_MK3_LAYOUT,
  modes: LAUNCHPAD_MINI_MK3_MODES,
};
