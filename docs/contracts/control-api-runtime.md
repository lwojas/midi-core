# Application Control API — Runtime

Status: Draft
Source of truth: [`src/control-api/control.ts`](../../src/control-api/control.ts),
[`src/control-api/action.ts`](../../src/control-api/action.ts),
[`src/control-api/registry.ts`](../../src/control-api/registry.ts),
[`src/control-api/context.ts`](../../src/control-api/context.ts),
[`src/control-api/event.ts`](../../src/control-api/event.ts)

## Scope

This is a generic, in-memory implementation of `Control`, `Action`,
`ControlRegistry`, `SurfaceContext`, and `SurfaceEventSource`. It supports
transport, track volume, step state, and playhead examples without MIDI,
device, or sequencer-specific knowledge. It is independent of the Control
Surface runtime and imports nothing from `src/core/`, `src/mapping/`,
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

**Several independent listeners.** `onChange()` adds to a `Set`,
not a single slot — proven directly in `control.test.ts`: a surface-side
listener and a UI-side listener both subscribed to the same `Control`
both fire from one `setValue()` call. Surface and UI listeners can observe
state changes directly; one subscriber's notification does not depend on
another's having run first.

## `createAction()`

As small as the contract itself: `invoke()` calls whatever callback was
supplied. No state, nothing else to implement.

## `createControlRegistry()` / `createSurfaceContext()`: the mutation methods their contracts don't name

`docs/contracts/control-api.md` specifies `ControlRegistry`'s and
`SurfaceContext`'s _read_ side only (`listControls`/`getControl`/
`onChange`, `listSelections`/`getSelection`/`onChange`) — deliberately,
since what adds a control or changes a selection is the owning
application's concern, not this contract's. A concrete implementation
still needs _something_ to do that, so `MutableControlRegistry.add()`/
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
yet," it just can't be _returned to_ once a scope has a selection. Left
as a limitation of the current `SurfaceContext` contract.

## `createSurfaceEventSource()`, and a correction to `SurfaceEventSource`

`emit()` is the implementation's own addition — reporting an occurrence
is the event source's owner's job, never the contract's. Implementation
retains nothing between calls: a listener added after an `emit()` never
sees it, matching "reports each occurrence once instead of holding a
value at all."

`SurfaceEventSource.onEvent` listeners receive `SurfaceEvent<unknown>`
so the source can report event kinds with different payload shapes. A
listener narrows on `event.id` before using `payload`; this makes the
narrowing required rather than silently treating payloads as a single
type.

## What's deliberately not here

- **No concrete `Transport`/`Track`/`Pattern` objects** — these factories
  do not wire application-specific objects together; they provide
  primitives that can support examples (`src/control-api/examples.test.ts`).
- **No automation model** — unchanged from `docs/contracts/control-api.md`'s
  own deferral; nothing here needs to know how a value changes over
  time, only that `setValue()` was called.
- **No fixed catalog of controls/actions** — same restraint the contract
  itself already states; these factories take an owner-supplied `def`,
  never assume one.
- **No `ControlRegistry`/`SurfaceContext` wiring into the Control Surface
  runtime** — `src/surface/bindings.ts` takes a `ControlRegistry` and
  `SurfaceContext` as given. Nothing here constructs a `ControlSurface`
  or calls into `src/surface/`.
