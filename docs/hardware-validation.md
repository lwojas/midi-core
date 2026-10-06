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
  horizontally as the mixer UI is. Left and right page that row through the
  tracks, eight at a time (up and down are unbound in the mixer). The mute
  orientation passed on hardware; the left/right paging change is not yet checked.
- **RGB feedback**: pads and buttons are lit by RGB SysEx rather than velocity.
  Steps are blue and track mutes red by default. An app sets its own colours
  through the sequencer contract's `colours`. Not yet checked on hardware; confirm
  the colours and that off really goes black.

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

**ECS-96 spike (hardware, `scripts/launchpad-daw-spike.mjs`).** Run on the device, on the MIDI In port and on the DAW In port:

- **Layout switching works on the MIDI port, confirmed on hardware.** DAW mode enable
  (`10 01`) and the DAW Fader layout (`00 0D`) were sent on `MIDI In`. Readbacks
  confirmed DAW mode `00` → `01` and the layout `7F` → `0D`, and Programmer mode came
  back with `00 7F`. The readbacks reply on `MIDI Out`.
- **The DAW In port also accepts the same sequence**, with the same readbacks.
- **Fader moves arrive on `daw-out` (`DAW Out`) even when the SysEx went to `MIDI In`.**
  In a 20 s window the top two faders sent 985 CC messages, all on channel 5 (B4h).
  CC 7 (unipolar) and CC 8 (bipolar) both covered the full value range 0-127.
  No channel-5 messages reached `MIDI Out`.
- So the separate ports do not block the layout switch. The mode SysEx goes to
  `midi-out`, and the faders' input and feedback go to `daw-out` / `daw-in`.
- **Arrows still send in the fader layout, but on the DAW port.** Pressing the top-row
  arrows (CC 91-98, channel 1) produced messages on `DAW Out`, not on `MIDI Out`. The
  sequencer listens on `midi-in`, so it would see no arrow presses here. That matches
  the operator's report that the arrows did nothing in the app.
- **Pads send on the DAW port too.** Two pad presses (notes 11 and 31, channel 1) came
  from `DAW Out`. These are not yet tied to a named pad.
- **Session and mode buttons changed the layout without any logged message.** Pressing
  Session cleared the faders from view, and a mode button switched to a device custom
  mode. Neither produced a logged message on either port, so the app can't see those
  layout changes. It must not assume the fader layout persists.
- **The CC 7 bursts on `MIDI Out` came from a device custom mode, not the faders.** They
  started after the custom-mode switch, on channels 5, 7, 8, 9, 11 and 12, values 1-127.
  The first pass had none, because no custom mode was entered.
