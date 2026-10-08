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

## What's still unverified

- Encoders 2-8 and the Master Encoder (only Encoder 1, Tempo, Swing
  independently pressed)
- The remaining ~60 pads (grid formula confirmed at 4 points, not
  exhaustively)
- CC 113, CC 116, and a block of paired buttons right of the pad grid
  (roughly CC 48-57, 60-63) — likely where the real Mute/Solo/Clip-
  equivalent buttons actually live, since the doc's claims for those CCs
  (49/50/112) turned out to belong to different buttons entirely
- Mixer mode's mute row (bound to pad-92..99) — wired identically to the
  already-proven steps path, not independently pressed this session
- CC 34/35 ("Select"/"Shift") — inherited from the same now-partly-
  discredited doc section, not re-checked (see
  `research/push-mk1/verification/VERIFICATION.md`)
