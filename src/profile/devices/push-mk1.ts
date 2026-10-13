import type { PhysicalControl } from "../types/control.js";
import type { DeviceDisplayDefinition } from "../types/display.js";
import type { ControlGrid } from "../types/grid.js";
import type { DeviceIdentity } from "../types/identity.js";
import type { DeviceLayout, DeviceLayoutColours } from "../types/layout.js";
import type { RgbColour } from "../../mapping/types/address.js";
import type { DevicePortProfile } from "../types/port.js";
import {
  DEVICE_PROFILE_SCHEMA_VERSION,
  type DeviceProfile,
} from "../types/profile.js";
import type { DeviceSysExProfile } from "../types/sysex.js";

// ---------------------------------------------------------------------------------------------------------------
// COLOUR CONFIGURATION -- edit here to restyle the Push's sequencer LEDs; nothing else needs to change.
//
// The Push's pads and mute strip are `velocity-color-led`s: the device shows whatever colour a raw velocity/CC value
// selects, so each role below is a pair -- the `colour` the sequencer asks for (any RgbColour; only used to tell
// roles apart, and just has to differ between roles) and the `velocity` byte that actually lights the LED.
// To try a different colour, change the `velocity`.
//
// Hardware status of each byte (see docs/hardware-validation-push-mk1.md): 36 (teal) confirmed on a real pad;
// 22 (green) confirmed on the selection buttons (CC 36-43); 6 (red) confirmed on the upper control row (CC 102);
// 1 and 2 (dim/brighter white) from the same hands-on ramp. 127 is the plain
// full-on byte steps already used. Everything but 36 is hardware-unverified *on the pads in this role*; the pads
// follow the same ramp as the CC buttons, so expect it to be right but tune on a real Push.
// ---------------------------------------------------------------------------------------------------------------
interface PushColour {
  readonly colour: RgbColour;
  readonly velocity: number;
}

/**
 * The step grid. "Even"/"odd" is the track row's 0-based index (so it survives track paging); step vs. stepLength is
 * whether the cell starts a note or continues one.
 */
const GRID_COLOURS = {
  stepEven: { colour: { red: 0, green: 0, blue: 127 }, velocity: 29 }, // unchanged from before: plain full-on
  stepOdd: { colour: { red: 0, green: 100, blue: 0 }, velocity: 37 }, // green
  stepLengthEven: { colour: { red: 0, green: 0, blue: 32 }, velocity: 30 }, // brighter white: the rest of a held note
  stepLengthOdd: { colour: { red: 0, green: 32, blue: 0 }, velocity: 38 }, // dim white
  playhead: { colour: { red: 0, green: 70, blue: 100 }, velocity: 9 }, // teal, confirmed
} as const satisfies Record<string, PushColour>;

/** The track mute buttons (the upper control row; also the mixer's pad row). Lit state follows each visible track. */
const MUTE_COLOURS = {
  muted: { colour: { red: 127, green: 0, blue: 0 }, velocity: 6 }, // red
  unmuted: { colour: { red: 0, green: 127, blue: 0 }, velocity: 22 }, // green
} as const satisfies Record<string, PushColour>;

/** What the sequencer is asked to light, handed to the layout; the matching velocity bytes become the palettes below. */
const PUSH_SEQUENCER_COLOURS: DeviceLayoutColours = {
  stepEven: GRID_COLOURS.stepEven.colour,
  stepOdd: GRID_COLOURS.stepOdd.colour,
  stepLengthEven: GRID_COLOURS.stepLengthEven.colour,
  stepLengthOdd: GRID_COLOURS.stepLengthOdd.colour,
  playhead: GRID_COLOURS.playhead.colour,
  mutes: MUTE_COLOURS.muted.colour,
  unmuted: MUTE_COLOURS.unmuted.colour,
};

/**
 * The Push 1 (Mk1) profile describes its controls, grids, display and User Mode MIDI ports.
 *
 * User Mode must already be active before connecting. It is selected by the physical User button; this profile has
 * no setup handshake or mode profile, and only models the `user-port-in`/`user-port-out` pair.
 *
 * `layout` is a usage default, not a hardware fact. `Note`/`Session` (CC 50/51) stand in for the sequencer's
 * `steps`/`mixer` roles, and the dedicated Arrow buttons page. `transport.stop`/`transport.clear` have no assigned
 * button because no dedicated Stop or Clear control is documented.
 */

