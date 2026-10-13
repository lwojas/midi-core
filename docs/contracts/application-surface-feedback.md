# Application → Surface Feedback

Status: Draft
Source of truth: [`src/surface/event-feedback.ts`](../../src/surface/event-feedback.ts),
[`src/surface/application-feedback.test.ts`](../../src/surface/application-feedback.test.ts)

## Scope

`bindControlMapping()` sends feedback for `Control.onChange()` values.
`bindEventFeedback()` converts `SurfaceEventSource` events into outgoing
MIDI for momentary occurrences that are not represented by retained
control values.

## Control value feedback

`src/surface/application-feedback.test.ts`'s first test binds three
`Control`s — a numeric volume, an enum transport status, and a boolean
step — to three feedback-capable `PhysicalControl`s on the generic mock
surface device, via `bindSurfaceMode()` and `generateControlMappings()`. Each is
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

Demonstrating _numeric or enum_ feedback surfaced a real gap:
`docs/contracts/mapping.md`'s own source/target table pairs a `"note"`
address with a boolean control only — exactly what the mock device's
pads already were, and exactly why track volume/transport status
couldn't reach feedback through them. `MOCK_SURFACE_DEVICE_PROFILE`'s
knobs (`docs/contracts/mock-surface-device.md`) carry CC feedback on the
same controller/channel as their input, modeling a motorized fader or
LED-ring encoder. Numeric and enum feedback therefore use a CC target;
note addresses remain paired with boolean controls.

## `bindEventFeedback()`: the piece that was missing

`docs/contracts/control-api.md`'s own "Feedback" section already said
`Control.onChange()` and `SurfaceEventSource.onEvent()` are both
read-only subscriptions a mapping or Control Surface layer can drive
outgoing MIDI from. `bindEventFeedback(source, encode, output)`
(`src/surface/event-feedback.ts`) is the minimal counterpart to
`bindControlMapping()`'s Control → MIDI half: every event `source`
reports is passed to `encode`, and a defined result is sent through
`output`. No echo suppression is needed: an event has no "value I just
set" to echo back.

`src/surface/application-feedback.test.ts`'s second test demonstrates
the playhead feedback path with it directly: a
`SurfaceEventSource` emits `transport.tick` events; `encode` matches on
`event.payload.step` and, for the step whose pad this binding lights,
builds a note-on using `toMidiTarget()` (exported from
`src/surface/generate.ts`) against that pad's declared feedback address.

## What's deliberately not here

- **No declarative event-feedback binding** — `bindEventFeedback()` is a
  standalone primitive, not a `ModeBinding` kind wired through
  `SurfaceBindingTable`/`bindSurfaceMode()`. Playhead state is represented
  by a retained numeric control so bindings can paint its current value
  on mode entry, clear it on exit, and resume from the actual position.
  The sequencer composes playhead and duration-continuation feedback in
  `bindStepFeedback()` so one owner determines each pad's final colour.
  `bindEventFeedback()` remains appropriate for genuinely momentary
  occurrences with nothing to read back, such as a one-shot trigger flash.

- **No transport button feedback** — buttons stay input-only; the
  feedback paths described here do not require button LEDs.
- **No chase-light sequencing logic** (which step is "active," pattern
  length, loop wraparound) — `application-feedback.test.ts` proves the
  wiring with one hardcoded step; computing which step is current is
  sequencer logic, out of scope for this layer entirely.
- **No incoming-MIDI-to-event path** — `SurfaceEventSource` is
  application-originated only (`docs/contracts/control-api.md`); nothing
  here adds a reverse direction, since no concrete case has needed one.
