# End-to-End Device Integration Guide

Status: Draft
Linear: [ECS-93](https://linear.app/ecs3d/issue/ECS-93/use-the-launchpad-profile-as-the-gold-standard-reference-for-new)
Gold-standard example: Novation Launchpad Mini MK3 — the only device verified end to end on
real hardware (`docs/hardware-validation.md`).
Source of truth for this walkthrough's code: [`src/profile/devices/launchpad-mini-mk3.ts`](../src/profile/devices/launchpad-mini-mk3.ts),
[`src/configurations/sequencer.ts`](../src/configurations/sequencer.ts),
[`src/surface/`](../src/surface/), and `webseq/src/midi/` (sibling repo).

## Purpose

This is the map, not the territory: a short walkthrough of how one physical control on the
Launchpad ends up driving (and being driven by) `webseq`'s sequencer, naming every layer the
signal crosses and where each layer's own contract doc lives. Use it when wiring up a new
device — follow the same five steps, reusing everything midi-core already provides, and only
write new code where this guide says a device actually needs it.

Every layer below is already documented in detail elsewhere. This doc does not repeat that
detail — it tells you which doc to open next for each step, and shows the one thing those docs
can't show in isolation: the whole pipeline, with one real control's data flowing through it.

## The five layers

```
Device hardware (Launchpad Mini MK3)
     |  raw MIDI bytes
MIDI Core                 src/core/, src/adapters/web-midi/     — generic transport, no device knowledge
     |  MidiMessage
Device Profile            src/profile/devices/launchpad-mini-mk3.ts — this device's controls, addresses, feedback, setup
     |  PhysicalControl + DeviceProfile.layout/modes
Control Surface           src/surface/, src/configurations/     — profile -> ControlMapping, device roles -> app control ids
     |  Control / Action (ControlId strings, no MIDI vocabulary)
webseq (the sequencer)     webseq/src/midi/                      — the one adapter module; Project state <-> Control
     |
webseq UI / audio engine  (no MIDI or device vocabulary anywhere here)
```

Each layer talks only to its neighbors (`docs/architecture.md`, `docs/control-surface-
architecture.md`). Nothing above Control Surface knows a CC number exists; nothing below it
knows what a "track" or a "mute" is.

## Step 1 — Device Profile: describe the hardware

**Doc:** [`docs/contracts/device-profile.md`](contracts/device-profile.md) (schema) and
[`docs/contracts/launchpad-mini-mk3-profile.md`](contracts/launchpad-mini-mk3-profile.md)
(the worked example).

A `DeviceProfile` describes the device and nothing else — no application meaning. For the
Launchpad:

- **`controls`** — 81 `PhysicalControl`s. Id convention: `pad-<note>` for the 64 pads,
  `top-<cc>`/`side-<cc>` for the two button rows (e.g. `top-91`, `side-89`). Each carries
  `input` (where a press is read) and, for feedback-capable controls, `feedback` (where an LED
  colour is sent) — independent fields, since a control can be input-only, feedback-only, or
  both.
- **`feedbackPortId`** — set explicitly on every control with feedback, because the Launchpad's
  feedback travels on a different port than its input. Required by convention whenever input
  and feedback ports differ; **the profiler tool does not infer this** — it was added by hand
  on import. Omitting it silently drops feedback at generation time (see Step 3) without any
  validator catching it. This is the one gap every new profile must check for by hand.
- **`grids`** — one `pads` grid (8×8), mapping row/column to each pad's control id. A grid is
  pure layout, not a second source of addresses.
- **`setup`** — Device Inquiry (with wildcarded revision bytes), the Programmer-mode switch.
  See [`docs/contracts/device-setup.md`](contracts/device-setup.md); the surface runs these on
  every `attach()`, you never run them by hand.
- **`layout`** — the sequencer's *default* roles for this device: which controls are mode
  buttons, page arrows, transport, bank select. See
  [`docs/contracts/sequencer-configuration.md`](contracts/sequencer-configuration.md). This is
  a usage default living in the profile, not a hardware fact — an application is free to
  override it.
- **`modes`** (optional) — a device mode needing its own ports/messages (the Launchpad's DAW
  Fader mode). Not needed for a device without one.

**What to do for a new device:** run it through midi-profiler if possible (see
`docs/contracts/device-profile.md`'s `schemaVersion` note), import the evidence, then hand-fix
`feedbackPortId` wherever input and feedback ports differ. Everything downstream depends on
`controls`/`grids`/`layout` being correct — get this step right and the rest mostly falls out
for free.

## Step 2 — Control Surface: profile → `ControlMapping`s

**Doc:** [`docs/control-surface-architecture.md`](control-surface-architecture.md) (why this
layer exists), [`docs/contracts/surface-bindings.md`](contracts/surface-bindings.md) (the
binding-table shape), [`docs/contracts/surface-generation.md`](contracts/surface-generation.md)
(the generation step itself).

Control Surface is the only layer allowed to know about both a device profile and an
application control. It never re-encodes a note or CC number — it reads one from the matched
`PhysicalControl` via `toMidiSource()`/`toMidiTarget()` (`src/surface/generate.ts`) and pairs it
with a `ControlId` a `ModeBinding` names:

- `ControlBinding` — a role ("pad grid", "transport play") resolving to a `ControlId`, either
  `"static"` (always the same id) or `"from-selection"` (depends on the app's current
  `Selection`, e.g. which track a fader currently targets).
- `NavigationBinding` — a control that pages or switches mode, declaratively (`setMode`/
  `pageBy`), never a hand-written note number.
- `WindowedControlBinding` — a grid cell whose control id is templated by its virtual
  row/column (`{row}`/`{column}`), re-resolved on every page turn. This is what a step-grid pad
  uses.
- `IndicatorBinding` — feedback-only: lights a control while a numeric application control
  equals a given value (used for bank-select buttons, below).

`bindSurfaceMode()` (`src/surface/bindings.ts`) takes one mode's bindings plus live ports and a
`ControlRegistry`, generates `ControlMapping`s, and binds them with the mapping layer's own
`bindControlMapping()` (unchanged since ECS-37 — Control Surface composes it, never
reimplements the wire-level round trip). It returns one teardown that unbinds everything and
restores LEDs to a rest state on mode exit (motorized controls are left alone).

## Step 3 — Sequencer Configuration: device roles → sequencer-shaped control ids

**Doc:** [`docs/contracts/sequencer-configuration.md`](contracts/sequencer-configuration.md).

Writing a `SurfaceBindingTable` by hand, per device, would mean re-deriving "which pad is step
3 of track 2" every time. `createSequencerBindings(input, profile, contract, devices?)`
(`src/configurations/sequencer.ts`) does that once, generically: it reads the profile's
`layout`/`modes` and produces the binding table automatically, naming controls with a
`SequencerContract` the *sequencer* owns (not the device):

| Contract field | Shape | Meaning |
|---|---|---|
| `stepTemplate` | `"step.{row}.{column}"` | one boolean control per grid cell |
| `stepDurationTemplate` | `"step.{row}.{column}.duration"` | feedback-only, how many steps a note spans |
| `muteTemplate` | `"mute.{track}"` | one boolean per track row |
| `playheadControl` | `"transport.playhead"` | which virtual column is currently playing |
| `bankControl` / `bankActions` | `"bank.active"` + actions | the app's own A–D track banks (device-agnostic) |
| `faderTemplates` | `{ volume: "mixer.volume.{index}" }` | one numeric control per fader, per bank |
| `colours` | `Partial<SequencerColours>` | overrides `DEFAULT_SEQUENCER_COLOURS` (steps blue, mutes red, banks green, playhead greenish-blue/teal — ECS-150) |

This is the key decoupling point: **the sequencer never sees pads, CCs, notes or SysEx** — it
only ever names `step.2.5` or `transport.play`. Swap the Launchpad for any other profile with an
equivalent `layout`, and this layer produces an equivalent binding table with zero sequencer
changes.

## Step 4 — webseq: the one adapter boundary

**Doc:** [`docs/sequencer-integration.md`](sequencer-integration.md) (the integration report;
the live code has moved on since — see the real files below).

`webseq/src/midi/` is the *only* place in the sequencer app allowed to import midi-core or know
MIDI exists (confirmed by grep across `src/model/`, `src/components/`, `src/App.tsx` — zero
hits). Three files:

- **`controlAdapter.ts`** — bridges webseq's immutable `Project` snapshot + `dispatch()` to
  midi-core's live `Control` shape (`getValue`/`setValue`/`onChange`). `setValue()` dispatches
  a reducer action; `syncFromProject()` — called once per `Project` change from *any* source,
  not just MIDI — fires `onChange()` listeners when the derived value moved.
- **`sequencerContract.ts`** — implements `ControlRegistry` by resolving ids like
  `step.3.5`, `mute.2`, `mixer.volume.0`, `transport.playhead`, `bank.active` against the live
  `Project` on demand (no fixed list, so a sequence longer than one page needs nothing extra).
  This is where the sequencer's own concepts (a note starting at a beat, a track's volume, the
  transport's playhead) get turned into the plain `Control`s Step 3's templates name.
- **`useMidiControls.ts`** — the React hook that does the actual wiring: picks up the connected
  device via `resolveDevice()` (`midi-core/devices`), calls `createSequencerBindings()` (Step
  3) to get a binding table, then `createControlSurface({ profile, ports, bindingTable,
  registry, generate: generateControlMappings, ... })` and `surface.attach()`/`detach()`.
  `MidiPanel.tsx`, `App.tsx`, and the model package needed **zero changes** across every rewrite
  of this adapter — that boundary is the whole point.

## Visual feedback: how a `Control` ends up lighting an LED

This is the piece worth understanding on its own, since it's how webseq's sequencer *view* (not
just its audio state) ends up painted on the Launchpad's grid. Three independent signals are
composited onto one pad, in `bindStepFeedback()` (`src/surface/bindings.ts`), evaluated in this
priority order on every repaint:

1. **Playhead** (`binding.playheadColour`, greenish-blue/teal by default — ECS-150) — if this pad's virtual column
   equals the sequencer's `transport.playhead` control's current value, this always wins,
   regardless of the step underneath it. webseq computes `transport.playhead` by polling the
   same `Transport` clock the on-screen playhead already reads (`requestAnimationFrame`, not a
   subscription — a continuously-advancing position doesn't fit `Control.onChange()`'s
   "something changed" shape) and feeds it in via `pollPlayhead()`.
2. **Own step state** (`binding.colour`, blue by default) — this pad's own `step.{row}.{column}`
   boolean control, true when a note starts here. A press toggles only this control; duration
   and playhead are read-only to this cell.
3. **Duration continuation** (`binding.continuationColour`, a quarter-intensity dim of `colour`)
   — if an earlier step on this row is active and its `step.{row}.{column}.duration` control's
   value reaches this column, this pad is lit dim, reading as "still part of that earlier note."

Each of the three signals the pad depends on is re-subscribed on every navigation change (a
page turn moves which virtual row/column this physical pad currently represents), and the pad
repaints whenever any of them fires. One function owns the composite, deliberately — two
independent feedback paths racing to send the last word to the same LED is exactly the bug this
single-owner design avoids.

Two other feedback shapes reuse the same `ControlMapping`/painter machinery for the controls
that don't need a step grid's extra signals:

- **Track mutes** are the same `WindowedControlBinding`/`bindStepFeedback()` path as steps — a
  horizontal window across the grid's top row, one mute per column — just without
  `durationTemplate`/`playheadControl` set, so they take the plain "on → `colours.mutes` (red by
  default), off → dark" branch.
- **`IndicatorBinding`** — the bank-select buttons: lit (green, by default) while
  `bank.active` equals that button's own index. Feedback-only; pressing the button invokes the
  app's `bankActions` instead of writing a control.
- **Plain `Control` feedback (`painterFor()`)** — mixer faders: any feedback-capable
  `PhysicalControl` bound through an ordinary `ControlBinding` (not a toggle window) to a
  numeric `Control` repaints on `onChange()`, the same mechanism track volume has used since
  ECS-73 ("the UI is not a mediating intermediary — it's just another direct caller of
  `setValue()`").

All of this fires from the *application* side — a UI mixer-fader drag, a project load, a MIDI
pad press elsewhere, or the playhead's own clock — because feedback is wired to `Control.
onChange()`, not to "was this value just set via MIDI." That symmetry (any state change reaches
the hardware, regardless of its source) is `docs/contracts/application-surface-feedback.md`'s
whole point, and is what makes the Launchpad's grid track the sequencer's actual view instead of
echoing its own input.

## The reverse direction: a pad press reaching the project

1. Launchpad sends a Note On for `pad-34` on `midi-in`.
2. `bindActionTrigger()`/`bindToggle()` (depending on binding kind) resolves the mapping's
   `MidiSource` against the current mode's bindings and invokes the matched `Action`, or flips
   the matched `Control`.
3. For a step pad, that's the `pressAction` in `bindStepFeedback()`: `own.setValue(!own.getValue())`
   on the windowed control, which resolves (via Step 3's template) to e.g. `step.3.5`.
4. `sequencerContract.ts`'s `createStepControl().setValue()` dispatches `ADD_NOTE`/`REMOVE_NOTE`
   against the project reducer.
5. The reducer produces a new `Project`; `useMidiControls.ts`'s project-watching effect calls
   `registry.syncFromProject(project)`.
6. Every cached control's `syncFromProject()` re-reads the new project and fires `onChange()` if
   its value moved — which repaints the pad (and the UI, independently, through its own
   React state) from the same underlying change.

No step of this path knows a Launchpad exists past step 2; no step before step 2 knows a
`Project` exists.

## Checklist: wiring up a new device

1. **Profile it.** Produce or hand-write a `DeviceProfile` (`docs/contracts/device-profile.md`).
   Fix `feedbackPortId` by hand wherever input and feedback ports differ — the profiler doesn't
   catch this, and `validateDeviceProfile()` won't either (it only checks a `feedbackPortId`
   that's already present).
2. **Give it a `layout`.** Name which controls are mode buttons, page arrows, transport, and
   bank select (`docs/contracts/device-profile.md`'s `layout` field). Without this,
   `createSequencerBindings()` reports `unresolved` roles and builds only what it can.
3. **Add `setup` steps** for anything the device needs before it behaves as profiled (mode
   switches, identity checks) — `docs/contracts/device-setup.md`. Don't invent a second
   handshake mechanism; this is the only one.
4. **Register the device** in `src/devices/registry.ts` so `resolveDevice()` (webseq's
   `useMidiControls.ts`) can match it by port name, and name its DAW port pair if it has one
   (`findDawPorts`).
5. **Run `validateDeviceProfile()`** and the existing Launchpad test
   (`src/profile/devices/launchpad-mini-mk3.test.ts`) as a template for the new profile's own
   test: unique control ids, grid coverage, address/channel sanity, every feedback control
   routing to a declared port.
6. **Connect it in webseq** and check the log pane's `unresolved:` lines — each one names a
   sequencer role (`stepTemplate`, `bankControl`, a fader bank id, …) the new profile's `layout`
   doesn't cover yet.
7. **Verify on hardware.** Record what was actually confirmed vs. assumed, the way
   `docs/hardware-validation.md` does for the Launchpad — a profile that type-checks is not the
   same claim as a profile that was pressed on real hardware.

## Where the detail actually lives

| Topic | Doc |
|---|---|
| Device profile schema | `docs/contracts/device-profile.md` |
| The Launchpad profile itself | `docs/contracts/launchpad-mini-mk3-profile.md` |
| Device setup / handshake | `docs/contracts/device-setup.md` |
| MIDI ↔ control mapping contract | `docs/contracts/mapping.md`, `docs/contracts/mapping-runtime.md` |
| Application Control API | `docs/contracts/control-api.md`, `docs/contracts/control-api-runtime.md` |
| Why Control Surface exists, its boundaries | `docs/control-surface-architecture.md` |
| Binding-table shape (`ModeBinding`, etc.) | `docs/contracts/surface-bindings.md` |
| Profile → `ControlMapping` generation | `docs/contracts/surface-generation.md` |
| Surface lifecycle / `attach()`/`detach()` | `docs/contracts/surface-lifecycle-runtime.md` |
| Modes and navigation | `docs/contracts/surface-navigation.md`, `docs/contracts/mode-switching.md` |
| Application → surface feedback primitives | `docs/contracts/application-surface-feedback.md` |
| Surface → application (buttons/actions) | `docs/contracts/surface-application-control.md` |
| Device-independent sequencer roles | `docs/contracts/sequencer-configuration.md` |
| The webseq integration itself | `docs/sequencer-integration.md` |
| Hardware verification notes | `docs/hardware-validation.md` |