export const PUSH_MK1_IDENTITY: DeviceIdentity = {
  id: "ableton.push-mk1",
  manufacturer: "Ableton",
  model: "Push",
};

/**
 * Only the User Port is modeled: the device's other port pair ("Ableton Push Live Port") runs Ableton's own internal
 * Live control-surface protocol, which neither research doc covers and which is out of scope for a User Mode profile.
 */
export const PUSH_MK1_PORTS: readonly DevicePortProfile[] = [
  {
    id: "user-port-in",
    type: "input",
    role: "main",
    required: true,
    messageTypes: [
      "note-on",
      "note-off",
      "control-change",
      "poly-pressure",
      "channel-pressure",
      "pitch-bend",
      "sysex",
    ],
  },
  {
    id: "user-port-out",
    type: "output",
    role: "main",
    required: true,
    messageTypes: ["note-on", "note-off", "control-change", "sysex"],
  },
];

/** The 8 parameter encoders plus Master, Swing and Tempo: each a CC (relative turn) and a Note (capacitive touch). */
const ENCODERS = [
  { id: "encoder-1", label: "Encoder 1 (leftmost)", cc: 71, touchNote: 0 },
  { id: "encoder-2", label: "Encoder 2", cc: 72, touchNote: 1 },
  { id: "encoder-3", label: "Encoder 3", cc: 73, touchNote: 2 },
  { id: "encoder-4", label: "Encoder 4", cc: 74, touchNote: 3 },
  { id: "encoder-5", label: "Encoder 5", cc: 75, touchNote: 4 },
  { id: "encoder-6", label: "Encoder 6", cc: 76, touchNote: 5 },
  { id: "encoder-7", label: "Encoder 7", cc: 77, touchNote: 6 },
  { id: "encoder-8", label: "Encoder 8", cc: 78, touchNote: 7 },
  {
    id: "encoder-master",
    label: "Master Encoder (rightmost)",
    cc: 79,
    touchNote: 8,
  },
  { id: "encoder-swing", label: "Swing Encoder", cc: 15, touchNote: 9 },
  { id: "encoder-tempo", label: "Tempo Encoder", cc: 14, touchNote: 10 },
] as const;

export const PUSH_MK1_ENCODERS: readonly PhysicalControl[] = ENCODERS.flatMap(
  ({ id, label, cc, touchNote }) => [
    {
      id,
      label: `${label} (CC ${cc}, relative turn)`,
      kind: "encoder",
      portId: "user-port-in",
      input: {
        address: { type: "control-change", controller: cc },
        channel: 0,
      },
      valueMode: "relative",
      // Hands-on checks confirmed signed 7-bit two's-complement delta encoding on Encoder 1 and the Tempo
      // encoder, independently re-confirmed on a second MIDI monitor; the other 9 are the same component family,
      // assumed but not individually turned -- same "declare the fact, flag the unconfirmed extent" stance this
      // profile already takes for its other partially-verified controls.
      relativeEncoding: "twos-complement-7bit",
    },
    {
      id: `${id}-touch`,
      label: `${label} touch (Note ${touchNote})`,
      kind: "button",
      portId: "user-port-in",
      input: { address: { type: "note", note: touchNote }, channel: 0 },
    },
  ],
);

/** The touch strip: a pitch-bend wheel plus its own capacitive tap (Note 12), independent of the bend stream. */
export const PUSH_MK1_TOUCH_STRIP: readonly PhysicalControl[] = [
  {
    id: "touch-strip",
    label: "Touch strip (pitch bend)",
    kind: "wheel",
    portId: "user-port-in",
    input: { address: { type: "pitch-bend" }, channel: 0 },
  },
  {
    id: "touch-strip-tap",
    label: "Touch strip tap (Note 12)",
    kind: "button",
    portId: "user-port-in",
    input: { address: { type: "note", note: 12 }, channel: 0 },
  },
];