- **Answered for question 2:** in the fader layout the arrows send on `daw-out`, not
  `midi-in`. The mute pads are not present in the fader layout at all (operator
  observation: they can't be pressed there), so mixer mutes cannot work in this layout.
  Two pad notes (11 and 31) did come from `daw-out`, which is not yet explained. Fader
  feedback (question 4) is untested.
- **Side-column buttons also send on the DAW port in the fader layout.** A later pass
  logged eight presses, one per button, top to bottom: CC 89, 79, 69, 59, 49, 39, 29,
  19, on channel 1, all on `DAW Out`. No note-ons were logged in that window, so no pads
  were pressed there.
- **Switching modes without reconnecting works.** Every change in the spike ran on
  ports that stayed open: DAW mode on and off, the fader layout and Programmer again.
  The mode SysEx goes on `midi-out`, and the faders report on `daw-out`.
- **The runtime does not open the DAW ports.** `src/surface/runtime.ts` opens only
  required ports, and `daw-in`/`daw-out` are `required: false`. Faders and any
  fader-layout buttons would never be heard. The mixer mode has to open `daw-in`/`daw-out`
  when it is entered and close them on exit. Marking them required would break devices
  without a DAW port, so that's the wrong fix.
- **One profile, two modes.** The DAW surface stays in this profile, not a second one:
  one device, one identity. The mixer mode's `onEnter` sends DAW mode and the fader layout
  on `midi-out` and opens the DAW ports. `onExit` restores Programmer and closes them.
  This needs the mode hooks to send output, which they can't do today.
- **Hardware-initiated switching has to be app-driven.** Session and the mode buttons
  change the device's layout silently, so the app can't follow them. To switch from the
  hardware, use a button the app can see in both layouts. The side-column buttons (CC
  89-19) send on `daw-out` in the fader layout, as logged above. In Programmer mode they
  send on `midi-in`. So a side-column button can enter or leave the mixer.
  **Chosen: side-69**, the transport-mode select in the profile. Confirmed on hardware:
  in Programmer mode it sent seven presses as CC 69 (B0h 45h), channel 1, on `MIDI Out`
  (the `midi-in` side). In the fader layout it sent CC 69 on `DAW Out` (logged earlier).
  Both directions are seen, so this button can switch the mixer on and off.
  Caveat: side-69 is also the transport-mode select today. Making transport persistent,
  a separate issue, is what frees it for the mixer, so the two must land together.
- **Round trip confirmed on hardware** (`roundtrip.mjs` scratch script, not committed).
  Four cycles in 60 s. Side-69 on `MIDI Out` sent DAW mode on, the bank, and the fader
  layout on `MIDI In`, and the layout readback confirmed `0D`. Side-69 on `DAW Out`
  restored Programmer (`7F`, confirmed by readback) and DAW mode off (`00`, confirmed).
  In the mixer, 363 channel-5 fader messages arrived. The release of each press (value
  `00`) was ignored.
  Not checked: whether the sequencer app sees the switch through midi-core.
- **Fader LED feedback works** (operator observation).
- **Bank switching inside the mixer works.** A bank re-sent with the fader layout active
  (volume CC 7, pan CC 10 bipolar, send CC 12) reads back correctly, and the faders then
  report the new CC. No mode change or layout reselect was needed. The brief
  switch-over latency is not measured cleanly, because operator moves are mixed in.
- **Position updates on `DAW In` do not echo.** Channel 5, controller = the fader's CC,
  value 0-127. Position set A, then B, with the faders untouched: zero channel-7 messages
  on `DAW Out` in either silent window. An earlier run that logged 182 messages was the
  operator moving the faders, not an echo.
- **Position sets did not move the faders with the CC-number reading.** Operator
  observation: the faders stayed where they were. The index reading (controller = fader
  index, 0-7) was also sent, with zero echoes, but its movement is not yet observed. The
  manual gives no detail on the position set, and the faders may not be motorised at all.
  Until proven otherwise, treat a fader's physical position as unknown to the app.
- **Decision: no position feedback.** The app does not push positions to the faders. The
  fader's physical position is the only record of the level. On a page change the app
  keeps its own stored value for the new track and uses soft takeover: a fader only
  changes that value once it crosses the stored level. Until then the value stays
  unchanged. The LEDs show the state. A page change does not move the faders.
- **Requirement (operator): a page change must update the displayed level of each track.**
  This conflicts with the decision above, unless the LEDs can show a level without the
  faders moving. The manual's DAW Fader position set may do that. The earlier position
  tests were judged on physical movement only, so whether the LEDs changed is unknown.
  To check: send position sets (index reading) and watch the LEDs, not the faders.
  **Result:** the LEDs did not change with position sets (operator observation).
- **Next check: fader colour sets (channel 6, B5h, controller = fader index).** These are
  the manual's DAW Fader colour sets. Colour set A (palette 5 to 61 across the faders),
  then set B (reversed). Zero echoes. Whether the LED colours changed is an operator
  observation still to confirm. If they did, a colour step can stand in for the level.
  **Result:** the LED colours changed with the colour sets (operator observation,
  "yes"). A fader's colour can therefore show its track's level, in palette steps.
  Decision: a page change sends a colour set for the new page's levels. Palette steps
  are coarse, so the mapping and the number of steps still need choosing.
- **Level test (`levels.mjs`, scratch, not committed).** A sweep of palette indices 1 to
  121 in steps of 8, all faders the same, then a bar with fader i at palette 1 + 16i.
  Operator observation: the sweep showed **different intensities of one colour, light
  blue**. So a level can be shown as the intensity of a single hue, not a change of hue.
  Operator clarification: the sweep set the whole row of faders to the same colour, and
  each palette row is one colour family. Within a row, blue steps up in **three
  increments** to maximum intensity, then the next row starts another colour step. So each
  palette row gives about three intensity levels, and the rows are the colour families.
  Implication: a single hue gives only about three levels per row. The bar test set
  different indices per fader, so it does not answer whether a ramp reads correctly.
  Still open: how many rows are usable as one family, and whether a level scale needs
  several rows.
- **Palette scan (`palette-scan.mjs`, scratch, not committed).** All indices 1-127 shown
  eight at a time, three seconds per batch, fader i = base + i. Operator observation: in
  every batch all faders were the same colour, changing only in intensity, incrementally.
  This contradicts the three-steps-per-row reading above, unless that reading was a
  description of the same ramp. Open: is the ramp continuous across all 127 indices, or
  does it break into colour families at some point?
  **Result (operator): continuous, one colour, 127 levels.** Decision: a track's level maps
  straight onto a palette index, 1 to 127, using the blue ramp. Index 0 is avoided, since it
  switches the fader off. The earlier "three steps per row" reading is withdrawn.
- **Pan and send have no app-side meaning yet.** Track identity lives in the app, not
  the device, so paging tracks means sending new positions, not changing the bank.

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

## ECS-96 implementation (fader modes)

- **Profile.** `modes` on the device profile (`src/profile/types/mode.ts`). The Launchpad's
  `mixer-faders` mode has three fixed fader banks, each with its own CC per fader: volume
  CCs 80-87 (colour 37), pan CCs 88-95 (bipolar, colour 21), send CCs 102-109 (colour 13). Its
  DAW-port side buttons (`daw-side-89` to `daw-side-39`) are read on `daw-in`, because the device
  sends them there while a fader layout is shown.
- **Sequencer.** `createSequencerBindings(..., devices)` builds one mode per bank the application
  has a template for (`faderTemplates`, `{index}` = fader position): `faders-volume`,
  `faders-pan`, `faders-send`. Entering a bank sends DAW mode, the bank, then the layout; leaving
  sends the Programmer layout and DAW mode off. Switching banks leaves one and enters the next.
- **Availability.** A device without `daw-in`/`daw-out` gets no fader modes, and its side-59/49/69
  buttons are not bound for them.
- **Transport.** The transport mode has no button on the Launchpad (side-69 is the mixer's now).
  Its side-59 is the pan bank's button, so the transport mode does not bind it.
- **Colour echo.** Moving a fader does not repaint its colour (the ECS-57 rule). The colour follows
  only the application's changes to the level.
- **Open.** A level of 0 paints palette entry 0, which switches the fader off. The application's
  level controls should run 1-127 for a visible fader at zero. The hardware check of the full
  round trip with the app is still to do.

### Fader modes on hardware (ECS-96)

Run with `scripts/launchpad-live.mjs` on the device, using the demo's controls.

- **Entering and leaving.** Side-69 enters the volume bank from Programmer mode. The
  DAW-port side buttons switch banks (side-59 pan, side-49 send), leave to mixer (side-79)
  and steps (side-89). Re-entry after leaving works.
- **Bank messages.** DAW mode, the bank and the layout go out in order on enter, and the
  layout and DAW mode off go out on leave.
- **Faders.** Each bank reports on its own CCs: volume 80-87, pan 88-95, send 102-109, on
  channel 5. Moves arrive on the DAW port.
- **Colour feedback.** Verified on device: a fader's colour follows its level when the
  application sets it.
- **Pan exit bug (fixed).** Leaving pan failed because the DAW ports closed on each mode
  change and could not reopen. The runtime now opens the optional ports at attach and
  keeps them open until detach.
- **Not checked on the device.** The application's own values (the demo does not log
  them). Paging is not implemented.

### Fader paging (ECS-96, webseq owns paging)

- **midi-core.** The DAW-port arrows (CC 91-94) are `daw-top-91` to `daw-top-94`. In the fader
  modes, left and right go to the application as `faderActions.pageLeft` and `pageRight`. Up and
  down are not bound. The application decides which tracks the faders show, so midi-core does not
  track a page.
- **Devices.** `SequencerDevices` now carries the device's inputs as well as its outputs, so the
  arrows can be bound on the DAW port.
- **webseq.** Its registry resolves `mixer.volume.0` to `mixer.volume.7`. Fader N shows track
  `page * 8 + N`, reads 0 when the page has no track there, and sets the track's volume (linear
  gain, 0 to 1.5). A page turn notifies each fader, so its colour follows the new track. Pan and
  send have no application controls yet, so those faders are not bound.
- **Tests.** webseq: 167 pass against this midi-core checkout. midi-core: 406 pass.
- **Not done.** webseq depends on midi-core from GitHub, so it needs a push and a dependency bump
  before the app sees this. The device run of the paging is still to do.

