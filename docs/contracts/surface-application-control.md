# Surface → Application Control

Status: Draft
Linear: [ECS-74](https://linear.app/ecs3d/issue/ECS-74/implement-surface-application-control)
Project: [MIDI Core and Control Architecture](https://linear.app/ecs3d/project/midi-core-and-control-architecture-f934a737de3b)
Depends on: [docs/contracts/surface-generation.md](./surface-generation.md) (ECS-72),
[docs/contracts/surface-runtime.md](./surface-runtime.md) (ECS-69),
[docs/contracts/mapping-runtime.md](./mapping-runtime.md) (ECS-37/57),
[docs/contracts/control-api.md](./control-api.md) (`Action`, ECS-65)
Source of truth: [`src/surface/action-binding.ts`](../../src/surface/action-binding.ts),
[`src/surface/application-control.test.ts`](../../src/surface/application-control.test.ts)

## Scope

The mirror image of ECS-73. MIDI → `Control` already works —
`bindControlMapping()`'s input half has existed since ECS-37, and ECS-69/72
already compose it for a declarative `ControlBinding`. This ticket is
the demonstration the project's own description asks for — "demonstrate
volume changes, play/stop/record and step input updating application
state... through the application's own state model," "do not expose raw
CC, Note, SysEx or device checks in application code" — plus the one
piece that direction was actually missing, symmetric to ECS-73's
playhead gap: nothing before this ticket let hardware input invoke an
`Action`.

## Volume and step input: already wired, now demonstrated

`src/surface/application-control.test.ts`'s first test turns a knob and
presses a pad on the generic mock surface device (ECS-71), through the
same `bindSurfaceMode()` + `generateControlMappings()` path ECS-69/72
already built, and reads the result back from plain `Control.getValue()`
calls — never from a decoded MIDI message. Every application-side
assertion in this file is a `Control`/`Action` read; the only MIDI
vocabulary anywhere is inside `createMockSurfaceHarness()` (clearly
test-side tooling simulating hardware) and the surface-layer binding
calls themselves (`bindSurfaceMode`, `generateControlMappings`,
`bindActionTrigger`) — exactly "no raw CC/Note/SysEx/device checks in
application code."

## `bindActionTrigger()`: the piece that was missing

`ControlMapping`/`bindControlMapping()` only ever drive a `Control`'s
persistent value — there was and is no shape for "this MIDI message
invokes that command." `Action` (`docs/contracts/control-api.md`) exists
precisely for commands with no value to read back, so nothing in the
mapping contract could ever cover it. `bindActionTrigger(input, source,
action)` (`src/surface/action-binding.ts`) is the minimal counterpart:

- Every message `input` delivers is resolved against `source` via
  `resolveIncomingValue()` — the **existing** conversion function,
  applied with a synthetic, never-registered `BooleanControlDef` purely
  so its already-defined press/release (note) and threshold (CC) rules
  decide "triggered" without this function re-deriving that logic a
  second time. Per the ticket's own "reuse existing MIDI input and value
  conversion functionality."
- `action.invoke()` fires only on the transition into `true` — a press,
  or a CC value crossing the 50% threshold upward — never on release.
  An `Action` is fire-and-forget; there is nothing to do on the matching
  "false" half of the same gesture (unlike a `Control`, where both
  halves matter).
- No feedback counterpart, and none needed: `Action` has no value to
  report back, so there's nothing for `ControlMapping.feedback` to read
  from one.

`src/surface/application-control.test.ts`'s second and third tests bind
three of the mock device's buttons to `play`/`stop`/`record` `Action`s
whose callbacks update a `transport.status` `Control` — "the
application's own state model" the ticket names — and confirm a release
never invokes anything, only a press does.

## What's deliberately not here

- **No declarative action binding** — `bindActionTrigger()` is a
  standalone primitive, exactly the same scope decision ECS-73 made for
  `bindEventFeedback()`: `docs/contracts/surface-bindings.md` (ECS-68)
  scoped `ModeBinding` to `ControlBinding`/`NavigationBinding`; a third,
  action-triggering kind wired through `SurfaceBindingTable`/
  `bindSurfaceMode()` is a new decision for whichever ticket first needs
  it driven declaratively (ECS-75 or later), not invented here.
- **No debouncing, repeat-rate, or hold-to-trigger behavior** — one
  press, one `invoke()`; a device-specific repeat/hold convention is a
  real, named extension point left undesigned until a concrete device
  needs it, the same restraint `docs/contracts/mapping.md` already
  applies to curves/conditions.
- **No `ActionRegistry` wiring** — `bindActionTrigger()` takes an
  `Action` directly, mirroring `bindControlMapping()` taking a `Control`
  directly rather than a `ControlId` resolved through a registry; per
  `docs/contracts/control-api.md`, no concrete case has needed an
  `ActionRegistry` yet.
