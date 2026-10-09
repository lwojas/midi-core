# Hardware Validation: Ableton Push 1 (Mk1) with the Surface Runtime

Status: Final
Linear: [ECS-91](https://linear.app/ecs3d/issue/ECS-91/add-a-second-device-profile-to-test-the-device-independent-sequencer)
Device profile: [`src/profile/devices/push-mk1.ts`](../src/profile/devices/push-mk1.ts)
Research/evidence: `research/push-mk1/midi-usermode-mapping-verified.md` (midi-profiler repo) — the canonical
reference, checked against the independent `AbletonPushUserModeHack.png` diagram; supersedes
`midi-usermode-mapping.md`'s original button-label claims, parts of which were conflated with the Push 2 layout
Source of truth: [`demo/push-mk1-surface.js`](../demo/push-mk1-surface.js), [`scripts/push-mk1-live.mjs`](../scripts/push-mk1-live.mjs),
[`scripts/push-mk1-led-level-probe.mjs`](../scripts/push-mk1-led-level-probe.mjs) (ECS-145),
[`scripts/push-mk1-pad-color-probe.mjs`](../scripts/push-mk1-pad-color-probe.mjs) (ECS-150)

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

## ECS-138: mixer mode removed, mute moved to the upper control row (2026-10-09)

**Decision, confirmed hands-on on this unit (2026-10-09).** The dedicated `mixer` mode (`Session`,
CC 51) previously took over the entire pad grid to show mute — a worse trade on this device than on the Launchpad,
which has nothing equivalent to Push mk1's upper control row (CC 102-109, directly above the pads). `Session` no
longer selects a mode; it's free, the same "left unresolved rather than guessed at" treatment `transport.stop`/
`transport.clear` already got in this profile. Mute moved onto the upper control row instead
(`PUSH_MK1_MUTE_STRIP_GRID`, `layout.dedicatedMuteGridId`): live in `steps` and `transport` at once, no mode switch,
no lost grid, sharing the step grid's own up/down track-paging offset so the two scroll together automatically. The
generic `mixer` `SurfaceModeDefinition` `createSequencerBindings` always builds is untouched — it's simply
unreachable on this device now, the same way an unresolved mode/page/transport role already works elsewhere in
this layout; the Launchpad still reaches its own `mixer` mode from `side-79`, unaffected.

`button-note` (steps) and `button-stop-clip` (transport) also opted into `indicator: true`: their own LED now
lights while their own mode is active, reusing the exact `monochrome-led`/CC feedback shape every utility button on
this profile already sends (and the shape ECS-114's bank indicators already proved correct on hardware, for the
Launchpad).

**Outgoing LED writes can't be mistaken for presses, by construction, not by convention.** `button-note`/
`button-stop-clip`/the mute strip's own CCs all send their LED feedback on `user-port-out` while listening for a
press on `user-port-in` — two separate `MidiOutput`/`MidiInput` objects (`src/surface/bindings.ts`'s `painter.paint()`
calls `output.send()`; nothing anywhere feeds a sent message back into `input.onMessage()`). This was true of every
existing feedback-bearing control on this profile already (every pad, every utility button); ECS-138 adds two more
controls to the same already-correct wiring, not a new code path that could get it wrong. Confirmed by reading the
code, not by a hardware loopback test — this device's own User Mode has no documented local MIDI-echo behavior
either (`PUSH_MK1_SYSEX`'s notes), so there's no device-side mechanism this profile knows of that could loop a sent
LED byte back as a received press.

**Hardware check, both behaviors (2026-10-09).** Confirmed on a real Push mk1: `button-note`/`button-stop-clip`
light correctly as `steps`/`transport` are entered and left, matching the surface's actual active mode; the upper
control row (CC 102-109) correctly lights and toggles a track's mute, live in `steps` without a mode switch. The
automated transition/state-feedback tests (`src/surface/bindings.test.ts`, `src/configurations/sequencer.test.ts`,
`src/profile/devices/push-mk1.test.ts`) already covered the binding logic; this closes the one remaining gap
between "the code sends the byte we expect" and "the device does what we expect when it receives that byte."

## ECS-146: transport mode button removed, Play/Stop/Record bound everywhere (2026-10-09)

**Decision.** `button-stop-clip` (CC 29) used to be the Push mk1's only way to *reach* the `transport` mode — the
one mode where Play/Record's bindings existed — so pressing Play meant giving up the steps/mixer grid first, and
Stop itself was never wired to `contract.actions.stop` at all (it only switched modes). `button-stop-clip` is now
`layout.transport.stop` instead: a plain transport control, alongside `button-play`/`button-record`, that
`createSequencerBindings`' generalized transport-binding mechanism (ECS-146) binds in every mode this profile has
(`steps`, `mixer`), with no mode switch required. No button on this profile names `transport` any more — it's
simply unreachable, the same way `mixer` already is since ECS-138. **This supersedes the ECS-138 entry above**
where `button-stop-clip` opted into `indicator: true` as the `transport` mode's own button: that mode-button role,
and its LED feedback, are gone along with the mode switch.

**Hardware check (2026-10-09), via webseq rather than the raw `scripts/push-mk1-live.mjs` demo.** The live script
gives no useful visual signal here — `bindActionTrigger` never sends LED feedback for an `Action`, so Play/Stop/
Record stay unlit on the device whether or not the binding is correct, which isn't a failure mode, just an
uninformative one. Confirmed instead against the real app: **Play and Stop both fire correctly from webseq, with
no mode switch needed.** Record was not separately exercised on hardware (no change to its own binding; it was
already a plain transport control, untouched by this ticket). The automated tests
(`src/configurations/sequencer.test.ts`, `src/configurations/sequencer-faders.test.ts`) already cover the
generalized binding/exclusivity logic itself; this closes the "device does what the code expects" gap for Play/Stop.

## ECS-147: step-duration continuation feedback restored across a page boundary (2026-10-09)

**Bug.** Paging to the next set of steps, a long note whose active step was on the page just left
no longer showed its remaining span as a dimly-illuminated continuation pad on the new page — the
pads it should still cover looked simply inactive, as if the note ended at the page boundary. Root
cause: `bindStepFeedback()`'s predecessor scan in `src/surface/bindings.ts` was bounded to physical
columns `[0, cell.column-1]` on the current page only — a duration whose owning step had scrolled
onto an earlier, now-unpaged page could never be found. This was shared code (ECS-127), so it
affected the Launchpad too, not just Push mk1.

**Fix, in two rounds.** The first version (commit `adc019d`) let the scan's physical-column argument
go negative, reaching back exactly one page boundary (`grid.paging.columns` worth of virtual
columns). Real-hardware testing on this unit with a genuine two-bar note found that undershoots: its
continuation pads went dark again on the *second* page back, since that page is two page turns from
the originating step and the scan could only reach one. Commit `c08d189` replaced the one-page bound
with the duration control's own declared `max` — no duration can ever be set past it, so nothing
further away could ever cover a cell regardless of its value, which is both necessary and sufficient
rather than a guessed distance.

**Hardware check (2026-10-09), via webseq.** Confirmed on a real Push mk1: a note whose duration
spans two full page turns shows its continuation colour correctly on both the immediately following
page and the one after that, matching the fix's two commits in order — the first round's fix (one
page back) was insufficient and this second round (bounded by the duration's own `max`) corrected
it. `sequencer-step-feedback.test.ts` carries two new regression tests: one duration crossing a
single page boundary, one crossing two.

## ECS-145: monochrome button LEDs get a dim/full two-tier, confirmed on hardware (2026-10-09)

**Research first, per the ticket's own instruction.** Neither `midi-usermode-mapping.md`/`-verified.md` nor
`VERIFICATION.md` (midi-profiler repo) document anything beyond on/off for this device's CC-addressed monochrome
utility buttons -- only the 64-pad RGB velocity-color table has documented brightness tiers, and even that only
hands-on confirmed for "standard" brightness. A web search for a Push 1 (not Push 2 -- Push 2's LED protocol is
fully, officially documented and is a different device) User Mode button-LED byte table came up empty: Ableton
never published one for Push 1, and the community references found (Sonic Pi forum, Julien Bayle's site, the
various Push *2* Python/node wrappers) either explicitly say "no standard, device-specific" or only cover Push 2.
The ticket's premise -- don't assume a dim tier exists, confirm on real hardware -- held: there was genuinely
nothing to find, so the value had to come from the device itself.

**Hands-on probe, by hand, one value at a time** (`scripts/push-mk1-led-level-probe.mjs`, new for this ticket --
same "identify a control via its own feedback, let a human read the real LED" technique
`docs/hardware-verification-methodology.md` already names, except here the probe drives the *LED* and a human
reads it, rather than the probe reading a press). Stepped the raw CC value by hand against three different
physical buttons:

| CC | Button | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7-127 |
|---|---|---|---|---|---|---|---|---|---|
| 85 | Play | off | dim, steady | dim, slow blink | dim, fast blink | full, steady | full, slow blink | full, fast blink | full, steady (clamped) |
| 49 | Shift | off | dim, steady | dim, slow blink | dim, fast blink | full, steady | (not re-checked past 4) | | |
| 102 | Upper row button 1 ("mute strip") | -- | **white** | brighter white | brighter still | bright white | bright red | red | orange/yellow/green/pink/turquoise at higher values |

**Finding 1: a real dim tier exists, confirmed identically on two independent monochrome buttons.** Play (CC 85)
and Shift (CC 49) -- different physical buttons, different functions -- both show the exact same four-value
pattern: `0`=off, `1`=dim/steady, `2`-`3`=dim/blinking (increasingly fast), `4`=full/steady, `5`-`6`=full/blinking,
`7` and up clamp to full/steady (`40`, `50`, `127` all read identically to `4` on CC 85). Only the two steady
states are used by this ticket -- blinking is a real device capability with no modeled feedback level to use it
for, left alone rather than invented a use for. `PUSH_MK1_DIM_VALUE = 1` in `push-mk1.ts`, applied to every control
in `PUSH_MK1_UTILITY_BUTTONS` (confirmed on 2 of 31; the rest assumed from the same CC-addressed monochrome-button
component family, the same "declare the fact, flag the unconfirmed extent" stance this profile already takes for
its encoders).

**Finding 2, a real research correction: the mute strip (CC 102-109) is not a monochrome button at all.** Probing
CC 102 the same way showed a value-selected *colour* -- white, orange, red, yellow, green, pink, turquoise at
different raw values -- not a brightness ramp. This row was declared `monochrome-led` in the profile only because
the original `UTILITY_BUTTONS` loop blanket-applied that feedback kind to every CC-addressed button; it had never
been individually checked before this ticket. It's actually the same `velocity-color-led` family the 64 pads
already declare. Per the ticket's own scoping ("pads['] own bright/standard/dim RGB tiers are a separate,
already-flagged gap [ECS-135], not this ticket's"), the mute strip turns out to belong to that excluded family
too -- giving it a `dimValue` would mean picking an arbitrary colour and calling it "dim," not declaring a
confirmed brightness fact. Moved to its own `PUSH_MK1_MUTE_STRIP_BUTTONS` export, `velocity-color-led`,
`paletteSize: 128`, no `dimValue` -- same shape as `PUSH_MK1_PADS`. **This also means the ticket's acceptance
line "applies to... the mute strip" doesn't hold as written**: the mute strip is excluded from this ticket's dim/
full extension, for the same reason the pads already are, not merely unimplemented.

**Shift (CC 49) also gained real LED feedback for the first time.** It had `feedback` declared on its
`PhysicalControl` since this profile's first version, but nothing ever bound it to send anything --
`bindModifierState()` (`src/surface/bindings.ts`) only ever tracked its held/released state for `when`-conditional
dispatch, never lit it. `PUSH_MK1_LAYOUT.modifier: "button-shift"` is new (ECS-145); `bindModifierState()` now also
paints dim/full from that same held state when the modifier control resolves a feedback target and output, purely
additive -- a profile with a modifier but no feedback declared on it (or none declared at all, every profile
before this field existed) behaves exactly as before.

**Not independently re-hardware-checked: the mode indicator (`button-note`, CC 50).** The ticket named it as one
of three representative controls; time was spent instead confirming the dim *value* itself (the genuinely unknown
fact) on two buttons plus the mute-strip correction. `button-note` gets the same `monochrome-led`/`dimValue: 1`
treatment as every other `UTILITY_BUTTONS` entry, assumed from the same confirmed component family, not
individually turned on this unit. In practice its dim state is rarely visible today regardless: `steps` is the
only reachable mode on this profile (ECS-138/146 removed `mixer`/`transport`), so its `ModeIndicatorBinding`
almost always evaluates active (full), not dim.

## ECS-150: the playhead's colour, confirmed on a real pad (2026-10-10)

**No published or previously-confirmed velocity-to-colour byte table exists for this device's pads.** ECS-145's own
research already looked for one (Ableton never published it for Push 1; the only community references found cover
Push 2, a different protocol) and came up empty; the one prior hands-on data point (ECS-145's mute-strip probe,
CC 102) only confirmed a qualitative ramp — "orange/yellow/green/pink/turquoise at higher values" — not an exact
byte for a specific hue, and on a different control family (CC-addressed, not note-addressed) besides.

**Hands-on probe, by hand, one value at a time** (`scripts/push-mk1-pad-color-probe.mjs`, new for this ticket — the
note-addressed sibling of ECS-145's `push-mk1-led-level-probe.mjs`, needed because the pads send/receive note-on,
not control-change). Driving pad note 36 (bottom-left pad) and stepping the raw velocity by hand reproduced the
same ramp family ECS-145 already saw on the mute strip — off, then dim white, then brighter white shades, then
red — confirming the pads are the same `velocity-color-led` component family the mute strip belongs to, not an
independently-behaving control. **Raw velocity 36 shows a clear greenish-blue/teal on the pad**, hands-on confirmed
on this unit.

That one (colour, velocity) correspondence is now declared on `PUSH_MK1_PADS`' `feedback.colourPalette`
(`PUSH_MK1_PAD_COLOUR_PALETTE` in `push-mk1.ts`), matched exactly against `DEFAULT_SEQUENCER_COLOURS.playhead`
(`src/configurations/sequencer.ts`), which this ticket also recoloured from white to the same greenish-blue/teal
triplet. `buildFeedbackMessage()` (`src/mapping/value.ts`) now resolves a note-addressed target's `colourPalette`
before falling back to its existing plain on/off behaviour — additive and opt-in, same as `dimValue`/`rgbPrefix`
already are: every other colour (steps blue, mutes red, banks green) has no palette entry, so it keeps rendering as
plain on/off on this device, unchanged.

**Not covered, deliberately out of this ticket's scope**: the pads' full bright/standard/dim RGB tiers remain
ECS-135's own gap, not reopened here — this ticket adds exactly one confirmed colour (the playhead's), not a
general RGB-to-velocity encoding.

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
- (ECS-145) 29 of 31 `UTILITY_BUTTONS` entries' dim value — confirmed on
  Play (CC 85) and Shift (CC 49) only; assumed, not individually turned,
  for the rest of the monochrome-button family, including the mode
  indicator (`button-note`, CC 50) the ticket specifically asked for
- (ECS-145) whether the blink states (CC values 2/3/5/6) are worth a
  third/fourth feedback level for a future ticket — real and confirmed,
  just unused: nothing in this contract models "blinking" today