/**
 * The one confirmed (colour, velocity) correspondence on this device's pad LEDs: raw velocity 36 shows a
 * clear greenish-blue/teal on a real pad, following the same white-then-reds-then-rest-of-the-palette ramp
 * ECS-145 already found on the mute strip (CC 102) -- not independently re-probed on the mute strip itself, only
 * the same white-then-reds-then-rest-of-the-palette ramp observed on the mute strip (CC 102) -- not independently
 * the pads. The colour below must match `DEFAULT_SEQUENCER_COLOURS.playhead` (`src/configurations/sequencer.ts`)
 * exactly, byte for byte -- that's the app-level colour this entry exists to recognise, kept as a literal here
 * rather than an import to keep this device-facing profile independent of that app-level configuration module, the
 * same direction-of-dependency `docs/contracts/device-profile.md` already holds profiles to. No general RGB-to-
 * velocity scheme is confirmed beyond this one entry -- see `ControlFeedback.colourPalette`'s own doc comment for
 * why an unmatched colour still renders as plain on/off, not a guessed byte.
 */
const PUSH_MK1_PAD_COLOUR_PALETTE: readonly PushColour[] = [
  ...Object.values(GRID_COLOURS),
  ...Object.values(MUTE_COLOURS),
];

/** The mute strip only ever shows the two mute colours. */
const PUSH_MK1_MUTE_STRIP_COLOUR_PALETTE: readonly PushColour[] =
  Object.values(MUTE_COLOURS);

/** Bottom-left-origin, row-major note numbering (notes 36-99): row 0 (bottom) is 36-43, row 7 (top) is 92-99. */
function padControl(rowFromBottom: number, column: number): PhysicalControl {
  const note = 36 + rowFromBottom * 8 + column;
  return {
    id: `pad-${note}`,
    label: `Pad (note ${note})`,
    kind: "pad",
    portId: "user-port-in",
    input: { address: { type: "note", note }, channel: 0 },
    feedback: {
      kind: "velocity-color-led",
      address: { address: { type: "note", note }, channel: 0 },
      paletteSize: 128,
      colourPalette: PUSH_MK1_PAD_COLOUR_PALETTE,
    },
    feedbackPortId: "user-port-out",
  };
}

export const PUSH_MK1_PADS: readonly PhysicalControl[] = Array.from(
  { length: 8 },
  (_, rowFromBottom) => rowFromBottom,
).flatMap((rowFromBottom) =>
  Array.from({ length: 8 }, (_, column) => padControl(rowFromBottom, column)),
);

/**
 * Utility, navigation and mode-select buttons: all CC-addressed, monochrome LED feedback (off/dim/full,
 * not a colour palette -- that's the upper control row's own `MUTE_STRIP_BUTTONS` below, a different control
 * family entirely, see that constant's doc comment).
 */
const UTILITY_BUTTONS = [
  ["display-1", "Display row button 1 (above screen, leftmost)", 20],
  ["display-2", "Display row button 2", 21],
  ["display-3", "Display row button 3", 22],
  ["display-4", "Display row button 4", 23],
  ["display-5", "Display row button 5", 24],
  ["display-6", "Display row button 6", 25],
  ["display-7", "Display row button 7", 26],
  ["display-8", "Display row button 8 (above screen, rightmost)", 27],
  ["tap-tempo", "Tap Tempo", 3],
  ["metronome", "Metronome", 9],
  ["master", "Master", 28],
  ["stop-clip", "Stop", 29],
  ["shift", "Shift", 49],
  ["note", "Note", 50],
  ["session", "Session", 51],
  ["arrow-up", "Arrow Up", 46],
  ["arrow-down", "Arrow Down", 47],
  ["arrow-left", "Arrow Left", 44],
  ["arrow-right", "Arrow Right", 45],
  ["play", "Play", 85],
  ["record", "Record", 86],
  ["new", "New", 87],
  ["duplicate", "Duplicate", 88],
  ["automation", "Automation", 89],
  ["fixed-length", "Fixed Length", 90],
  ["volume", "Volume", 114],
  ["pan-send", "Pan / Send", 115],
  ["devices", "Devices", 110],
  ["browse", "Browse", 111],
  ["track", "Track", 112],
  ["scales", "Scales", 58],
  // REMOVED: the doc's CC 116 "Track" claim -- unconfirmed, and redundant with the real Track at CC 112.
  // REMOVED: the doc's CC 59 "Session" claim -- that's the hardcoded User-mode toggle (round 2), not a normal
  // mappable button; same control the doc separately (and correctly) called "hardcoded, unmappable".
  // REMOVED: the doc's CC 34 "Select" and CC 35 "Shift" claims (ECS-136 gate, 2026-10-09) -- neither CC lit any
  // button on this unit across three live checks, and midi-profiler's independent cross-check diagram shows no
  // Select/Shift pair near the nav pad. Likely the same Push 2 layout conflation already found in this section.
] as const;

