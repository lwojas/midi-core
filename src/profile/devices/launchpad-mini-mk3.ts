import type { PhysicalControl } from "../types/control.js";
import type { ControlGrid } from "../types/grid.js";
import type { DeviceHandshake } from "../types/handshake.js";
import type { DeviceIdentity } from "../types/identity.js";
import type { DevicePortProfile } from "../types/port.js";
import { DEVICE_PROFILE_SCHEMA_VERSION, type DeviceProfile } from "../types/profile.js";
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

/** Programmer-mode pad addressing: note = (8 - row) * 10 + (column + 1), row/column both 0-based top-left-origin — row 0 is notes 81-88, row 7 is notes 11-18, matching the device's own row-major note numbering (manual p.10). */
function padControl(row: number, column: number): PhysicalControl {
  const note = (8 - row) * 10 + (column + 1);
  return {
    id: `pad-${note}`,
    label: `Pad (note ${note})`,
    kind: "pad",
    portId: "midi-in",
    input: { address: { type: "note", note }, channel: 0 },
    feedback: { kind: "velocity-color-led", address: { address: { type: "note", note }, channel: 0 }, paletteSize: 128 },
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
    feedback: { kind: "velocity-color-led", address: { address: { type: "control-change", controller }, channel: 0 }, paletteSize: 128 },
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
    feedback: { kind: "velocity-color-led", address: { address: { type: "control-change", controller }, channel: 0 }, paletteSize: 128 },
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
  feedback: { kind: "velocity-color-led", address: { address: { type: "control-change", controller: 99 }, channel: 0 }, paletteSize: 128 },
  feedbackPortId: "midi-out",
};

/** 64 pads + 8 top-row + 8 side-column + 1 logo = 81 controls, matching the generated document's own count. */
export const LAUNCHPAD_MINI_MK3_CONTROLS: readonly PhysicalControl[] = [
  ...LAUNCHPAD_MINI_MK3_PADS,
  ...LAUNCHPAD_MINI_MK3_TOP_ROW,
  ...LAUNCHPAD_MINI_MK3_SIDE_COLUMN,
  LAUNCHPAD_MINI_MK3_LOGO,
];

export const LAUNCHPAD_MINI_MK3_PAD_GRID: ControlGrid = {
  id: "pads",
  label: "8x8 pad grid",
  rows: 8,
  columns: 8,
  cells: LAUNCHPAD_MINI_MK3_PADS.map((pad, index) => ({ row: Math.floor(index / 8), column: index % 8, controlId: pad.id })),
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
 * **Not run automatically by `ControlSurface.attach()`**: `required` is
 * `false` (per the generated document — normal note/CC traffic works
 * without it once the device happens to already be in Programmer mode),
 * so `attach()` skips every step here regardless of whether a
 * `HandshakeExecutor` is supplied (`docs/contracts/surface-lifecycle.md`'s
 * `required` gate). A caller that needs the mode-switch step actually sent
 * — true the first time a fresh device is connected, since it defaults to
 * Live/Session mode — must perform it independently before relying on
 * this profile's addressing. See docs/hardware-validation.md's "Findings"
 * section: recorded there as a real usability gap in the `required`-gated
 * handshake design, not fixed here, since changing that gate is
 * `docs/contracts/surface-lifecycle.md`'s decision to make, not a profile
 * authoring choice.
 */
export const LAUNCHPAD_MINI_MK3_HANDSHAKE: DeviceHandshake = {
  required: false,
  steps: [
    {
      id: "device-inquiry-request",
      direction: "send",
      description: "Send the Universal Device Inquiry SysEx message (F0h 7Eh 7Fh 06h 01h F7h) to identify the device.",
    },
    {
      id: "device-inquiry-reply",
      direction: "expect",
      description:
        "Expect the Device Inquiry reply (F0h 7Eh 00h 06h 02h 00h 20h 29h 13h 01h 00h 00h <app_version> F7h for Application mode, or the equivalent Bootloader-mode reply), confirming the Novation manufacturer id and the Launchpad Mini [MK3] family code (13h 01h).",
    },
    {
      id: "enter-programmer-mode",
      direction: "send",
      description:
        "Send the Programmer/Live mode SysEx message (F0h 00h 20h 29h 02h 0Dh 0Eh 01h F7h) to switch the device into Programmer mode, enabling the generic note/CC addressing this profile's controls use.",
    },
  ],
};

export const LAUNCHPAD_MINI_MK3_PROFILE: DeviceProfile = {
  schemaVersion: DEVICE_PROFILE_SCHEMA_VERSION,
  identity: LAUNCHPAD_MINI_MK3_IDENTITY,
  ports: LAUNCHPAD_MINI_MK3_PORTS,
  controls: LAUNCHPAD_MINI_MK3_CONTROLS,
  grids: [LAUNCHPAD_MINI_MK3_PAD_GRID],
  sysex: LAUNCHPAD_MINI_MK3_SYSEX,
  handshake: LAUNCHPAD_MINI_MK3_HANDSHAKE,
};
