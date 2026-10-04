# Validation: Minimal Surface Against a Generic Mock Device

Status: Final (validation report)
Linear: [ECS-77](https://linear.app/ecs3d/issue/ECS-77/validate-minimal-surface-against-a-generic-mock-device)
Project: [MIDI Core and Control Architecture](https://linear.app/ecs3d/project/midi-core-and-control-architecture-f934a737de3b)
Depends on: ECS-69–76 (the full Control Surface runtime, generation,
feedback, action-triggering, mode switching and lifecycle)
Source of truth: [`src/surface/validate-minimal-surface.test.ts`](../src/surface/validate-minimal-surface.test.ts)

## Purpose

Phase 3's mock-validation gate before real sequencer integration
(ECS-78) and hardware validation (ECS-79). Every piece exercised here —
`createControlSurface()`, `generateControlMappings()`,
`bindActionTrigger()`, `bindEventFeedback()`, `switchMode()`, the
generic mock surface device and its harness — already shipped in
ECS-69–76, each proven in isolation. This ticket adds **no new
production code**: it's one test
(`src/surface/validate-minimal-surface.test.ts`) building a single,
real `ControlSurface` against the real `MOCK_SURFACE_DEVICE_PROFILE`
and running it through everything the ticket asks for in one continuous
session, then recording what that confirmed.

## What was demonstrated

One `ControlSurface`, one `DeviceProfile`, one `SurfaceBindingTable`
covering three modes, attached once and cycled through all of them
before a single `detach()`:

- **Mixer: eight controls → eight track volumes.** Every one of
  `MOCK_SURFACE_DEVICE_PROFILE`'s eight knobs independently drives its
  own `track.N.volume` `Control` — turning `knob-1` never touched
  `track.8.volume`.
- **Transport: buttons → play/stop/record.** `button-1`/`button-2`/
  `button-3`, bound via `bindActionTrigger()` from `transport` mode's
  `hooks.onEnter`/`onExit` (not a declarative `ModeBinding` — see
  "Design note" below), invoke `play`/`stop`/`record` `Action`s that
  update a `transport.status` `Control`.
- **Step Grid: grid → steps, feedback ← active step state/playhead.**
  All eight pads independently drive their own `pattern.1.step.N`
  `Control`; a step `Control` set directly (not via a pad press — see
  "Finding," below) sends feedback to that pad's LED; a test-driven
  playhead tick (`SurfaceEventSource`, via `bindEventFeedback()`) lights
  the pad for the current step.
- **Mode changes reuse the same profile.** One `DeviceProfile`
  throughout; switching Mixer → Transport → Step Grid → Mixer only
  changes which `ControlId`/`Action` each physical control currently
  resolves to — confirmed by each mode's control being inert whenever a
  *different* mode is active (e.g. `knob-1` does nothing while
  `transport` or `step-grid` is active).
- **Bidirectional updates.** Both directions proven in the same session
  for the same controls — not retested from ECS-73/74 in isolation, but
  shown composing inside one real `attach()`-to-`detach()` lifecycle.
- **Lifecycle cleanup.** `attach()` connects the mock input port;
  `detach()` disconnects it and tears down whatever mode was active;
  no further input (`harness.turnKnob()` after `detach()`) reaches any
  `Control`.

## Finding: pad-press feedback is correctly suppressed as an echo

The first version of this test asserted that pressing a pad produces
immediate feedback for its own just-set step value. It doesn't — and
that's correct, not a bug. `bindControlMapping()`'s echo suppression
(ECS-57) queues every incoming-resolved value before pushing it into
the `Control`; the `onChange` it then sees matches that queued value
and is recognized as the mapping's own just-made change, not a new one
to echo back out. Pressing `pad-3` sets `pattern.1.step.3` to `true` but
sends no fresh MIDI — exactly the behavior that keeps a continuous
control from "fighting itself," now confirmed for a boolean/note pairing
too, not just the continuous case ECS-57 was originally built for.

**No contract correction needed.** The behavior is already fully
specified (`docs/contracts/mapping-runtime.md`) and already correct;
this was a test-writing mistake (asserting an echo should exist), not a
gap. Demonstrating "active step state" feedback instead sets a step's
`Control` value directly — the application-driven case ECS-73 already
established as the correct way to prove feedback reaches hardware,
confirmed here to hold for pads as it does for knobs.

## Confirmed: no MIDI/device code in application logic; no application meaning in profiles

- `createFakeSequencer()` — this validation's entire "application" —
  imports only from `src/control-api/`. No `MidiMessage`, no
  `PhysicalControl`, no port, no channel/CC/note number appears
  anywhere in it. The only place MIDI vocabulary exists in this test is
  the binding-table construction (clearly surface-layer) and the
  harness (clearly test/MIDI-side tooling).
- `MOCK_SURFACE_DEVICE_PROFILE` (ECS-71) already carries no `ControlId`,
  no `Action` reference, no application meaning of any kind — its own
  test (`mock-surface-profile.test.ts`) already confirmed this; nothing
  this ticket did required revisiting it.

## No further corrections

Two contract corrections surfaced during ECS-69–76
(`SurfaceEventSource.onEvent`'s `SurfaceEvent<unknown>` widening, ECS-70;
`MOCK_SURFACE_DEVICE_PROFILE`'s knobs gaining CC feedback, ECS-73) —
both already resolved what this end-to-end run needed. Running
everything together surfaced no new one.

## Design note: action/event bindings via mode hooks, not a new `ModeBinding` kind

`transport` mode's button-to-`Action` wiring and `step-grid`'s playhead
feedback both install through `hooks.onEnter`/`onExit`, closing over the
live `MidiInput`/`MidiOutput`/`Action`/`SurfaceEventSource` from the
test's own outer scope (the hooks themselves take no arguments —
`docs/contracts/surface-bindings.md`). This is exactly the escape valve
ECS-68 named ("a declarative binding has no field for") rather than a
new `ModeBinding` kind: `bindActionTrigger()` (ECS-74) and
`bindEventFeedback()` (ECS-73) were both deliberately kept standalone,
outside the declarative binding table, and this validation didn't need
to change that — it only needed a place to install/tear them down in
step with a mode's own lifecycle, which the existing hooks already
provide.

## What's deliberately not here

- **No new production code** — every function this test calls already
  shipped in ECS-69–76; see each one's own doc for its design
  rationale.
- **No real sequencer, no real hardware** — that's ECS-78/79,
  explicitly next after this gate.
- **No chase-light sequencing** (unlighting the previous step, pattern
  length, loop wraparound) — unchanged deferral from
  `docs/contracts/application-surface-feedback.md`; one hardcoded tick
  is sufficient to prove the wiring.
