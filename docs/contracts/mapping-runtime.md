# MIDI ↔ Control Mapping — Runtime

Status: Draft
Linear: [ECS-37](https://linear.app/ecs3d/issue/ECS-37/implement-basic-bidirectional-mappings)
Depends on: [ECS-29](https://linear.app/ecs3d/issue/ECS-29/implement-midi-input) ([docs/contracts/input.md](./input.md)), [ECS-30](https://linear.app/ecs3d/issue/ECS-30/implement-midi-output) ([docs/contracts/output.md](./output.md)), [ECS-36](https://linear.app/ecs3d/issue/ECS-36/define-midi-control-mapping-contract) ([docs/contracts/mapping.md](./mapping.md))
Source of truth: [`src/mapping/bind.ts`](../../src/mapping/bind.ts)

## What this proves

`docs/contracts/mapping.md` (ECS-36) defined `ControlMapping` and the pure
conversion functions (`resolveIncomingValue()`, `buildFeedbackMessage()`)
but deliberately stopped short of wiring them to anything live — no code
reading a `MidiInput`, no code calling a `Control`'s `setValue()`. This
ticket is that wiring: `bindControlMapping()` proves the full round trip —
an incoming MIDI message updates an abstract `Control`, and a `Control`
value change sends MIDI back out — using only pieces that already exist.

## `bindControlMapping()`

```ts
function bindControlMapping<D extends ControlDef>(
  mapping: ControlMapping,
  input: MidiInput,
  output: MidiOutput,
  control: Control<D>,
): Unsubscribe;
```

Two independent subscriptions, matching the two directions the mapping
contract names:

- **MIDI → Control**: every message `input` delivers is passed to
  `resolveIncomingValue(message, mapping.source, control.def)`; a defined
  result is pushed into `control` via `setValue()`. A message that doesn't
  match the source, or whose kind doesn't pair with the control's kind, is
  silently ignored — the same "not every caller's concern" stance
  `resolveIncomingValue()` itself takes.
- **Control → MIDI**: only set up when `mapping.feedback` is present. Every
  `control.onChange()` is passed to
  `buildFeedbackMessage(mapping.feedback, control.def, value)`, and a
  defined result is sent through `output`. A mapping with no `feedback` is
  input-only, per `docs/contracts/mapping.md` — nothing is wired for it.

Both subscriptions are torn down together by the single `Unsubscribe`
`bindControlMapping()` returns.

## One mapping, one call

`bindControlMapping()` binds exactly one `ControlMapping` to exactly one
`Control`, mirroring `createMidiInput()`/`createMidiOutput()`'s own
per-port scope rather than introducing a batch/registry-driven API.
Binding a device's whole control layout (e.g. a future Launchpad profile's
set of `ControlMapping`s) is calling this once per mapping against
whichever `Control` a `ControlRegistry` resolves `mapping.control` to; nothing
here assumes a single input/output pair or forces mappings to be bound
together.

## No loop prevention, no device knowledge

`bindControlMapping()` does not compare an incoming-resolved value against
the control's current value before calling `setValue()`, and does not
suppress feedback for a change that originated from MIDI in the first
place — a control's `setValue()` is caller-driven by design (per
`docs/contracts/control-api.md`), and this runtime has no way to tell "this
change came from MIDI" apart from any other caller. A real device
feedback loop (e.g. sending feedback for a value that just arrived from
that same device) is exactly the kind of device-specific tuning a profile
layer (ECS-39) would own — not something to guess at generically here.

Nothing here knows what a `Control` is backed by, or what kind of device
`input`/`output` talk to. Proven against the mock device
(`src/mapping/bind.test.ts`); a real round trip against hardware (e.g. the
Launchpad Mini used to validate ECS-31) still only exercises the same
generic path — Core and the mapping layer stay unaware a Launchpad is on
the other end.

## What's deliberately not here

- **No `ControlRegistry` wiring** — `bindControlMapping()` takes a
  `Control` directly, not a `ControlId` resolved through a registry. A
  caller that wants to resolve `mapping.control` dynamically (e.g. a
  control appearing/disappearing) composes that itself; it isn't this
  ticket's concern.
- **No device profiles** — nothing here names a collection of
  `ControlMapping`s as "the mapping for a Launchpad," or knows about any
  specific controller. That's ECS-39.
- **No curves, conditions, or loop suppression** — same extension points
  `docs/contracts/mapping.md` already named as deliberately undesigned;
  this ticket implements the contract as defined, not more.
