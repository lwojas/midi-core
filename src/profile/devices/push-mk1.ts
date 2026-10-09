import type { PhysicalControl } from "../types/control.js";
import type { DeviceDisplayDefinition } from "../types/display.js";
import type { ControlGrid } from "../types/grid.js";
import type { DeviceIdentity } from "../types/identity.js";
import type { DeviceLayout } from "../types/layout.js";
import type { DevicePortProfile } from "../types/port.js";
import { DEVICE_PROFILE_SCHEMA_VERSION, type DeviceProfile } from "../types/profile.js";
import type { DeviceSysExProfile } from "../types/sysex.js";

/**
 * ECS-91: this project's second real-device `DeviceProfile` — the Ableton
 * Push 1 (Mk1), chosen per ECS-79's own criteria against the Launchpad Mini
 * MK3: it differs in periphery (encoders, a touch strip, an LCD, utility
 * buttons laid out around an 8x8 grid rather than a top row/side column),
 * not grid size, which is enough to exercise the role-based configuration
 * path (ECS-90) against controls the Launchpad doesn't have.
 *
 * Transcribed, not hand-authored: every id/address/label below reproduces
 * midi-profiler's generated document exactly (`profiles/push-mk1/generate-
 * input.json` in that repo, `profiles/push-mk1/report.json` — zero
 * validation diagnostics), re-expressed as generator functions the same
 * way `launchpad-mini-mk3.ts` already does. The canonical reference for
 * this device is `research/push-mk1/midi-usermode-mapping-verified.md`
 * (midi-profiler repo), which explicitly supersedes the original
 * `midi-usermode-mapping.md`'s button-label claims and is itself checked
 * against `AbletonPushUserModeHack.png`, an independent, named-author
 * diagram — read the verified doc and the diagram, not the original, when
 * extending this profile.
 *
 * **Round 2 correction**: about half the "Bottom & Layout Selection
 * Blocks"/"Right Column" button labels in midi-profiler's original research
 * doc turned out to be wrong (it looks conflated with Push 2's layout in
 * places) — caught when this profile's first `layout` used CC 58/59 for
 * "Note"/"Session" and a live hardware check (`scripts/push-mk1-live.mjs`)
 * showed CC 58 actually printed "Scales". Every label in that doc section
 * was re-checked by lighting one CC at a time and reading what's actually
 * printed on it; see `research/push-mk1/verification/VERIFICATION.md`'s
 * "Round 2" section (midi-profiler repo) for the full table. The real
 * Note/Session pair is CC 50/51, not 58/59 — CC 59 is the hardcoded
 * Live/User mode toggle, not a normal button.
 *
 * **Two things this profile deliberately does not model, both from
 * midi-profiler's own `unresolved` list**:
 * - **No `setup`.** Unlike the Launchpad, there's no verified Device
 *   Inquiry reply for this device, and User Mode itself is a physical
 *   toggle (the User button), not a SysEx switch this profile can safely
 *   automate — the one documented SysEx that forces it (`sysex-mapping.md`
 *   section 3) was deliberately never sent during verification, to avoid
 *   dropping the port mid-session. Automating an unverified mode-forcing
 *   command on every `attach()` would be inventing a handshake this
 *   project has no evidence actually works, so it's left out; the device
 *   must already be in User Mode (User button held) before connecting.
 * - **No `modes`.** No DAW Fader-style layout is documented for Push 1's
 *   User Mode the way the Launchpad's DAW port has one — only the single
 *   `user-port-in`/`user-port-out` pair this profile addresses.
 *
 * **`layout` is a usage default, not a hardware fact** (same disclaimer
 * `launchpad-mini-mk3.ts` makes about its own): Push 1 doesn't have
 * dedicated "mode" buttons the way the Launchpad's side column does, so
 * `Note`/`Session` (CC 50/51, confirmed by hands-on reading, not the doc's
 * original wrong CC 58/59) — real buttons, functionally generic to this
 * surface — were chosen to stand in for the sequencer's `steps`/`mixer`
 * modes, and the
 * dedicated `Arrow` buttons for paging. `transport.stop`/`transport.clear`
 * have no assigned button: nothing in either research doc documents a
 * dedicated Stop or Clear button, so those roles are left unresolved
 * rather than guessed at.
 *
 * **ECS-136 gate verification (2026-10-09)**: the doc's "Select"/"Shift"
 * pair (CC 34/35, "Right Side Navigation Pad" section) was never re-checked
 * in Round 2 and is now confirmed absent from this unit — lighting both
 * CCs (`scripts/push-mk1-contract-probe.mjs shift34`/`shift35`) produced no
 * visible LED anywhere on the device, across three independent runs, and
 * midi-profiler's own independent cross-check diagram
 * (`AbletonPushUserModeHack.png`) shows the nav-pad diamond as only four
 * buttons (CC 44/45/46/47) with no Select/Shift pair beside it — consistent
 * with the doc's own admission of Push 2 layout conflation. Both ids are
 * removed below rather than kept as unmappable placeholders. `button-shift`
 * (CC 49) is the one real Shift/modifier button: lit and pressed back
 * correctly, twice, in the same session — see
 * `docs/hardware-validation-push-mk1.md`'s "ECS-136 gate verification"
 * section for the full verification record.
 *
 * **ECS-137**: the ECS-136 gate's reviewed contract extensions, applied to this profile where they have a concrete
 * case here. `relativeEncoding` is now declared on every encoder (the gate's §1 hardware finding). `PUSH_MK1_DISPLAY`
 * declares the LCD's SysEx template as data (the gate's extension 3) in place of `PUSH_MK1_SYSEX.notes`' free-text
 * description of the same bytes -- actually driving a string `Control` through it is ECS-139's job, not this one's.
 *
 * **Full Push-2-contamination audit (2026-10-09)**: every control below was
 * re-checked by hand against `AbletonPushUserModeHack.png` (the one source
 * in this chain independently authored, not derived from the original
 * doc). Every encoder, the touch strip, all 64 pads, both utility-button
 * rows (CC 20-27, CC 102-109), the left-column utility and modes/
 * sequencing buttons, Master/Stop (CC 28/29), Note/Session (CC 50/51) and
 * the nav diamond (CC 44-47) all match the diagram's own numbering. CC
 * 34/35 (removed above) was the only contaminated entry still present;
 * nothing else in this profile needed to change. One pre-existing, already
 * -flagged gap the diagram reiterates: the paired-button block beside the
 * pad grid (diagram shows CC 48-57/60-63 unlabeled) includes CC 48, right
 * next to the confirmed-real CC 49 Shift — never tested on hardware, not
 * in this profile, not newly discovered here but worth re-surfacing since
 * it sits directly beside a control this pass did re-verify.
 *
 * **ECS-138**: Phase 2's mode refinement. `Session` (CC 51) no longer selects a `mixer` mode -- see
 * `PUSH_MK1_LAYOUT`'s own doc comment for the full decision and its reasoning. `button-note`/`button-stop-clip`
 * (steps/transport) now light while their own mode is active (`indicator: true`), and the upper control row
 * (CC 102-109, `PUSH_MK1_MUTE_STRIP_GRID`) is a dedicated, always-available mute strip in place of the removed
 * mode's grid takeover. Both confirmed hands-on -- see `PUSH_MK1_LAYOUT`'s own comment and
 * `docs/hardware-validation-push-mk1.md`.
 *
 * **ECS-145**: Phase 3's dim/full LED tiers. Every `UTILITY_BUTTONS` control now declares a `feedback.dimValue`
 * (see `PUSH_MK1_DIM_VALUE`'s own doc comment for the hands-on byte-level finding), and `PUSH_MK1_LAYOUT` names
 * `button-shift` as `modifier` for the first time, which also gives Shift real LED feedback it never had. One
 * real research correction came out of this: the upper control row (CC 102-109) turned out not to be a monochrome
 * button family at all -- see `MUTE_STRIP_BUTTONS`'s own doc comment -- so it's a separate export now,
 * `velocity-color-led` like the pads, with no `dimValue`. See `docs/hardware-validation-push-mk1.md`'s ECS-145
 * section for the full probe results and what's still only assumed, not individually confirmed.
 *
 * **ECS-150**: the sequencer's playhead (ECS-131) now reaches this device's real colour, not just a plain on/off.
 * `PUSH_MK1_PAD_COLOUR_PALETTE`'s own doc comment has the hands-on finding -- one raw velocity, hands-on confirmed
 * to show greenish-blue/teal on a real pad, declared on `PUSH_MK1_PADS`' `feedback.colourPalette`
 * (`ControlFeedback.colourPalette`, new this ticket). No other colour is covered: steps/mutes/banks still render
 * as plain on/off here exactly as before, since this ticket's own scope is the playhead only, not the pads' full
 * bright/standard/dim RGB tiers (still ECS-135's gap, not reopened here).
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
    messageTypes: ["note-on", "note-off", "control-change", "poly-pressure", "channel-pressure", "pitch-bend", "sysex"],
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
  { id: "encoder-master", label: "Master Encoder (rightmost)", cc: 79, touchNote: 8 },
  { id: "encoder-swing", label: "Swing Encoder", cc: 15, touchNote: 9 },
  { id: "encoder-tempo", label: "Tempo Encoder", cc: 14, touchNote: 10 },
] as const;

export const PUSH_MK1_ENCODERS: readonly PhysicalControl[] = ENCODERS.flatMap(({ id, label, cc, touchNote }) => [
  {
    id,
    label: `${label} (CC ${cc}, relative turn)`,
    kind: "encoder",
    portId: "user-port-in",
    input: { address: { type: "control-change", controller: cc }, channel: 0 },
    valueMode: "relative",
    // ECS-136 gate: hands-on confirmed signed 7-bit two's-complement delta encoding on Encoder 1 and the Tempo
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
]);

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
 * ECS-150: the one confirmed (colour, velocity) correspondence on this device's pad LEDs, hands-on probed with
 * `scripts/push-mk1-pad-color-probe.mjs` (new for this ticket -- the note-addressed sibling of ECS-145's
 * `push-mk1-led-level-probe.mjs`, needed because the pads are note- not CC-addressed): raw velocity 36 shows a
 * clear greenish-blue/teal on a real pad, following the same white-then-reds-then-rest-of-the-palette ramp
 * ECS-145 already found on the mute strip (CC 102) -- not independently re-probed on the mute strip itself, only
 * the pads. The colour below must match `DEFAULT_SEQUENCER_COLOURS.playhead` (`src/configurations/sequencer.ts`)
 * exactly, byte for byte -- that's the app-level colour this entry exists to recognise, kept as a literal here
 * rather than an import to keep this device-facing profile independent of that app-level configuration module, the
 * same direction-of-dependency `docs/contracts/device-profile.md` already holds profiles to. No general RGB-to-
 * velocity scheme is confirmed beyond this one entry -- see `ControlFeedback.colourPalette`'s own doc comment for
 * why an unmatched colour still renders as plain on/off, not a guessed byte.
 */