/**
 * The lowest raw CC value that renders a dim-but-visible, non-full LED level on this unit's monochrome
 * utility buttons -- hands-on confirmed on two independent physical buttons, Play (CC 85) and Shift (CC 49):
 * `0` = off, `1` = dim/steady, `2`-`3` = dim/blinking (increasingly fast), `4` = full/steady, `5`-`6` =
 * full/blinking, `7` and up = full/steady (clamped -- 40/50/127 all read identically to `4`). Only the two steady
 * states (`1`, `4`/`127`) are modeled here; the blink states are a real device capability, but this contract has no
 * for (no "blinking" feedback level exists in this contract) and are left unused, not un-discovered.
 */
const PUSH_MK1_DIM_VALUE = 1;

export const PUSH_MK1_UTILITY_BUTTONS: readonly PhysicalControl[] =
  UTILITY_BUTTONS.map(([id, label, cc]) => ({
    id: `button-${id}`,
    label: `${label} (CC ${cc})`,
    kind: "button",
    portId: "user-port-in",
    input: { address: { type: "control-change", controller: cc }, channel: 0 },
    feedback: {
      kind: "monochrome-led",
      address: {
        address: { type: "control-change", controller: cc },
        channel: 0,
      },
      dimValue: PUSH_MK1_DIM_VALUE,
    },
    feedbackPortId: "user-port-out",
  }));

/**
 * The upper control row (CC 102-109), used as the dedicated mute strip, is not a monochrome on/off/dim button like
 * dedicated mute strip since ECS-138, is NOT a monochrome on/off/dim button like the rest of `UTILITY_BUTTONS` --
 * it was only ever lumped in with them because the original `UTILITY_BUTTONS` loop blanket-applied monochrome
 * feedback to every CC-addressed button, never individually hands-on-checked. Probing CC 102 by hand (same method
 * as the dim-value probe above) showed a value-selected *colour* palette -- white, orange, red, yellow, green,
 * pink, turquoise at different raw values -- the same `velocity-color-led` family the 64 pads already declare, not
 * a brightness scale at all. Giving this row a `dimValue` the way the other utility buttons get one would be
 * inventing a brightness tier where the device actually changes hue. No per-colour palette mapping is modeled here;
 * the pads' "own bright/standard/dim RGB tiers... a separate, already-flagged gap (ECS-135), not this ticket's" --
 * the mute strip turns out to belong to that excluded family instead of the one this ticket extends. No per-colour
 * palette mapping is modeled here, same "declare the fact, leave the unresolved extent unresolved" stance this
 * profile already takes elsewhere (e.g. `relativeEncoding`'s "assumed, not confirmed" note on 9 of 11 encoders).
 */
const MUTE_STRIP_BUTTONS = [
  ["upper-1", "Upper control row button 1 (leftmost)", 102],
  ["upper-2", "Upper control row button 2", 103],
  ["upper-3", "Upper control row button 3", 104],
  ["upper-4", "Upper control row button 4", 105],
  ["upper-5", "Upper control row button 5", 106],
  ["upper-6", "Upper control row button 6", 107],
  ["upper-7", "Upper control row button 7", 108],
  ["upper-8", "Upper control row button 8 (rightmost)", 109],
] as const;

export const PUSH_MK1_MUTE_STRIP_BUTTONS: readonly PhysicalControl[] =
  MUTE_STRIP_BUTTONS.map(([id, label, cc]) => ({
    id: `button-${id}`,
    label: `${label} (CC ${cc})`,
    kind: "button",
    portId: "user-port-in",
    input: { address: { type: "control-change", controller: cc }, channel: 0 },
    feedback: {
      kind: "velocity-color-led",
      address: {
        address: { type: "control-change", controller: cc },
        channel: 0,
      },
      paletteSize: 128,
      colourPalette: PUSH_MK1_MUTE_STRIP_COLOUR_PALETTE,
    },
    feedbackPortId: "user-port-out",
  }));

