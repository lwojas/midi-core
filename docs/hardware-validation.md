# Hardware Validation: Novation Launchpad Mini [MK3] with the Surface Runtime

Status: Final (validation report; two architecture decisions open, see "Open decisions")
Linear: [ECS-79](https://linear.app/ecs3d/issue/ECS-79/select-and-validate-one-real-device-with-the-surface-runtime)
Depends on: ECS-69–78
Profile: [docs/contracts/launchpad-mini-mk3-profile.md](./contracts/launchpad-mini-mk3-profile.md)
Source of truth: [`src/profile/devices/launchpad-mini-mk3.ts`](../src/profile/devices/launchpad-mini-mk3.ts),
[`demo/launchpad-surface.js`](../demo/launchpad-surface.js),
[`scripts/launchpad-live.mjs`](../scripts/launchpad-live.mjs),
[`scripts/node-midi-transport.mjs`](../scripts/node-midi-transport.mjs)

## Purpose

Proof-scope step 4 of [docs/control-surface-architecture.md](./control-surface-architecture.md):
replace ECS-77's mock device with one real device and check the surface's
input, feedback, context/modes and lifecycle against it. Device protocol
knowledge stays in the profile and in one demo/script layer, never in the
surface runtime or the sequencer.

## How it was run

- **Browser (Web MIDI, `demo/launchpad.html`)**: first attempt. Works, but
  needs a person to grant the permission prompt and to report back, so it
  was not used for the validation runs. Its findings are below.
- **Node (`npm run launchpad:live -- <seconds> <pads|transport>`)**:
  `@julusian/midi` (CoreMIDI) behind midi-core's own `RawMidiInput`/
  `RawMidiOutput` seam (`scripts/node-midi-transport.mjs`). No browser, no
  permission prompt. This is the route used for the validation runs.

The same `createLaunchpadSurface()` (`demo/launchpad-surface.js`) runs on
both transports, so the surface code under test is identical.

## Results

| Area | Result | Evidence |
|---|---|---|
| Lifecycle | Pass | attach → attached, detach → detached, both ports closed cleanly |
| Programmer mode | Pass (manual) | Device echoed the switch SysEx (`f0 00 20 29 02 0d 0e 01 f7`) |
| Input, pads | Pass | Each press/release on note 11–88 reached the app as the expected pad state |
| Input, CC buttons | Pass | Top row CC 91–98 and side column decoded on channel 0 as profiled |
| Feedback, app → device | Pass | App-side set-all-on/off lit and cleared all 64 pads; press light-while-held works |
| Context/modes, pads mode | Pass | Pads drive their 64 Controls; top row ignored |
| Context/modes, transport mode | Pass | Top row 91–94 → play/stop/record/clear; 95–98 ignored; pad presses don't change app state (`pads lit now=0`) |
| Release handling | Pass after fix | Release as Note On velocity 0 now resolves to off (see F1) |

## Browser validation in webseq (ECS-94)

Run against the real sequencer app in a browser, on the same Launchpad Mini
MK3, using webseq's MIDI panel (device picker, Connect, Disconnect). Webseq
commit: `cbc7584` (the fixes below are in it). Firmware version, browser and
browser version were not recorded for this run.

| Check | Result | Notes |
|---|---|---|
| 1. Connection and selection | Pass | Launchpad listed; matched name and help text shown; unrelated input refused |
| 2. Setup on connect | Pass | Device Inquiry accepted; Programmer mode entered; no setup errors in the log |
| 3. Steps mode | Pass | Pads toggle steps; rows = tracks 1–8, columns = beats; paging 95/96 stops at sequence length; pad colours match step state |
| 4. Mixer mode | Pass | Side button 79 switches; top pad row mutes tracks 1–8; lights follow mute |
| 5. Transport mode | Pass | Side button 69 switches; 91/92 play/stop; 93/94 record/clear |
| 6. Mode switching | Pass | 89/79/69 switch in each direction; surface mode matches the UI |
| 7. Changes from the UI | Pass | Mouse mute and step edits update pad lights while connected |
| 8. Disconnect and reconnect | Pass | Disconnect releases the device; reconnect restores Programmer mode and steps view with UI state preserved |
| 9. Unplug during a session | Pass after fix | See W2 |

**W1: SysEx access not requested (fixed in webseq).** The first connect failed
with `System exclusive message is not allowed at index 0 (240)`. webseq called
`requestWebMidiAccess()` without options, so the browser granted access without
SysEx permission and rejected the Programmer-mode setup. Fixed by requesting
`{ sysex: true }`. A browser-only issue: the Node transport has no such
permission, which is why the Node runs did not catch it.

**W2: unplug left the UI showing "connected" (fixed in webseq).** midi-core
moved the surface to `"error"` when the cable was pulled, but webseq did not
observe the surface's state. Fixed by releasing the surface on `"error"` and
showing the device as disconnected, so Connect is offered again. Re-verified on
hardware: after replugging and reconnecting, the device entered Programmer mode
with the steps and mutes restored.

## Findings

**F1: release sent as Note On velocity 0 was read as press (fixed).**
`resolveIncomingValue()` mapped every `note-on` to `true`, so each pad stayed
on after one press. Fixed in `src/mapping/value.ts`, with a test. Reproduced
before the fix and confirmed after.

**F2: profiler evidence omits `feedbackPortId` (corrected on import; upstream gap).**
Every feedback-bearing control in the midi-profiler evidence lacks
`feedbackPortId`, though feedback and input use different physical ports.
Without it, `generateControlMappings()` defaults the feedback port to the
input port, and `bindSurfaceMode()` silently drops the whole mapping (input
included). `validateDeviceProfile()` does not catch this. Corrected in
`src/profile/devices/launchpad-mini-mk3.ts`; confirmed live (feedback goes
out on `midi-out`). The upstream fix belongs in midi-profiler's generation
pipeline, which is outside this ticket.

**F3: setup gated on `handshake.required`, so Programmer mode was never sent (resolved by device setup).**
`attach()` ran handshake steps only when `handshake.required` was true, whatever
executor was supplied. A fresh device starts in Live mode, so the switch was
effectively mandatory, and the demo and script sent it themselves. Resolved by
replacing the handshake with device setup (`docs/contracts/device-setup.md`):
the profile declares the steps with their bytes, and `attach()` runs them on
every connect, with no `required` gate.

**F4: pads do not self-light on press (by design; app policy added).**
Echo suppression (ECS-57) withholds feedback for a value that arrived from the
device, and Programmer-mode pads don't light themselves. The surface has no
first-class "reflect input as feedback" mapping. The demo/script add a
press-lights-pad policy through `bindEventFeedback()`, the existing
event-feedback path, not a raw send.

**F5: feedback follows the active mode, and the press-LED ignores it (open).**
- Feedback is bound only for the active mode's controls. In transport mode an
  app-side change to a pad Control sends nothing, and LEDs left lit by the
  previous mode are not cleared on mode exit. This is what the first
  transport-mode run showed: the LED sweep ran after the switch and lit nothing
  (a script-ordering mistake, since fixed; the surface behaved as specified).
- The press-LED policy is app-side and mode-independent, so pads still light
  on press while in transport mode, even though the same pads aren't active
  there. Inconsistent with the bullet above.
Both need a policy decision (see below). The surface currently has no
"repaint on mode change" responsibility.

**F6: the Launchpad's top and side buttons are CC, not note (expected).**
The profile records this (Programmer mode, CC 91–98, 89…19, 99). The surface
routes them correctly. Earlier "buttons send CCs" reports were the profile
working as designed.

**F7: browser Web MIDI needs a human in the loop (tooling).**
Chrome's MIDI permission prompt and the observation loop both need a person,
which made the browser route unsuitable for repeatable hardware checks. The
Node transport removes the browser and the prompt. A person still presses the
pads, but the run is repeatable from the terminal.

## Sequencer surface UI (ECS-95)

Covered by unit and end-to-end tests (`src/configurations/launchpad-paging.test.ts`)
driving the real profile through the surface runtime with raw Note/CC messages.

- **Arrows** (top row CC 91-94) page tracks (up/down, eight at a time) and time
  (left/right) in steps mode. Up/down also pages the mixer. **Passed on hardware**,
  including the arrow order (up, down, left, right, left to right).
- **Transport** moved from top-row CC 91-94 to the side column (CC 59/49/39/29),
  because the arrows take 91-94. Not yet checked on hardware since the move; the
  ECS-79/94 transport checks predate it.
- **Mixer mutes** lie across the top row, one track per column, laid out
  horizontally as the mixer UI is. Paging up and down moves that row through the
  tracks. Not yet checked on hardware.
- **RGB feedback**: pads and buttons are lit by RGB SysEx rather than velocity.
  Steps are blue and track mutes red (a usage default in `sequencer.ts`). Not yet
  checked on hardware; confirm the colours and that off really goes black.

**Mixer faders (investigated, not implemented).** The manual's Programmer/DAW
reference (`midi-profiler/research/novation-launchpad-mini-mk3/programmers-reference-manual.pdf`)
says the faders are not available in Programmer mode:

- Faders are the **DAW Fader layout** (layout `0Dh`), which is "only selectable in
  DAW mode". Programmer mode is layout `7Fh`. Only one layout is shown at a time.
- Enabling it takes two steps: DAW mode on (`F0 00 20 29 02 0D 10 01 F7`), then
  layout DAW Faders (`F0 00 20 29 02 0D 00 0D F7`). Programmer mode comes back with
  layout `7Fh`. Bank setup is `F0 00 20 29 02 0D 01 00 <orientation> <fader>... F7`,
  where each fader gives its index, unipolar/bipolar, CC and colour.
- Fader moves arrive and are sent on **channel 5** (CC on B4h): the DAW Fader
  position and activity messages. These are the DAW ports (`daw-in` / `daw-out`)
  that the profile declares but does not address.

What this means for the surface: faders need the device to change layout when the
mixer is entered and left. The sequencer configuration can only do that through a
mode hook that has an output, and it has none today. Whether the arrows and the
mixer's pad mutes still send in the DAW Fader layout is unknown, and needs a
hardware check. Any fader feedback must not echo a fader's own CC back, per the
echo lesson in ECS-57. This needs a follow-up ticket, with hardware testing first.

## Open decisions

1. **F3**: resolved by device setup (see above). Remaining decision: none.
   The options below are kept for the record. (a) mark this profile's handshake `required: true`, which is a profile-level correction;
   (b) change `attach()` to run steps when an executor is present, which is a
   runtime contract change for `docs/contracts/surface-lifecycle.md`.
2. **F5**: on mode change, should the surface repaint the outgoing mode's LEDs
   (clear them) and paint the incoming mode's? Should the press-LED policy be
   mode-scoped?

## Traceability

- ECS-77 — mock validation this device validation builds on.
- ECS-78 — the sequencer integration; the same ControlSurface pattern, now on hardware.
- ECS-80 — MIDI Profiler → surface integration. F2 is an input to it.
