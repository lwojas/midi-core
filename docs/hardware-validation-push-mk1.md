# Hardware Validation: Ableton Push 1 (Mk1) with the Surface Runtime

Status: Final
Linear: [ECS-91](https://linear.app/ecs3d/issue/ECS-91/add-a-second-device-profile-to-test-the-device-independent-sequencer)
Device profile: [`src/profile/devices/push-mk1.ts`](../src/profile/devices/push-mk1.ts)
Research/evidence: `research/push-mk1/` (midi-profiler repo)
Source of truth: [`demo/push-mk1-surface.js`](../demo/push-mk1-surface.js), [`scripts/push-mk1-live.mjs`](../scripts/push-mk1-live.mjs)

## Purpose

ECS-91's own scope: a second real device, run through the same role-based
configuration path (ECS-90) as the Launchpad, to show the path is actually
device-independent — not just that it type-checks. This is that check, run
with the same Node live-run pattern `docs/hardware-validation.md` used for
the Launchpad (`@julusian/midi`/CoreMIDI behind midi-core's own
`RawMidiInput`/`RawMidiOutput` seam).

## How it was run

```sh
npm run build
node scripts/push-mk1-live.mjs <seconds> [steps|mixer|transport]
```

Device must already be in User Mode (physical User button held) before
connecting — this profile has no `setup`, since no verified mode-forcing
handshake exists for it (see `push-mk1.ts`'s own doc comment).

## A real finding, not hidden: the first layout was wrong

The profile's first `layout` used CC 58/59 for the Note/Session mode-switch
buttons (from midi-profiler's research doc). The first live run showed Play
decoding fine as raw input but never reaching the app — nothing had a
button assigned to reach `"transport"` mode at all (a real gap: `Stop Clip`,
CC 29, was unused and free, but hadn't been assigned the role). Fixing that
exposed the second, bigger problem: lighting CC 58 to confirm the fix
showed "Scales" printed on the button, not "Note". Re-checking every button
in that section of the research doc one at a time (light it, read what's
actually printed) found 6 of 12 wrong — see
`research/push-mk1/verification/VERIFICATION.md`'s "Round 2" section
(midi-profiler repo) for the full table. The real Note/Session pair is
CC 50/51; CC 59 is the hardcoded Live/User mode toggle, not a button at
all. The profile, registry help text and this doc all reflect the
corrected mapping.

## Results (after the correction)

| Area | Result | Evidence |
|---|---|---|
| Lifecycle | Pass | attach → attached, detach → detached, port closed cleanly |
| Feedback, app → device | Pass | LED sweep lit and cleared all 64 real pads in turn |
| Input, pads | Pass | Pad press toggled the matching `step.{row}.{column}` control and the pad's own LED lit to match |
| Paging | Pass | Arrow buttons (CC 44-47) moved the grid's virtual window (`page: first step 8` on Arrow Right) |
| Mode switching | Pass (after fix) | Stop (CC 29) → transport; Note (CC 50) → steps; Session (CC 51) → mixer |
| Transport | Pass (after fix) | Play (CC 85) → `app: transport status = playing`; Record (CC 86) → `recording` — only reachable once Stop was given the `transport` mode-button role |

## Browser validation in webseq (ECS-132)

Run against the real sequencer app in a browser, on the same Push 1 (Mk1),
using webseq's MIDI panel (device picker, Connect, Disconnect), with Web
MIDI requested with `sysex: true`. midi-core commit: `af00198` (this
profile/registry entry). Webseq commit: `6c537a4` (the fixes below are in
it). Browser/OS version and firmware were not recorded for this run.

| Check | Result | Notes |
|---|---|---|
| 1. Connection and selection | Pass | "Ableton Push" listed in the picker; selecting the User Port matched the device and showed its help text; the Live Port is not matched and shows the unsupported-device message; Connect is disabled until both the User Port's input and output are selected |
| 2. No setup errors | Pass | No `setup` on this profile; the surface reached `attached` directly with nothing to accept |
| 3. Steps mode | Pass | Pad press toggled steps in the selected pattern end-to-end through webseq's project state; rows = tracks, columns = beats; Arrow buttons (CC 44-47) paged the grid, stopping at the sequence length; pad LEDs matched step state |
| 4. Mixer mode | Pass | Session (CC 51) switched to mixer; top pad row (notes 92-99) muted tracks 1-8 with pad lights following mute state — independently pressed this session, not just inferred from the steps path |
| 5. Transport mode | Pass | Stop (CC 29) switched to transport; Play (CC 85)/Record (CC 86) triggered the app's actions; with no dedicated Stop/Clear button on the device, those stayed mouse/keyboard-only in the UI with no error |
| 6. Mode switching | Pass | Note/Session/Stop switched in every direction; the surface's mode matched what the UI showed |
| 7. Changes from the UI | Pass | A mouse-driven mute or step edit updated the Push's pad lights while connected |
| 8. Disconnect and reconnect | Pass | Disconnect released the device; reconnecting restored the steps view with project state preserved |
| 9. Edge cases | Pass | Unplug/replug mid-session and a second connect without a disconnect were both handled; one intermittent playhead-stuck observation on returning to the steps view, not reproduced again across several subsequent stop/play cycles — see below |

**W1: wrong port-id assumption broke every non-Launchpad device (fixed in
webseq).** The first connect failed with `Required port "user-port-in" was
not supplied.` `useMidiControls.connect()` keyed its `ports`/`devices` maps
with hardcoded `"midi-in"`/`"midi-out"`/`"daw-in"`/`"daw-out"` strings. That
only ever matched because the Launchpad's own profile happens to use those
exact ids — the Push mk1 profile uses `"user-port-in"`/`"user-port-out"`,
and the generic (unmatched-device) profile uses `"main-in"`/`"main-out"`, so
either would have hit the same failure. Fixed by resolving the actual port
ids from the device profile by role (`"main"`/`"daw-control"`), the same way
`createSequencerBindings` already does internally, instead of a literal
string.

**W2: a non-`Error` surface failure displayed as `[object Object]` (fixed
in webseq).** `surface.attach()` can reject with a plain `SurfaceError`
object (`{code, message, cause}`), not an `Error` instance — midi-core's own
stance is to report surface failures in their own terms, not as `Error`
subclasses. The panel's catch block did `err instanceof Error ? err.message
: String(err)`, so a `SurfaceError` rendered as `[object Object]` instead of
its actual message. Fixed by reading `.message` off either shape
(`describeThrown()`, with its own test).

**One playhead-stuck observation, not reproduced.** Once, returning to the
steps view after switching away left the on-screen (and device) playhead
stuck rather than resuming. Every subsequent stop/play cycle across the rest
of the session was clean, and it was not reproducible on demand, so it's
noted here rather than chased — not clear whether it's software (a timing
window in the playhead poll) or hardware (a dropped message), and there's
nothing to act on from a single, non-reproducing occurrence.

## What's still unverified

- Encoders 2-8 and the Master Encoder (only Encoder 1, Tempo, Swing
  independently pressed)
- The remaining ~60 pads (grid formula confirmed at 4 points, not
  exhaustively)
- CC 113, CC 116, and a block of paired buttons right of the pad grid
  (roughly CC 48-57, 60-63) — likely where the real Mute/Solo/Clip-
  equivalent buttons actually live, since the doc's claims for those CCs
  (49/50/112) turned out to belong to different buttons entirely
- CC 34/35 ("Select"/"Shift") — inherited from the same now-partly-
  discredited doc section, not re-checked (see
  `research/push-mk1/verification/VERIFICATION.md`)