/**
 * CC 36-43 are not the same monochrome on/off/dim family
 * `UTILITY_BUTTONS` uses. The device's actual LED byte is a raw value 1-26 selecting a distinct hue per sub-range,
 * each with its own dim-steady/dim-flashing/bright-steady/bright-flashing tiers (the same four-state shape
 * `PUSH_MK1_DIM_VALUE`'s own doc comment already found for the monochrome family, just per-colour here instead of
 * once overall) -- raw value 1 reads white-ish, the low 20s read green. Modeled as `velocity-color-led`
 * (`PUSH_MK1_SELECTION_COLOUR_PALETTE`), the same family `PUSH_MK1_PAD_COLOUR_PALETTE` already uses for the pads'
 * confirmed playhead colour, with `dimValue` layered on top for the "available, not selected"
 * boolean-paired feedback kind addressed by... control-change") layered on top for the "available, not selected"
 * resting state -- the mapping layer's `buildFeedbackMessage()` was extended (ECS-155) to resolve `colourPalette`
 * for a control-change address the same way it already did for a note one, rather than this profile needing a
 * one-off workaround. Chosen operating values, confirmed to render correctly: `10` (a steady tier within the
 * white-ish range, used as every selection button's resting colour) and `22` (a steady green, used only for the
 * currently selected one) -- not the only values that would work, just the two actually tried.
 */
const PUSH_MK1_SELECTION_DIM_VALUE = 10;

/**
 * Must match `DEFAULT_SEQUENCER_COLOURS.selection` (`src/configurations/sequencer.ts`) exactly, byte for byte --
 * see `PUSH_MK1_PAD_COLOUR_PALETTE`'s own doc comment for why this is a literal here rather than a shared import.
 */
const PUSH_MK1_SELECTION_COLOUR_PALETTE = [
  { colour: { red: 127, green: 0, blue: 127 }, velocity: 22 },
] as const;

/**
 * These are side buttons, a vertical column, not a horizontal row -- confirmed
 * hands-on to run CC 43 (topmost) down to CC 36 (bottommost), descending top to bottom. `select-1` (the
 * physically topmost button, so the first slot/track on a page) is therefore CC 43, not CC 36; `select-8`
 * (bottommost, the last slot/track) is CC 36. `PUSH_MK1_SELECTION_GRID` lays these out as a single column with
 * `select-1` at row 0 (top), matching the pad grid's own "row 0 is the top" convention.
 */
const SELECTION_BUTTONS = [
  ["select-1", "Selection button 1 (topmost)", 43],
  ["select-2", "Selection button 2", 42],
  ["select-3", "Selection button 3", 41],
  ["select-4", "Selection button 4", 40],
  ["select-5", "Selection button 5", 39],
  ["select-6", "Selection button 6", 38],
  ["select-7", "Selection button 7", 37],
  ["select-8", "Selection button 8 (bottommost)", 36],
] as const;

export const PUSH_MK1_SELECTION_BUTTONS: readonly PhysicalControl[] =
  SELECTION_BUTTONS.map(([id, label, cc]) => ({
    id: `button-${id}`,
    label: `${label} (CC ${cc})`,
    kind: "button",
    portId: "user-port-in",
    input: { address: { type: "control-change", controller: cc }, channel: 0 },
    feedback: {
      kind: "velocity-color-led",
      address: {
        address: { type: "control-change", controller: cc },
        channel: 0,
      },
      dimValue: PUSH_MK1_SELECTION_DIM_VALUE,
      colourPalette: PUSH_MK1_SELECTION_COLOUR_PALETTE,
    },
    feedbackPortId: "user-port-out",
  }));

/** 135 controls total: 11 encoders + 11 touch notes, the touch strip + its tap, 64 pads, 8 mute-strip buttons, 8 selection buttons, 31 other utility/nav/mode buttons. */
export const PUSH_MK1_CONTROLS: readonly PhysicalControl[] = [
  ...PUSH_MK1_ENCODERS,
  ...PUSH_MK1_TOUCH_STRIP,
  ...PUSH_MK1_PADS,
  ...PUSH_MK1_UTILITY_BUTTONS,
  ...PUSH_MK1_MUTE_STRIP_BUTTONS,
  ...PUSH_MK1_SELECTION_BUTTONS,
];

export const PUSH_MK1_PAD_GRID: ControlGrid = {
  id: "pads",
  label: "8x8 pad grid",
  rows: 8,
  columns: 8,
  cells: PUSH_MK1_PADS.map((pad, index) => {
    const rowFromBottom = Math.floor(index / 8);
    const column = index % 8;
    return { row: 7 - rowFromBottom, column, controlId: pad.id }; // row 0 = top, matching the Launchpad's own convention
  }),
  paging: { rows: 8, columns: 8 },
};