const PUSH_MK1_PAD_COLOUR_PALETTE = [{ colour: { red: 0, green: 70, blue: 100 }, velocity: 36 }] as const;

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

export const PUSH_MK1_PADS: readonly PhysicalControl[] = Array.from({ length: 8 }, (_, rowFromBottom) => rowFromBottom).flatMap((rowFromBottom) =>
  Array.from({ length: 8 }, (_, column) => padControl(rowFromBottom, column)),
);

/**
 * Utility, navigation and mode-select buttons: all CC-addressed, monochrome LED feedback (ECS-145: off/dim/full,
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
  ["stop-clip", "Stop", 29], // doc said "Stop Clip"; actually prints "Stop" (round 2)
  ["shift", "Shift", 49], // doc said "Mute" (wrong); actually "Shift" (round 2); the real/only Shift -- see ECS-136 gate note above
  ["note", "Note", 50], // doc said "Solo" (wrong); actually the REAL "Note" button (round 2)
  ["session", "Session", 51], // doc said "Record Arm" (wrong); actually the REAL "Session" button (round 2)
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
  ["devices", "Devices", 110], // doc said "Device"; actually "Devices" (round 2)
  ["browse", "Browse", 111],
  ["track", "Track", 112], // doc said "Clip" (wrong); actually the REAL "Track" button (round 2)
  ["scales", "Scales", 58], // doc said "Note" (wrong); actually "Scales" (round 2)
  // REMOVED: the doc's CC 116 "Track" claim -- unconfirmed, and redundant with the real Track at CC 112.
  // REMOVED: the doc's CC 59 "Session" claim -- that's the hardcoded User-mode toggle (round 2), not a normal
  // mappable button; same control the doc separately (and correctly) called "hardcoded, unmappable".
  // REMOVED: the doc's CC 34 "Select" and CC 35 "Shift" claims (ECS-136 gate, 2026-10-09) -- neither CC lit any
  // button on this unit across three live checks, and midi-profiler's independent cross-check diagram shows no
  // Select/Shift pair near the nav pad. Likely the same Push 2 layout conflation already found in this section.
] as const;

/**
 * ECS-145: the lowest raw CC value that renders a dim-but-visible, non-full LED level on this unit's monochrome
 * utility buttons -- hands-on confirmed on two independent physical buttons, Play (CC 85) and Shift (CC 49):
 * `0` = off, `1` = dim/steady, `2`-`3` = dim/blinking (increasingly fast), `4` = full/steady, `5`-`6` =
 * full/blinking, `7` and up = full/steady (clamped -- 40/50/127 all read identically to `4`). Only the two steady
 * states (`1`, `4`/`127`) are modeled here; the blink states are a real device capability this ticket has no use
 * for (no "blinking" feedback level exists in this contract) and are left unused, not un-discovered.
 */
