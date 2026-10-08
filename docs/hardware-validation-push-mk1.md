# Hardware Validation: Ableton Push 1 (Mk1) with the Surface Runtime

Status: Final
Linear: [ECS-91](https://linear.app/ecs3d/issue/ECS-91/add-a-second-device-profile-to-test-the-device-independent-sequencer)
Device profile: [`src/profile/devices/push-mk1.ts`](../src/profile/devices/push-mk1.ts)
Research/evidence: `research/push-mk1/midi-usermode-mapping-verified.md` (midi-profiler repo) — the canonical
reference, checked against the independent `AbletonPushUserModeHack.png` diagram; supersedes
`midi-usermode-mapping.md`'s original button-label claims, parts of which were conflated with the Push 2 layout
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

## ECS-136 gate verification: Shift disambiguation and relative-encoder resolution (2026-10-09)

[ECS-136](https://linear.app/ecs3d/issue/ECS-136/define-minimum-midi-contract-extensions-and-review-architecture)'s
architecture proposal listed two hardware-unverified "remaining decisions"
blocking its review gate. Both resolved live on this unit, using
[`scripts/push-mk1-contract-probe.mjs`](../scripts/push-mk1-contract-probe.mjs)
(see [docs/hardware-verification-methodology.md](./hardware-verification-methodology.md)
for the reusable technique — identify a control via its own feedback, wait
for a quiet period rather than a countdown, one action per run).

**F8: `button-shift` (CC 49) is the only real Shift button; `button-select`
(CC 34) and the doc's second "Shift" (CC 35) do not exist on this unit
(fixed in the profile).** `midi-usermode-mapping.md`'s "Right Side
Navigation Pad" section (CC 34 "Select", CC 35 "Shift") was never
re-checked in Round 2 — only the "Bottom & Layout Selection Blocks" and
"Right Column Master Utilities" sections were. Lighting CC 34 and CC 35 in
turn (`shift34`/`shift35` steps) produced no visible LED anywhere on the
device, across three independent runs; lighting CC 49 reliably lit a
button that pressed back as CC 49, twice. Independent cross-check:
midi-profiler's own `AbletonPushUserModeHack.png` diagram (used to correct
the Round 2 CCs) shows the nav-pad diamond as exactly four buttons (CC
44/45/46/47, up/down/left/right) with no Select/Shift pair beside it —
consistent with the same Push-2-layout-conflation pattern Round 2 already
found and fixed in two other sections of this doc. `button-select` and
`button-shift-nav` are removed from `push-mk1.ts` (129 → 127 controls);
`button-shift` (CC 49) is the real, only Shift/modifier control.
**Independently re-confirmed** against a second, separate MIDI monitor
app (not this project's own tooling): CC 49, channel 1, `127` on press /
`0` on release.

**F9: relative encoders use signed 7-bit two's-complement deltas, confirmed
on Encoder 1 (CC 71) and independently re-confirmed on the Tempo encoder
(CC 14).** Turning clockwise produced raw CC values `1` (and occasionally
`2` on a faster turn); counter-clockwise produced `127`, `126`, `125`,
down to `124` on a faster turn — i.e. `value < 64 ? value : value - 128`,
a small signed delta per detent, not an offset-from-64 ("binary offset")
scheme centered on a resting value. A second, separate MIDI monitor app
run against the Tempo encoder (CC 14) independently reproduced the same
pattern — clockwise `1` repeated, counter-clockwise `127` repeated — and
its touch Note On/Off at A♯-2 (MIDI note 10) matches `encoder-tempo`'s
declared touch note exactly. Two of 11 encoders (different physical units
on the device, cross-checked by two independent tools) now agree; the
remaining 9 (same physical component family — see `push-mk1.ts`'s
`ENCODERS` table) are assumed, not independently confirmed, to share this
encoding. The touch strip was independently re-confirmed too: Note On/Off
at C-1 (MIDI note 12) matches `touch-strip-tap`, and a Pitch Wheel stream
settling back to `0` on release matches `touch-strip`'s `pitch-bend`
address — no change needed, both already correct in the profile.

**Two contract-level questions from ECS-136, resolved by reading code, not
hardware:**
- `NumericControlDef` (`src/control-api/types/control.ts`) already carries
  plain `min`/`max`/`step` numbers — sufficient for a relative-delta mapper
  to do `clamp(current + decode(raw), min, max)` with no new fields.
- `DeviceSysExProfile` (`src/profile/types/sysex.ts`) models no byte
  template today — only `manufacturerId`, `required`, and a free-text
  `notes` string. The LCD format lives only as prose in `push-mk1.ts`'s own
  doc comment (abbreviated `{line}`), which omits the actual line-id byte
  values and caused a real bug partway through this verification (below).
  A `DisplayDefinition.sysexTemplate` (ECS-136's Extension 3) has no
  existing structured shape to reuse — ECS-137 is designing it from
  scratch, now against a concrete, re-verified example instead of an
  abstract one.

**A bug found in the process, not hidden: the LCD line-id byte.** An
earlier version of the probe script sent line id `0x00` (reading
`push-mk1.ts`'s abbreviated `{line}` placeholder as "0-3"), which is not a
valid line id — the screen showed nothing, and was first mistaken for the
device not being in User Mode. The real values, confirmed in
`research/push-mk1/sysex-mapping.md` and independently re-confirmed
hands-on in its `VERIFICATION.md`, are `0x18`/`0x19`/`0x1a`/`0x1b` for
lines 1-4. Fixed in the script; `PUSH_MK1_SYSEX.notes`'s own text already
cited the real doc, which the bug came from not reading closely enough.

## Full Push-2-contamination audit (2026-10-09)

Prompted by F8: if one section of the original research doc was conflated
with the Push 2 layout, is anything else in this profile also
contaminated? Every control in `push-mk1.ts` was re-checked by hand
against `AbletonPushUserModeHack.png` — the one source in this whole
chain that's independently authored (Julien Bayle), not derived from or
cross-checked only against midi-profiler's own original doc. Also checked:
midi-profiler's own `midi-usermode-mapping-verified.md`, which already
supersedes the original and — without commentary — simply omits
Select/Shift entirely, independently agreeing with this pass's CC 34/35
removal.

**Result: clean.** Every encoder (CC 71-79, touch notes 0-8), the touch
strip (pitch bend + Note 12), all 64 pads (note formula), both labeled
utility-button rows (display row CC 20-27, upper control row CC 102-109),
the left-column utilities (Tap Tempo 3, Metronome 9) and modes/sequencing
buttons (Play 85 through Fixed Length 90), Master/Stop (CC 28/29),
Note/Session (CC 50/51), and the nav diamond (CC 44-47) all match the
diagram's own numbering exactly. CC 34/35 (F8, already removed) was the
only contaminated entry found anywhere in the current profile — nothing
else needed to change.

**Re-surfaced, not new: CC 48.** The diagram's unlabeled paired-button
block beside the pad grid (already flagged below as CC 48-57/60-63,
untested) includes CC 48 directly paired with the confirmed-real CC 49
Shift. Not a contamination finding — it was never claimed by the
contaminated doc section either — just worth calling out since it sits
immediately next to a control this pass did re-verify, and remains the
nearest concrete next hardware check if someone picks this back up.

## What's still unverified

- Encoders 2-8 and the Master Encoder's exact relative-encoding bytes
  (assumed identical to Encoder 1's and the Tempo encoder's confirmed
  two's-complement scheme per F9, not independently turned)
- The remaining ~60 pads (grid formula confirmed at 4 points, not
  exhaustively)
- CC 113, CC 116, and a block of paired buttons right of the pad grid
  (roughly CC 48-57, 60-63, including CC 48 paired with the confirmed
  CC 49 Shift) — likely where the real Mute/Solo/Clip-equivalent buttons
  actually live, since the doc's claims for those CCs (49/50/112) turned
  out to belong to different buttons entirely
