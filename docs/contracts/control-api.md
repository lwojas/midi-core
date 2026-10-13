# Application Control API — Contract

Status: Draft
Related: [docs/architecture.md](../architecture.md) (Application Control API layer),
[docs/control-surface-architecture.md](../control-surface-architecture.md)
Source of truth: [`src/control-api/`](../../src/control-api)

## Scope

This defines an application-facing contract for reading, setting and
observing abstract controls/state — a track's volume, an FX's filter
cutoff, the transport's playback status — independent of MIDI, UI and
automation. Like `docs/contracts/discovery-lifecycle.md` and
`message-model.md`, this document defines types and pure validators, not a
runtime implementation or an adapter wiring a real sequencer's state into it.

Per `docs/architecture.md`'s layering, the Application Control API sits
**above** MIDI Core's Device/Profile/Mapping layer, not inside Core. It is
deliberately a separate, independent module (`src/control-api/`, no
imports from `src/core/` or `src/adapters/`) — nothing here references a
`MidiMessage`, a DOM/React type, or an automation event. MIDI (via a future
mapping layer), a UI, and automation are all just things that may call
`setValue()`; the contract doesn't know or care which.

## Grounded in a real consumer, not invented names

## Control/value model

The control/value model defines identifiers, value types, normalization,
ranges, and state-change semantics:

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

## Actions

A `Control` models something with a persistent value to read, set and
observe — not everything a surface needs fits that shape. Transport
play/stop, "trigger step", "start recording" are commands: they have an
effect, not a value. Modeling them as a boolean `Control` that flips back
to `false` after being read would invent a value nothing in the
application actually holds, purely to satisfy a shape built for something
else.

```ts
export type ActionId = string;

export interface ActionDef {
  readonly id: ActionId;
  readonly label: string;
}

export interface Action {
  readonly def: ActionDef;
  invoke(): void;
}
```

`invoke()` returns nothing and there's no `onChange()` — the same "as
small as `MidiConnection`" restraint `Control` applies, for something with
no state at all. Anything with a value worth reading back (playback
_status_, as opposed to the "play" command) stays a `Control`; `Action`
exists only for the remainder a read/write/observe shape doesn't fit.

## Context and selection

`SurfaceContext` represents which track, pattern, or parameter a physical
control currently affects. This contract defines reading that context;
using it to choose between surface modes or views belongs to the surface
navigation layer.

```ts
export interface Selection {
  readonly scope: string;
  readonly id: string;
}

export interface SurfaceContext {
  listSelections(): readonly Selection[];
  getSelection(scope: string): Selection | undefined;
  onChange(listener: (selection: Selection) => void): Unsubscribe;
}
```

`scope` is owner-defined (`"track"`, `"pattern"`, `"step-page"`, ...), the
same reasoning `ControlId` already applies: this contract doesn't assume a
fixed set of selectable things, so no `SelectedTrack`/`SelectedPattern`
fields are hardcoded. `SurfaceContext` is deliberately shaped like
`ControlRegistry`/`MidiDiscovery` (snapshot + change notification), for
the same reason both of those exist: enumerating current selection is a
separate concern from reading or changing any one control.

**The application is the only writer.** `SurfaceContext` has no
`setSelection()`. Selection originates from the application's own state —
a user picking a track in its UI, a sequencer advancing to the next
pattern — and a surface and a UI both only ever _read_ it from here.
Neither is an intermediary that computes, caches or forwards selection on
the application's behalf: a surface needing "the currently selected
track" reads this contract directly, rather than asking a UI component or
inferring it from which MIDI port last sent a message.

`Selection` is deliberately the _only_ shape added for "context" — a
`Selection` is the only context shape; the contract does not define a
broader envelope.

## Events

Not everything a surface needs to react to is a value change, either. A
step firing during playback, or the playhead crossing a bar, are discrete
occurrences with nothing to read back afterward — modeling the playhead as
a `Control` would force every consumer to poll a fast-changing position,
exactly the tradeoff this doc's own webseq survey already found ("position
read by polling an engine clock rather than a subscription"). An event
reports each occurrence once instead of holding a value at all.

```ts
export type SurfaceEventId = string;

export interface SurfaceEvent<P = undefined> {
  readonly id: SurfaceEventId;
  readonly payload: P;
}

export interface SurfaceEventSource {
  onEvent(listener: (event: SurfaceEvent<unknown>) => void): Unsubscribe;
}
```