/**
 * The upper control row (CC 102-109), directly above the pad grid, is a dedicated mute strip instead of the
 * "dedicated labelled controls above the grid" the ticket asks this profile to evaluate moving mute onto, instead
 * of the dedicated `mixer` mode's grid takeover. One row, 8 columns, left to right, matching the row-0 orientation
 * `PUSH_MK1_PAD_GRID`'s own top row already uses. No `paging` of its own: `layout.dedicatedMuteGridId` (see
 * `PUSH_MK1_LAYOUT`) shares the step grid's own page offset instead, so up/down (which already pages tracks in
 * `steps` mode) moves both at once.
 */
export const PUSH_MK1_MUTE_STRIP_GRID: ControlGrid = {
  id: "mute-strip",
  label: "Upper control row, as a dedicated mute strip",
  rows: 1,
  columns: 8,
  cells: Array.from({ length: 8 }, (_, column) => ({
    row: 0,
    column,
    controlId: `button-upper-${column + 1}`,
  })),
};

/**
 * A vertical column (one per row, not one per column), confirmed hands-on -- these
 * are side buttons, not a row like `PUSH_MK1_MUTE_STRIP_GRID`. `select-1` (CC 43, the physically topmost button)
 * is row 0, matching the pad grid's own "row 0 is the top" convention; `select-8` (CC 36, bottommost) is row 7.
 * Still shares the step grid's own page offset and needs no paging of its own, same as the mute strip -- just
 * along the vertical axis this device's grids already page by default, not a horizontal one.
 */
export const PUSH_MK1_SELECTION_GRID: ControlGrid = {
  id: "selection-buttons",
  label: "CC 36-43, as a dedicated column of contextual selection buttons",
  rows: 8,
  columns: 1,
  cells: Array.from({ length: 8 }, (_, row) => ({
    row,
    column: 0,
    controlId: `button-select-${row + 1}`,
  })),
};

/**
 * Phase 2: the 8 generic parameter encoders (`encoder-1`..`encoder-8`, left to right), as a dedicated one-row
 * grid -- the same "model a control row as a `ControlGrid` purely to reuse windowing math" shape
 * `PUSH_MK1_MUTE_STRIP_GRID`/`PUSH_MK1_SELECTION_GRID` already use. No `paging` of its own: `layout.encoderBank`
 * shares the step grid's own page offset, so vertical paging (the same Arrow Up/Down that already pages tracks
 * for the step grid and the mute strip) also moves which 8 tracks the encoders drive -- "the Push as a hardware
 * view onto webseq's existing mixer state," not a second, Push-only paging model. `encoder-9`/`-10`/`-11`
 * (Master/Swing/Tempo, see `PUSH_MK1_ENCODERS`' own doc comment) are dedicated controls, not part of this bank.
 */
export const PUSH_MK1_ENCODER_BANK_GRID: ControlGrid = {
  id: "encoder-bank",
  label:
    "The 8 generic parameter encoders, as a dedicated bank of per-track controls",
  rows: 1,
  columns: 8,
  cells: Array.from({ length: 8 }, (_, column) => ({
    row: 0,
    column,
    controlId: `encoder-${column + 1}`,
  })),
};

/**
 * Vendor SysEx (F0 47 7F ...) is used for the LCD text display and global configuration (aftertouch mode, Live/User
 * mode force) -- confirmed hands-on for the display and the aftertouch-mode toggle. Normal pad/button/encoder
 * operation doesn't depend on any of it; the LCD is the only feedback with no Note/CC alternative, and this profile
 * doesn't model text-display feedback as a `PhysicalControl` (there's no control kind for a multi-line text display).
 */
export const PUSH_MK1_SYSEX: DeviceSysExProfile = {
  manufacturerId: [0x47, 0x7f],
  required: false,
  notes:
    "F0 47 7F 15 {line} 00 45 00 [68 ASCII bytes] F7 rewrites one of the 4 LCD lines (confirmed hands-on). " +
    "F0 47 7F 15 5C 00 01 {00|01} F7 forces polyphonic/monophonic aftertouch (confirmed hands-on). " +
    "F0 47 7F 15 62 00 01 {00|01} F7 forces Live/User mode (documented, not sent during verification).",
};

