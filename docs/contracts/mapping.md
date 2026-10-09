# MIDI ↔ Control Mapping — Contract

Status: Draft
Linear: [ECS-36](https://linear.app/ecs3d/issue/ECS-36/define-midi-control-mapping-contract)
Depends on: [docs/contracts/message-model.md](./message-model.md) (ECS-28),
[docs/contracts/control-api.md](./control-api.md) (ECS-34/35)
Related: [docs/architecture.md](../architecture.md) (Mapping layer)
Source of truth: [`src/mapping/`](../../src/mapping)

## Scope

This defines the bidirectional translation between a normalized
`MidiMessage` and an application `Control`: what MIDI event drives a
control (source), what control it drives (target), which channel(s) it
listens on, how a MIDI message's native value range maps onto a control's
declared range, and how a control's value is sent back out as MIDI
(feedback). Like the contracts it depends on, this ticket produces **only
the contract** — types and pure functions, no wiring to a live
`MidiInput`/`MidiOutput`/`Control`/`ControlRegistry`, and no device
profiles.

Per `docs/architecture.md`, this is the Device/Profile/Mapping layer: it
sits between MIDI Core and the Application Control API, and is the one
piece of the system allowed to depend on both (`src/mapping/` imports from
`src/core/types/message.js` and `src/control-api/types/control.js`).
Neither Core nor the Control API knows this layer exists — Core carries
messages without assigning them meaning, and the Control API's `setValue()`
doesn't care who called it. Assigning that meaning is exactly this
contract's job.

## Source and target: `MidiAddress`

A `MidiAddress` names one place on the MIDI wire — a CC number, a note
number, or pitch bend (which needs no further field; there's one wheel per
channel). It carries no channel of its own, because source and target need
different channel rules (next section), and no notion of a control — it's
reused for both directions of a mapping:

- **`MidiSource`** (`{ address, channel }`) — what an incoming message must
  match to drive a control.
- **`MidiTarget`** (`{ address, channel }`) — where an outgoing feedback
  message is sent.

Only three address kinds are modeled: `control-change`, `note`, and
`pitch-bend`. These are the MIDI messages that function as controller
surfaces — a knob/fader, a pad/button, a wheel. Program change and the
aftertouch/real-time messages Core also models aren't controller surfaces
in the same sense, and modeling them speculatively before a concrete
mapping needs them is exactly the overengineering this ticket is scoped to
avoid. `note` addresses the press/release pair as one unit (not separate
`note-on`/`note-off` addresses), because the common case — a pad or button
driving a boolean control — needs both halves of the same gesture.

## Channel selection

`MidiSource.channel` is a `ChannelSelector`: a concrete `Channel` (`0-15`)
or `"any"`. A mapping authored once for a device commonly shouldn't care
which channel it happens to send on, so `"any"` is the common case; a
concrete channel is there for devices or layouts that multiplex several
controls' worth of meaning across channels.

`MidiTarget.channel` has no `"any"` option — it's always a concrete
`Channel`, because there's no such thing as sending feedback to "any
channel." A mapping's `feedback` target is specified independently of its
`source`, not derived from it, since feedback commonly goes out on a
different address than the one the control was changed from (e.g. a
different CC number driving an LED ring than the CC number the physical
knob sends).

## Value normalisation and ranges

A MIDI message's native value lives in a fixed range per address kind — a
CC's `value` is `0-127`, pitch bend's `value` is `0-16383` — while a
control's declared range comes from its `ControlDef` (`min`/`max` for a
number, two states for a boolean, a fixed option list for an enum).
`resolveIncomingValue()` and `buildFeedbackMessage()` convert between them
with a fixed scheme per control kind — linear scaling for a number (snapped
to `step` if declared, via the same step-grid math `isValidControlValue`
checks against, not reimplemented differently), a `>= 50%` threshold for a
boolean, and an even bucket split across the native range for an enum —
with no per-mapping override.

Not every `(source kind, control kind)` pairing is supported:

| source          | number | boolean | enum |
|-----------------|:------:|:-------:|:----:|
| control-change  |   ✓    |    ✓    |  ✓   |
| pitch-bend      |   ✓    |         |      |
| note            |        |    ✓    |      |

Control Change is MIDI's generic continuous-or-stepped controller message,
general enough to reasonably drive any of the three control kinds (a knob
with detents selecting an enum option, or crossing a threshold as a
boolean). Pitch bend is a dedicated physical gesture with a meaningful
center — it only ever means a continuous number, never a toggle or a
selector. A note press/release is inherently a discrete event — it only
ever means a boolean. A pairing outside this table (e.g. pitch bend onto a
boolean control) isn't a case this contract models; resolving one returns
`undefined` rather than throwing, the same choice `decodeMidiMessage` makes
for wire input it can't interpret — a misconfigured mapping (authored by a
future device-profile layer, or by hand) shouldn't be able to take down a
live input handler.

## `ControlMapping`

```ts
interface ControlMapping {
  readonly id: string;
  readonly control: ControlId;
  readonly source: MidiSource;
  readonly feedback?: MidiTarget;
  readonly relativeEncoding?: RelativeEncoding;
}
```

Ties a `MidiSource` to the `ControlId` it drives. `feedback` is optional:
a mapping with none is input-only — turning the knob changes the control,
nothing is sent back. Most controls don't need it; it's there, not
assumed, for the ones that do (a motorized fader, an LED ring).

`relativeEncoding` (ECS-137) is optional, and only meaningful for a
numeric control: omitted (still the common case), `source`'s raw value is
normalized straight onto `control`'s range exactly as before. Present —
copied by `src/surface/generate.ts` from the originating
`PhysicalControl.relativeEncoding` (a device fact,
`docs/contracts/device-profile.md`) — it means `source` reports relative
deltas rather than a position: `decodeRelativeDelta(raw, encoding)`
(`src/mapping/value.ts`) turns the raw byte into a signed delta, which
`bindControlMapping()` (`docs/contracts/mapping-runtime.md`) accumulates
onto the control's *current* value and clamps to its range, instead of
scaling the raw byte directly. `RelativeEncoding` is mapping's own type
(`src/mapping/types/address.ts`), kept deliberately separate from the
profile layer's own `RelativeEncoding` of the same name — the same
"profile and mapping don't depend on each other" boundary this contract
already draws for `ControlSurfaceAddress`/`MidiAddress`.

## What's deliberately not here

- **No implementation**: no code that reads a `MidiInput`'s messages, calls
  `resolveIncomingValue()`, and pushes the result into a real `Control`
  via `setValue()` (or the reverse for feedback). That's later work once a
  device-profile layer exists to supply `ControlMapping`s — this ticket
  only defines the shape and the pure conversion functions.
- **No curves/transforms** — e.g. an exponential or logarithmic taper for
  a filter cutoff knob instead of linear. The conversion functions take no
  per-mapping function/parameter to customize scaling. This is a real,
  named extension point (a later `curve` or `transform` field on
  `ControlMapping`, or on `MidiSource`/`MidiTarget`), left undesigned until
  a concrete mapping needs something other than linear/threshold/bucket.
- **No conditions, still, inside `ControlMapping` itself** — e.g. "this
  mapping only applies while a modifier button is held." ECS-137 resolved
  this extension point one layer up, not here: `bindControlMapping()`
  (`docs/contracts/mapping-runtime.md`) gained a generic `shouldApply()`
  gate it knows nothing about the meaning of, and
  `src/surface/bindings.ts` (`docs/contracts/surface-bindings.md`) is what
  actually supplies a modifier-aware predicate. `ControlMapping` itself
  still carries no condition field.
- **No device profiles** — nothing here knows about a specific
  controller's layout or names a collection of `ControlMapping`s as "the
  mapping for a Launchpad." That's ECS-39.
- **No many-to-one or one-to-many mappings** (e.g. two CCs combined into
  one control, or one CC driving two controls) — one `ControlMapping` is
  exactly one source driving exactly one control, optionally with one
  feedback target.