An event with nothing useful to say beyond "this happened" carries no
`payload`; one that does (which step fired) carries it as a plain value —
the same restraint `EnumControlDef` applies to option values, so no
engine-specific representation leaks through here either.

`SurfaceEventSource` reports multiple event kinds through
`SurfaceEvent<unknown>`; listeners narrow on `event.id` to determine the
payload type.

## Feedback

No new type. Per `docs/control-surface-architecture.md`'s bidirectional
flow, feedback to hardware is already fully covered by `Control.onChange()`
for anything with a persistent value (a motorized fader tracking a
`Control`'s value, an LED ring showing a filter cutoff) and by
`SurfaceEventSource.onEvent()` for anything momentary (a step-trigger
flash, a playhead chase light). Both are read-only subscriptions a mapping
or Control Surface layer drives outgoing MIDI from; this contract adds no
separate "feedback" type, since those two notification shapes already
cover the full application → surface direction between them.

## Examples: transport, track volumes, parameters, steps, playhead

The smallest set of shapes sufficient for a mock surface and a sequencer
The following shapes cover transport, track, parameter, step, and playhead
examples:

| Example                                             | Shape                                                                   | Why                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Track volume                                        | `Control<NumericControlDef>` (`"track.1.volume"`)                       | Persistent value — unchanged from the existing contract.                                             |
| FX parameter (filter cutoff)                        | `Control<NumericControlDef>` (`"fx.1.cutoff"`)                          | Same as above; already covered.                                                                      |
| Transport play/stop/record                          | `Action` (`"transport.play"`, `"transport.stop"`, `"transport.record"`) | A command with an effect, no value to read back.                                                     |
| Transport playback status                           | `Control<EnumControlDef>` (`"transport.status"`)                        | Unchanged — this doc's own survey already modeled it this way.                                       |
| Selected track (what "track fader" currently means) | `Selection { scope: "track", id: "track-1" }` via `SurfaceContext`      | Application-originated context a surface resolves a role against, not a value any one control holds. |
| Step on/off state                                   | `Control<BooleanControlDef>` (`"pattern.1.step.3"`)                     | Persistent value — unchanged.                                                                        |
| Step firing during playback (chase light)           | `SurfaceEvent` (`"pattern.step.triggered"`, payload `{ step: 3 }`)      | Momentary — nothing to read back between firings.                                                    |
| Playhead advancing                                  | `SurfaceEvent` (`"transport.tick"`, payload `{ step: 3 }`)              | Same reasoning as above; a continuously-advancing position is exactly the case events exist for.     |

None of this names a device protocol, a note number, or a CC — a mock
surface built against this table binds every row through `Control`,
`Action`, `SurfaceContext` or `SurfaceEventSource` exactly as a real
sequencer integration would, with MIDI translation staying entirely on the
other side of the boundary `docs/architecture.md` already draws.

## What's deliberately not here

- No implementation: no concrete `Control`/`Action`/`SurfaceContext`/
  `SurfaceEventSource` backed by real sequencer state, no wiring to
  a specific sequencer or UI framework.
- No MIDI-mapping layer translating normalized `MidiMessage`s into
  `setValue()`/`invoke()` calls (or control changes into outgoing MIDI) —
  that's the Device/Profile/Mapping layer named in `docs/architecture.md`,
  not this contract.
- No automation model (lanes, events, interpolation) — Control API only
  needs to support something else setting a value over time; it doesn't
  need to know how.
- No value clamping, unit conversion, or scaling (e.g. pitch bend to
  `-1..1`) — purely an application/mapping concern, same boundary the
  message model draws for MIDI.
- No fixed catalog of controls (no `TrackControls`, no `TransportControls`)
  — ids and definitions are supplied by whatever constructs a `Control`,
  not assumed by this contract.
- No `ActionRegistry` or event-source registry — enumerating actions or
  event sources dynamically would reuse the same need `ControlRegistry`
  already fills for controls, but no concrete mock/sequencer integration
  has needed one yet; add one patterned after `ControlRegistry` if and
  when it does, rather than build two unused registries now.
- No mode/view selection logic — _reading_ `Selection` is this contract's
  job; _using_ it to choose which `ControlMapping`s are active (Mixer vs.
  Step Grid vs. Transport, bank/page, next/previous) belongs to Control
  Surface navigation.