/**
 * The 4-line LCD, confirmed hands-on:
 * `F0 47 7F 15 {lineId} 00 45 00 [68 ASCII bytes] F7` rewrites one line. `lineId` is 0x18-0x1b for lines 1-4 --
 * see `PUSH_MK1_SYSEX.notes` above. `PUSH_MK1_LAYOUT.displayLines` names which line plays
 * extension) instead of free text only. ECS-139 wires it: `PUSH_MK1_LAYOUT.displayLines` names which line plays
 * each application text role, and `createSequencerBindings()` emits a `DisplayBinding` per role the application
 * fills. This template and its byte layout are unchanged by that wiring.
 */
export const PUSH_MK1_DISPLAY: DeviceDisplayDefinition = {
  id: "lcd",
  label: "4-line LCD",
  portId: "user-port-out",
  prefix: [0xf0, 0x47, 0x7f, 0x15],
  textPrefix: [0x00, 0x45, 0x00],
  charCount: 68,
  /**
   * The 8 encoder-aligned segments: 8 characters each, laid out as 4 cells of 17 characters (segment, segment, one
   * spare column), so segment `i` starts at `8*i + floor(i/2)`. Only the 17-character cell structure is the
   * well-known Push 1 layout; the exact placement of the spare column has not been confirmed on this unit.
   */
  segments: { width: 8, offsets: [0, 8, 17, 25, 34, 42, 51, 59] },
  /**
   * Level-bar glyphs. Only printable ASCII (32-126) is verified to render on this display
   * (`midi-profiler/research/push-mk1/sysex-mapping.md`), so the bar is built from ASCII rather than from any
   * unverified block-character code: `[=== ]` is a bar, `-` a half cell.
   */
  meter: { open: "[", close: "]", empty: " ", half: "-", full: "=" },
  lines: [
    { id: "line-1", label: "Line 1", lineId: 0x18 },
    { id: "line-2", label: "Line 2", lineId: 0x19 },
    { id: "line-3", label: "Line 3", lineId: 0x1a },
    { id: "line-4", label: "Line 4", lineId: 0x1b },
  ],
};

/**
 * The sequencer's roles on this device. `Note` (CC 50)
 * stands in for steps mode; the dedicated Arrow buttons page. No bank roles: nothing documented on this device
 * groups buttons into bank select A-D the way the Launchpad's top row does.
 *
 * No `mixer` mode button. `Session` (CC 51) does not switch to `mixer`, so the button remains free.
 * `mixer` before this ticket; that entry is removed, not merely left unindicated, so `Session` is now free (same
 * "left unresolved rather than guessed at" treatment `transport.clear` already got above).
 * **Why**: the dedicated `mixer` mode made every mute reachable only by giving up the entire pad grid (steps
 * disappear while it's shown) -- a worse trade on this device than on the Launchpad, which has no equivalent to
 * the upper control row below. `dedicatedMuteGridId` (below) moves the *same* mute responsibility onto that row
 * instead, visible and live in `steps` and `mixer` at once, with no mode switch and no lost grid. The generic
 * `mixer` `SurfaceModeDefinition` `createSequencerBindings` always builds is untouched and still exists for other
 * devices (the Launchpad still reaches it from `side-79`) -- this is a profile-level routing choice, not a change
 * to shared code, and it costs nothing: with no button naming `mixer`, that mode is simply never reachable on this
 * device, the same way an unresolved mode/page/transport role already works elsewhere in this layout.
 * `indicator: true` below lights
 * `Note` according to the surface's actual active mode, and the mute strip (CC 102-109) lights and toggles mute
 * correctly, live in `steps` with no mode switch. See `docs/hardware-validation-push-mk1.md` for
 * the full record.
 *
 * No `transport` mode button. `button-stop-clip` is `layout.transport.stop`: a plain
 * *reach* `transport` mode -- the sole mode where Play/Record's bindings actually existed -- so leaving the steps
 * or mixer grid was the price of pressing Play. `button-stop-clip` is now `layout.transport.stop` instead: a plain
 * transport control, like `button-play`/`button-record`, that `createSequencerBindings` binds in every mode this
 * profile has, no mode switch required. The generic `transport` `SurfaceModeDefinition` is untouched and still
 * built (unreachable here, the same way `mixer` already is); any device that still wants a dedicated transport mode
 * keeps that option.
 *
 * `modifier: "button-shift"`. Nothing here uses a
 * `when`-conditional binding yet, `modifier`'s original (ECS-137) purpose -- but `bindSurfaceMode()` now also
 * lights whichever control this names (dim while released, full while held) whenever that control declares a
 * `feedback` with a `dimValue`, which `button-shift` (CC 49) now does, hands-on confirmed above. Declaring this
 * costs nothing on its own (no binding here sets `when`, so the modifier-dispatch behavior stays exactly as
 * unused as before) and gives Shift a real, lit state it never had -- the one `button-shift` was always missing
 * despite having `feedback` declared on its `PhysicalControl` since this profile's very first version.
 *
 * `selectionGridId` names the CC 36-43 side-button column (`PUSH_MK1_SELECTION_GRID`), and
 * `selectionClear` names the existing Master button (CC 28, already declared in `UTILITY_BUTTONS`) as the control
 * that clears item selection and enters the master/context state. Both are device facts only -- what a selected
 * index means, and what "master" switches to, is entirely the integration layer's
 * (`docs/contracts/control-api.md`'s own boundary).
 */
