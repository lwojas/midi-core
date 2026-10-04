# Application Control API — Runtime

Status: Draft
Linear: [ECS-70](https://linear.app/ecs3d/issue/ECS-70/implement-application-contextstate-interface)
Project: [MIDI Core and Control Architecture](https://linear.app/ecs3d/project/midi-core-and-control-architecture-f934a737de3b)
Depends on: [docs/contracts/control-api.md](./control-api.md) (ECS-34/35/65)
Source of truth: [`src/control-api/control.ts`](../../src/control-api/control.ts),
[`src/control-api/action.ts`](../../src/control-api/action.ts),
[`src/control-api/registry.ts`](../../src/control-api/registry.ts),
[`src/control-api/context.ts`](../../src/control-api/context.ts),
[`src/control-api/event.ts`](../../src/control-api/event.ts)

## Scope

`docs/contracts/control-api.md` defined `Control`/`Action`/
`ControlRegistry`/`SurfaceContext`/`SurfaceEventSource` as pure
contracts and said so explicitly: "no concrete `Control`... backed by
real sequencer state." This ticket is that implementation — generic,
in-memory, usable for the proof's own required examples (transport,
track volume, step state, playhead) without any MIDI, device, or
sequencer-specific knowledge, and independent of the Control Surface
runtime (ECS-69): nothing here imports from `src/core/`, `src/mapping/`,
`src/profile/`, or `src/surface/`.

## `createControl()`

The one piece of real enforcement this layer adds: `setValue()` throws
when `isValidControlValue(def, value)` is false, since that function
"validates; it does not clamp or coerce" — something has to be the place
that actually rejects a bad write, and this is it, the same stance
`MidiOutput.send()` already takes for an out-of-range `MidiMessage`
(throw synchronously; it's the caller's own data).

`setValue()` with the control's current value is a no-op — no `onChange`
fires — mirroring `isValidSurfaceTransition()`'s "a state never
transitions to itself" and `createSurfaceNavigation()`'s identical choice
(`docs/contracts/surface-runtime.md`): nothing changed, so nothing to
observe.

**Several independent listeners, not one.** `onChange()` adds to a `Set`,
not a single slot — proven directly in `control.test.ts`: a surface-side
listener and a UI-side listener both subscribed to the same `Control`
both fire from one `setValue()` call. This is the concrete shape behind
the ticket's "state changes from UI or other sources must be observable
directly by the surface; the UI is not a feedback intermediary" —
there's no step in `createControl()` where one subscriber's notification
depends on another's having run first.

## `createAction()`

As small as the contract itself: `invoke()` calls whatever callback was
supplied. No state, nothing else to implement.

## `createControlRegistry()` / `createSurfaceContext()`: the mutation methods their contracts don't name

`docs/contracts/control-api.md` specifies `ControlRegistry`'s and
`SurfaceContext`'s *read* side only (`listControls`/`getControl`/
`onChange`, `listSelections`/`getSelection`/`onChange`) — deliberately,
since what adds a control or changes a selection is the owning
application's concern, not this contract's. A concrete implementation
still needs *something* to do that, so `MutableControlRegistry.add()`/
`.remove()` and `MutableSurfaceContext.setSelection()` exist as this
implementation's own additions beyond their interfaces — the same way
`MockMidiOutput.simulateSendFailures()` already adds test-only surface
beyond `RawMidiOutput`.

**No `clearSelection()`.** `SurfaceContext.onChange`'s listener signature
— `(selection: Selection) => void` — has no way to report "scope X no
longer has a selection," only ever a new one. A method that mutates state
in a way its own contract's notification can't represent would be
exactly the kind of invented behavior this project avoids elsewhere;
`getSelection()` returning `undefined` already covers "nothing selected
yet," it just can't be *returned to* once a scope has a selection. Left
as a gap in `docs/contracts/control-api.md` (ECS-65) for a future ticket
to close, not worked around here.

## `createSurfaceEventSource()`, and a correction to `SurfaceEventSource`

`emit()` is the implementation's own addition — reporting an occurrence
is the event source's owner's job, never the contract's. Implementation
retains nothing between calls: a listener added after an `emit()` never
sees it, matching "reports each occurrence once instead of holding a
value at all."

**Correction found while implementing this (ECS-70):**
`SurfaceEventSource.onEvent`'s listener was typed `(event: SurfaceEvent)
=> void` — the bare `SurfaceEvent`, defaulting its `P` to `undefined`.
That couldn't actually type either payload-bearing example
`docs/contracts/control-api.md`'s own table names ("Step firing...
payload `{ step: 3 }`", "Playhead advancing... payload `{ step: 3 }`")
— writing `createSurfaceEventSource()` against the contract as shipped
made this concrete rather than theoretical. Widened to `SurfaceEvent<unknown>`
in both `src/control-api/types/event.ts` and the doc: a `SurfaceEventSource`
was already understood to report more than one kind of event (a chase
light and a tick share one source type but different `payload` shapes),
so a listener narrowing on `event.id` to know what `payload` is was
already the expected pattern — `unknown` just makes that narrowing
required instead of silently impossible.

## What's deliberately not here

- **No concrete `Transport`/`Track`/`Pattern` objects** — no application
  specifically named "the transport" or "a track," wired together from
  these factories. That's ECS-71 (generic mock device) and ECS-77/78
  (validation against it, sequencer integration); this ticket only
  proves the factories are *sufficient* for those examples
  (`src/control-api/examples.test.ts`), not that it builds them for real.
- **No automation model** — unchanged from `docs/contracts/control-api.md`'s
  own deferral; nothing here needs to know how a value changes over
  time, only that `setValue()` was called.
- **No fixed catalog of controls/actions** — same restraint the contract
  itself already states; these factories take an owner-supplied `def`,
  never assume one.
- **No `ControlRegistry`/`SurfaceContext` wiring into the Control Surface
  runtime** — `src/surface/bindings.ts` (ECS-69) already takes a
  `ControlRegistry` and `SurfaceContext` as given; this ticket supplies
  concrete ones that satisfy those parameter types, but nothing here
  constructs a `ControlSurface` or calls into `src/surface/`.
