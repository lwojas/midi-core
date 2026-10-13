# Surface → Application Control

Status: Draft
Source of truth: [`src/surface/action-binding.ts`](../../src/surface/action-binding.ts),
[`src/surface/application-control.test.ts`](../../src/surface/application-control.test.ts)

## Scope

Surface input updates application `Control` values through
`bindControlMapping()` and can invoke commands through `bindActionTrigger()`.
Application code consumes the `Control` and `Action` abstractions rather than
raw CC, Note, SysEx, or device checks.

## Control input

The tests turn a knob and press a pad on the generic mock surface device,
through `bindSurfaceMode()` and `generateControlMappings()`, then read the
result with `Control.getValue()` rather than decoding MIDI messages in
application code. MIDI vocabulary is confined to the test harness and the
surface-layer binding calls.

## `bindActionTrigger()`: the piece that was missing

`ControlMapping`/`bindControlMapping()` drive a `Control`'s persistent value.
`Action` (`docs/contracts/control-api.md`) represents commands with no value
to read back. `bindActionTrigger(input, source, action)`
(`src/surface/action-binding.ts`) invokes an action from MIDI input:

- Every message `input` delivers is resolved against `source` via
  `resolveIncomingValue()` — the **existing** conversion function,
  applied with a synthetic, never-registered `BooleanControlDef` purely
  so its already-defined press/release (note) and threshold (CC) rules
  decide "triggered" without this function re-deriving that logic a
  second time.
- `action.invoke()` fires only on the transition into `true` — a press,
  or a CC value crossing the 50% threshold upward — never on release.
  An `Action` is fire-and-forget; there is nothing to do on the matching
  "false" half of the same gesture (unlike a `Control`, where both
  halves matter).
- No feedback counterpart, and none needed: `Action` has no value to
  report back, so there's nothing for `ControlMapping.feedback` to read
  from one.

The tests bind three mock-device buttons to `play`/`stop`/`record` `Action`s
whose callbacks update a `transport.status` `Control`, and confirm a release
does not invoke the action.

## What's deliberately not here

- **No declarative action binding** — `bindActionTrigger()` is a
  standalone primitive. `ModeBinding` supports `ControlBinding` and
  `NavigationBinding`; action-triggering bindings through
  `SurfaceBindingTable`/`bindSurfaceMode()` are not defined here.
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