const PUSH_MK1_DIM_VALUE = 1;

export const PUSH_MK1_UTILITY_BUTTONS: readonly PhysicalControl[] = UTILITY_BUTTONS.map(([id, label, cc]) => ({
  id: `button-${id}`,
  label: `${label} (CC ${cc})`,
  kind: "button",
  portId: "user-port-in",
  input: { address: { type: "control-change", controller: cc }, channel: 0 },
  feedback: {
    kind: "monochrome-led",
    address: { address: { type: "control-change", controller: cc }, channel: 0 },
    dimValue: PUSH_MK1_DIM_VALUE,
  },
  feedbackPortId: "user-port-out",
}));

/**
 * ECS-145 finding, correcting a previously-unverified assumption: the upper control row (CC 102-109), used as the
 * dedicated mute strip since ECS-138, is NOT a monochrome on/off/dim button like the rest of `UTILITY_BUTTONS` --
 * it was only ever lumped in with them because the original `UTILITY_BUTTONS` loop blanket-applied monochrome
 * feedback to every CC-addressed button, never individually hands-on-checked. Probing CC 102 by hand (same method
 * as the dim-value probe above) showed a value-selected *colour* palette -- white, orange, red, yellow, green,
 * pink, turquoise at different raw values -- the same `velocity-color-led` family the 64 pads already declare, not
 * a brightness scale at all. Giving this row a `dimValue` the way the other utility buttons get one would be
 * inventing a brightness tier where the device actually changes hue; per the ticket's own scoping, this is exactly
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

export const PUSH_MK1_MUTE_STRIP_BUTTONS: readonly PhysicalControl[] = MUTE_STRIP_BUTTONS.map(([id, label, cc]) => ({
  id: `button-${id}`,
  label: `${label} (CC ${cc})`,
  kind: "button",
  portId: "user-port-in",
  input: { address: { type: "control-change", controller: cc }, channel: 0 },
  feedback: { kind: "velocity-color-led", address: { address: { type: "control-change", controller: cc }, channel: 0 }, paletteSize: 128 },
  feedbackPortId: "user-port-out",
}));

/** 127 controls total: 11 encoders + 11 touch notes, the touch strip + its tap, 64 pads, 8 mute-strip buttons, 31 other utility/nav/mode buttons. */
export const PUSH_MK1_CONTROLS: readonly PhysicalControl[] = [
  ...PUSH_MK1_ENCODERS,
  ...PUSH_MK1_TOUCH_STRIP,
  ...PUSH_MK1_PADS,
  ...PUSH_MK1_UTILITY_BUTTONS,
  ...PUSH_MK1_MUTE_STRIP_BUTTONS,
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
 * ECS-138: the upper control row (CC 102-109), directly above the pad grid, as a dedicated mute strip -- the
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
  cells: Array.from({ length: 8 }, (_, column) => ({ row: 0, column, controlId: `button-upper-${column + 1}` })),
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
 * The 4-line LCD (ECS-137), confirmed hands-on and independently re-confirmed at the ECS-136 gate:
 * `F0 47 7F 15 {lineId} 00 45 00 [68 ASCII bytes] F7` rewrites one line. `lineId` is 0x18-0x1b for lines 1-4 --
 * see `PUSH_MK1_SYSEX.notes` above, now re-expressed as a declarative `DeviceDisplayDefinition` (ECS-137's contract
 * extension) instead of free text only. Driving an actual string `Control` through this (e.g. showing the current
 * mode/track/parameter) is ECS-139's job, not this ticket's -- this profile declares the display contract, nothing
 * wires a `DisplayBinding` to it yet.
 */
export const PUSH_MK1_DISPLAY: DeviceDisplayDefinition = {
  id: "lcd",
  label: "4-line LCD",
  portId: "user-port-out",
  prefix: [0xf0, 0x47, 0x7f, 0x15],
  textPrefix: [0x00, 0x45, 0x00],
  charCount: 68,
  lines: [
    { id: "line-1", label: "Line 1", lineId: 0x18 },
    { id: "line-2", label: "Line 2", lineId: 0x19 },
    { id: "line-3", label: "Line 3", lineId: 0x1a },
    { id: "line-4", label: "Line 4", lineId: 0x1b },
  ],
};

/**
 * ECS-90: the sequencer's roles on this device. `Note` (CC 50, round-2-corrected -- see the file doc comment above)
 * stands in for steps mode; the dedicated Arrow buttons page. No bank roles: nothing documented on this device
 * groups buttons into bank select A-D the way the Launchpad's top row does.
 *
 * **ECS-138: no `mixer` mode button, by deliberate decision, not an oversight.** `Session` (CC 51) switched to
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
 * **Confirmed hands-on (2026-10-09)**: the new LED traffic this decision adds -- `indicator: true` below lights
 * `Note` according to the surface's actual active mode, and the mute strip (CC 102-109) lights and toggles mute
 * correctly, live in `steps` with no mode switch. See `docs/hardware-validation-push-mk1.md`'s ECS-138 section for
 * the full record.
 *
 * **ECS-146: no `transport` mode button either, for the same reason.** `Stop` (CC 29) used to be the only way to
 * *reach* `transport` mode -- the sole mode where Play/Record's bindings actually existed -- so leaving the steps
 * or mixer grid was the price of pressing Play. `button-stop-clip` is now `layout.transport.stop` instead: a plain
 * transport control, like `button-play`/`button-record`, that `createSequencerBindings` binds in every mode this
 * profile has, no mode switch required. The generic `transport` `SurfaceModeDefinition` is untouched and still
 * built (unreachable here, the same way `mixer` already is); any device that still wants a dedicated transport mode
 * keeps that option.
 *
 * **ECS-145: `modifier: "button-shift"`, declared for the first time on this profile.** Nothing here uses a
 * `when`-conditional binding yet, `modifier`'s original (ECS-137) purpose -- but `bindSurfaceMode()` now also
 * lights whichever control this names (dim while released, full while held) whenever that control declares a
 * `feedback` with a `dimValue`, which `button-shift` (CC 49) now does, hands-on confirmed above. Declaring this
 * costs nothing on its own (no binding here sets `when`, so the modifier-dispatch behavior stays exactly as
 * unused as before) and gives Shift a real, lit state it never had -- the one `button-shift` was always missing
 * despite having `feedback` declared on its `PhysicalControl` since this profile's very first version.
 */
export const PUSH_MK1_LAYOUT: DeviceLayout = {
  modeButtons: [{ controlId: "button-note", mode: "steps", indicator: true }],
  pageUp: "button-arrow-up",
  pageDown: "button-arrow-down",
  pageLeft: "button-arrow-left",
  pageRight: "button-arrow-right",
  transport: { play: "button-play", stop: "button-stop-clip", record: "button-record" },
  dedicatedMuteGridId: "mute-strip",
  modifier: "button-shift",
};

export const PUSH_MK1_PROFILE: DeviceProfile = {
  schemaVersion: DEVICE_PROFILE_SCHEMA_VERSION,
  identity: PUSH_MK1_IDENTITY,
  ports: PUSH_MK1_PORTS,
  controls: PUSH_MK1_CONTROLS,
  grids: [PUSH_MK1_PAD_GRID, PUSH_MK1_MUTE_STRIP_GRID],
  sysex: PUSH_MK1_SYSEX,
  layout: PUSH_MK1_LAYOUT,
  displays: [PUSH_MK1_DISPLAY],
};
