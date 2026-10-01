# Application Control API — Contract

Status: Draft
Linear: [ECS-34](https://linear.app/ecs3d/issue/ECS-34/define-application-control-api),
[ECS-35](https://linear.app/ecs3d/issue/ECS-35/define-controlvalue-model)
Related: [docs/architecture.md](../architecture.md) (Application Control API layer)
Source of truth: [`src/control-api/`](../../src/control-api)

## Scope

This defines an application-facing contract for reading, setting and
observing abstract controls/state — a track's volume, an FX's filter
cutoff, the transport's playback status — independent of MIDI, UI and
automation. Like `docs/contracts/discovery-lifecycle.md` and
`message-model.md`, this ticket produces **only the contract**: types and
pure validators, no runtime implementation and no adapter wiring a real
sequencer's state into it.

Per `docs/architecture.md`'s layering, the Application Control API sits
**above** MIDI Core's Device/Profile/Mapping layer, not inside Core. It is
deliberately a separate, independent module (`src/control-api/`, no
imports from `src/core/` or `src/adapters/`) — nothing here references a
`MidiMessage`, a DOM/React type, or an automation event. MIDI (via a future
mapping layer), a UI, and automation are all just things that may call
`setValue()`; the contract doesn't know or care which.

## Grounded in a real consumer, not invented names

The ticket asked to investigate the shape controls actually take rather
than assume exact names. That investigation looked at a real sequencer
client (webseq, built on the webdsp audio engine) to see how it represents
exactly the three examples named in the ticket:

- **Track volume/mute/solo** are plain bespoke fields on a `Track`
  object (`volume: number`, `muted: boolean`, `soloed: boolean`), not
  routed through any shared "control" abstraction.
- **Transport state** is a `PlaybackStatus` (`"stopped" | "playing" |
  "paused"`) read via imperative methods on a `Transport` class, with
  position read by polling an engine clock rather than a subscription —
  tempo (BPM) is separate, stored on the project and range-clamped
  (40–240).
- **FX parameters** (filter cutoff, reverb mix, compressor threshold, ...)
  already go through a generic, reusable shape: an `FxParamDef` with
  `{ id, label, min, max, step, unit?, default, options? }`, and an
  `FxInstance` storing current values as `params: Record<string, number>`.
  Automation targets these same `(fxId, parameter)` ids, and resolving a
  parameter's effective value is "automation overrides the base value when
  present, falls through to it otherwise."

The conclusion that shaped this contract: a generic, id-keyed,
metadata-carrying control (closest to the existing `FxParamDef`) is the
right level of abstraction, but it needs generalizing two ways the current
FX-only version doesn't: (1) beyond numeric-only values, to also cover
booleans (mute/solo) and named options (playback status) uniformly, and
(2) beyond FX, to any control regardless of what owns it. It deliberately
does **not** introduce fixed, named fields like `TrackControls.volume` —
per the ticket, what controls exist and what they're called is for
whatever constructs them to decide, not for this contract to assume.

## Control/value model (ECS-35)

ECS-35 scoped a separate investigation into control identifiers, value
types, normalisation, ranges and state-change semantics, depending on the
Control API design above. Designing `Control`/`ControlDef` for ECS-34
required settling exactly those questions first — a `Control` can't be
specified without first deciding what its identifier, value type, and
range/state-change semantics are — so that work landed as part of this
contract rather than as a separate pass:

- **Identifiers** — `ControlId` (opaque string, owner-scoped, e.g.
  `"track.1.volume"`).
- **Value types** — `ControlValueKind` (`"number" | "boolean" | "enum"`)
  and the `ControlValue<D>` mapped type.
- **Normalisation** — one generalized def shape (`NumericControlDef` /
  `BooleanControlDef` / `EnumControlDef`) applied uniformly to any control,
  replacing the bespoke per-owner fields (`Track.volume`, `PlaybackStatus`)
  found in the webseq survey below.
- **Ranges** — `NumericControlDef.min`/`max`/optional `step`.
- **State-change semantics** — `Control.onChange(value, previous)` plus
  `isValidControlValue()` defining what a legal state is.

No further contract work remains open for ECS-35; see the shapes below.

## Shape: `ControlDef` and `Control`

Three kinds, matching the three concrete examples above:

- **`NumericControlDef`** — `min`/`max`/optional `step`/optional `unit`,
  e.g. filter cutoff (`40`–`18000`, `unit: "Hz"`) or track volume
  (`0`–`1`). `step` omitted means continuous.
- **`BooleanControlDef`** — e.g. mute, solo, bypass.
- **`EnumControlDef`** — a fixed set of `{ label, value }` options, e.g.
  transport playback status. Option values are always strings; an engine
  whose native representation is numeric (e.g. a DSP filter-mode enum)
  converts between its code and the option string at its own adapter
  boundary — Control API doesn't encode any particular engine's
  representation, the same reasoning `message-model.md` applies to not
  reinterpreting MIDI meaning.

A `Control<D>` bundles a `ControlDef` with `getValue()`/`setValue()`/
`onChange()` — deliberately as small as MIDI Core's `MidiConnection`:
reading, setting and observing is the whole surface. `ControlValue<D>`
maps a `ControlDef`'s `kind` to its value's TS type (`number`/`boolean`/
`string`), so `Control<NumericControlDef>.setValue()` is typed to
`number` without a separate type parameter to keep in sync.

`isValidControlValue(def, value)` is a pure validator — right JS type,
in-range and on-step for a number, a declared option for an enum —
mirroring `isChannel`/`isDataByte` in the message model. It validates; it
does not clamp or coerce, the same choice the message codec makes for
encode.

## `ControlRegistry`

A lookup-plus-change-notification contract for "what controls exist right
now from this owner," mirroring `MidiDiscovery` for the same reason:
enumerating controls is a separate concern from reading or changing any
one of them. A track, an FX instance, or the transport would each expose
its own controls through one of these; there's no single global registry
assumed.

## What's deliberately not here

- No implementation: no concrete `Control` backed by real sequencer state,
  no wiring to webseq/webdsp, no React/UI bindings. That's a later,
  separate concern — this ticket only defines the shape.
- No MIDI-mapping layer translating normalized `MidiMessage`s into
  `setValue()` calls (or control changes into outgoing MIDI) — that's the
  Device/Profile/Mapping layer named in `docs/architecture.md`, not this
  contract.
- No automation model (lanes, events, interpolation) — Control API only
  needs to support something else setting a value over time; it doesn't
  need to know how.
- No value clamping, unit conversion, or scaling (e.g. pitch bend to
  `-1..1`) — purely an application/mapping concern, same boundary the
  message model draws for MIDI.
- No fixed catalog of controls (no `TrackControls`, no `TransportControls`)
  — ids and definitions are supplied by whatever constructs a `Control`,
  not assumed by this contract.
