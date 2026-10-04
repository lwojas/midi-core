# Application → Surface Feedback

Status: Draft
Linear: [ECS-73](https://linear.app/ecs3d/issue/ECS-73/implement-application-surface-feedback)
Project: [MIDI Core and Control Architecture](https://linear.app/ecs3d/project/midi-core-and-control-architecture-f934a737de3b)
Depends on: [docs/contracts/surface-generation.md](./surface-generation.md) (ECS-72),
[docs/contracts/surface-runtime.md](./surface-runtime.md) (ECS-69),
[docs/contracts/mapping-runtime.md](./mapping-runtime.md) (ECS-37/57),
[docs/contracts/mock-surface-device.md](./mock-surface-device.md) (ECS-71)
Source of truth: [`src/surface/event-feedback.ts`](../../src/surface/event-feedback.ts),
[`src/surface/application-feedback.test.ts`](../../src/surface/application-feedback.test.ts)

## Scope

With ECS-69 (runtime) and ECS-72 (generation) in place, the Control →
MIDI direction already works: `bindControlMapping()` (ECS-37/57) has
subscribed to `Control.onChange()` since before Control Surface existed.
This ticket is the demonstration the project's own description asks
for — "demonstrate independent UI/application changes reaching physical
feedback, including track volume, transport, active steps and
playhead" — plus the one piece that direction was actually missing:
nothing before this ticket turned a `SurfaceEventSource`'s occurrences
(a step trigger, a playhead tick) into outgoing MIDI at all.

## Track volume, transport status, active steps: already wired, now demonstrated

`src/surface/application-feedback.test.ts`'s first test binds three
`Control`s — a numeric volume, an enum transport status, and a boolean
step — to three feedback-capable `PhysicalControl`s on the generic mock
surface device (ECS-71), via the same `bindSurfaceMode()` +
`generateControlMappings()` path ECS-69/72 already built. Each is
changed by calling `setValue()` directly — never through the mock
device's input side — and feedback reaches the device regardless,
because `bindControlMapping()` subscribes to `onChange()` directly: **the
UI is not a mediating intermediary**, it's just another direct caller of
`setValue()`, the same as a MIDI-input-driven call would be.

**Any feedback-capable `PhysicalControl` may stand in for any
application role.** The mock device's `knob-2` plays "transport status
indicator" in this demonstration purely because the binding table says
so — `docs/control-surface-architecture.md` already drew this line
("Control Surface is where a physical control is first assigned
application meaning — never earlier"); nothing about `knob-2` makes it a
transport indicator except this test's own binding.

### Correction found here: numeric/enum feedback needs a CC target, not a note one

Demonstrating *numeric or enum* feedback surfaced a real gap:
`docs/contracts/mapping.md`'s own source/target table pairs a `"note"`
address with a boolean control only — exactly what the mock device's
pads already were, and exactly why track volume/transport status
couldn't reach feedback through them. **Fix:** `MOCK_SURFACE_DEVICE_PROFILE`'s
knobs (`docs/contracts/mock-surface-device.md`, ECS-71) now carry CC
feedback on the same controller/channel as their input — modeling a
motorized fader or LED-ring encoder, a real and common device
convention — rather than this ticket inventing a workaround mapping or
widening `mapping.md`'s table. Same "found a concrete gap, made the
narrowest correction, documented it" pattern ECS-62 and ECS-70 already
set.

## `bindEventFeedback()`: the piece that was missing

`docs/contracts/control-api.md`'s own "Feedback" section already said
`Control.onChange()` and `SurfaceEventSource.onEvent()` are "both
read-only subscriptions a mapping or Control Surface layer drives
outgoing MIDI from" — but nothing before this ticket actually wired the
second one. `bindEventFeedback(source, encode, output)`
(`src/surface/event-feedback.ts`) is the minimal counterpart to
`bindControlMapping()`'s Control → MIDI half: every event `source`
reports is passed to `encode`, and a defined result is sent through
`output`. No echo suppression — an event has no "value I just set" to
echo back, so ECS-57's queue-matching problem simply doesn't exist for
this direction.

`src/surface/application-feedback.test.ts`'s second test demonstrates
the ticket's "playhead" requirement with it directly: a
`SurfaceEventSource` emits `transport.tick` events; `encode` matches on
`event.payload.step` and, for the step whose pad this binding lights,
builds a note-on using `toMidiTarget()` (exported from
`src/surface/generate.ts`, ECS-72 — the same address translation, not a
second one) against that pad's declared feedback address.

## What's deliberately not here

- **No declarative event-feedback binding** — `bindEventFeedback()` is a
  standalone primitive, not a new `ModeBinding` kind wired through
  `SurfaceBindingTable`/`bindSurfaceMode()`. `docs/contracts/surface-
  bindings.md` (ECS-68) scoped `ModeBinding` to `ControlBinding`/
  `NavigationBinding`; adding a third, event-driven kind is a new
  decision for whichever ticket first needs playhead feedback driven
  declaratively (ECS-77 or later), not invented here to keep this
  ticket's scope to what it was asked to demonstrate.
- **No transport button feedback** — buttons stay input-only; nothing
  in this ticket's required proof set (track volume, transport
  *status*, active steps, playhead) needed a button LED, so none was
  added.
- **No chase-light sequencing logic** (which step is "active," pattern
  length, loop wraparound) — `application-feedback.test.ts` proves the
  wiring with one hardcoded step; computing which step is current is
  sequencer logic, out of scope for this layer entirely.
- **No incoming-MIDI-to-event path** — `SurfaceEventSource` is
  application-originated only (`docs/contracts/control-api.md`); nothing
  here adds a reverse direction, since no concrete case has needed one.