export const PUSH_MK1_LAYOUT: DeviceLayout = {
  modeButtons: [{ controlId: "button-note", mode: "steps", indicator: true }],
  pageUp: "button-arrow-up",
  pageDown: "button-arrow-down",
  pageLeft: "button-arrow-left",
  pageRight: "button-arrow-right",
  transport: {
    play: "button-play",
    stop: "button-stop-clip",
    record: "button-record",
  },
  dedicatedMuteGridId: "mute-strip",
  colours: PUSH_SEQUENCER_COLOURS,
  modifier: "button-shift",
  selectionGridId: "selection-buttons",
  selectionClear: "button-master",
  /**
   * No `encoders` roles: encoder-1..8 belong to `encoderBank` below, which already decides what each of them
   * drives per category (volume/devices). A physical control has exactly one owner -- a fixed `encoders` role on
   * one of those cells would be a second, selection-bound target for the same turn (validate-profile rejects it).
   * `encoder-master`/`encoder-swing`/`encoder-tempo` are not bank cells and remain free for fixed roles.
   */
  /**
   * The 4-line LCD, one line per semantic role the application may fill -- the selected track, its
   * selected effect, that effect's lead parameter (name and value) and the transport. Which control feeds each role
   * is the application's own (`SequencerContract.displayLines`); which physical line it lands on is this profile's.
   */
  displayLines: {
    track: { displayId: "lcd", lineId: "line-1" },
    effect: { displayId: "lcd", lineId: "line-2" },
    parameter: { displayId: "lcd", lineId: "line-3" },
    transport: { displayId: "lcd", lineId: "line-4" },
  },
  /**
   * Phase 2: the generic encoder bank (`PUSH_MK1_ENCODER_BANK_GRID`). `Volume` (CC114) selects the application's
   * "volume" category -- the one with a window, driving the bank's own per-track volumes. `Devices`
   * (CC110) is declared as the future "Device/FX parameter" category's own entry point, per this ticket's explicit
   * scope -- it gets a button and (once the application names a mode value for it) an indicator, but no window
   * bindings exist for it yet, the same "entry point, not an implementation" treatment `transport.clear` gets on a
   * device with no button for it.
   */
  encoderBank: {
    gridId: "encoder-bank",
    modeButtons: { volume: "button-volume", devices: "button-devices" },
    // The top line shows each track's volume as a level bar above its encoder while Volume is live. Devices puts
    // each FX parameter's value on line 3 (replacing the lead-parameter text, which the bars supersede) with its
    // name directly beneath on line 4, so the selected track and effect stay readable on lines 1-2.
    meterLines: {
      volume: { displayId: "lcd", lineId: "line-1" },
      devices: { displayId: "lcd", lineId: "line-3", labelLineId: "line-4" },
    },
  },
};

export const PUSH_MK1_PROFILE: DeviceProfile = {
  schemaVersion: DEVICE_PROFILE_SCHEMA_VERSION,
  identity: PUSH_MK1_IDENTITY,
  ports: PUSH_MK1_PORTS,
  controls: PUSH_MK1_CONTROLS,
  grids: [
    PUSH_MK1_PAD_GRID,
    PUSH_MK1_MUTE_STRIP_GRID,
    PUSH_MK1_SELECTION_GRID,
    PUSH_MK1_ENCODER_BANK_GRID,
  ],
  sysex: PUSH_MK1_SYSEX,
  layout: PUSH_MK1_LAYOUT,
  displays: [PUSH_MK1_DISPLAY],
};
