# Control Surface — Architecture

Status: Draft
Related: [docs/architecture.md](../architecture.md),
[docs/contracts/device-profile.md](./contracts/device-profile.md),
[docs/contracts/mapping.md](./contracts/mapping.md),
[docs/contracts/mapping-runtime.md](./contracts/mapping-runtime.md),
[docs/contracts/control-api.md](./contracts/control-api.md)

## Purpose

Control Surface fills the gap between the Device Profile schema and the
Application Control API: nothing
turns a profile's physical controls into application control bindings as a
group, manages that group's lifecycle, switches which bindings are active, or
resolves a control dynamically. This document names the layer's owner —
**Control Surface** — and draws its boundary. Concrete contracts for its
responsibilities are documented separately, as with MIDI Core.

## The four boundaries

The project's vocabulary names four responsibilities. Control Surface sits
between the Device Profile and Application Contract:

| Name                     | Responsibility                                                                                                                                                                                                                                                                                               | Status                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **MIDI Core**            | Moves MIDI messages: discovery, lifecycle, normalized input/output. Knows nothing about devices or applications.                                                                                                                                                                                             | Built — [docs/architecture.md](../architecture.md)                                                             |
| **Device Profile**       | Describes one device's hardware capabilities and protocol: its physical controls, where each lives on the wire, feedback, SysEx and setup needs. Knows nothing about applications.                                                                                                                           | Built — [docs/contracts/device-profile.md](./contracts/device-profile.md)                                      |
| **Control Surface**      | Defines how a connected device's physical controls drive an application's controls: generates bindings from a profile, owns their lifecycle as a group, switches which are active by application-owned mode/context, resolves controls dynamically. Knows about both neighbors; is the only layer that does. | Defined by the surface contracts                                                                               |
| **Application Contract** | Exposes an application's software controls/state for something else to read, set and observe. Knows nothing about MIDI or devices.                                                                                                                                                                           | Built — [docs/contracts/control-api.md](./contracts/control-api.md) (there called the Application Control API) |

Updated layering (extends `docs/architecture.md`'s diagram, which drew
"Device / Profile / Mapping layer" as one unlabeled block because no single
layer by that name existed yet):

```
MIDI hardware
     |
MIDI Core                 src/core/, src/adapters/{web-midi,mock}/
     |
Device Profile            src/profile/  (describes the device; no app knowledge)
     |
Control Surface           generates ControlMapping(s) from a profile, owns
     |                     their lifecycle as a group, activates/deactivates
     |                     by mode, resolves controls dynamically —
     |                     composes src/mapping/ (ControlMapping,
     |                     bindControlMapping) as its leaf primitive
     |
Application Contract      src/control-api/  (Control, ControlDef, ControlRegistry)
     |
Sequencer / UI             e.g. webseq's src/midi/ adapter boundary
```

Each layer talks only to its immediate neighbors, the same rule
`docs/architecture.md` already states: nothing above Control Surface knows
MIDI exists, and nothing below it knows what a track or a mode is. Control
Surface is the one piece of the system allowed to depend on Device Profile,
the Mapping contract, and the Application Contract together — mirroring the
role `docs/contracts/mapping.md` already claims for itself one layer down
("the one piece of the system allowed to depend on both" Core and the
Control API).

## The split: one mapping stage, not two

**One mapping stage, not two.** A device control already has an identity:
`PhysicalControl` (`docs/contracts/device-profile.md`) names it
(`id`, `label`, `kind`)
and addresses it (`input`/`feedback`). Introducing a second contract between
that and `ControlMapping` would duplicate work `ControlMapping` already does
— bind one address to one control — while adding an indirection with no
behavior of its own. `ControlMapping`/`bindControlMapping()` remains the leaf
primitive. Control Surface's device-facing responsibility is a _generation_
step, not a new mapping contract — a pure function shape:

```
(DeviceProfile, binding table) -> ControlMapping[]
```

For each `PhysicalControl` the binding table assigns a role to, Control
Surface translates `PhysicalControl.input`/`feedback` (`ControlAddress`,
typed over `ControlSurfaceAddress`) into a `MidiSource`/`MidiTarget` (typed
over the narrower `MidiAddress`) and pairs it with the `ControlId` that role
resolves to for the application's current mode/context, producing one
`ControlMapping` exactly as `docs/contracts/mapping.md` already defines it.
This needs no change to `src/mapping/`, `src/control-api/`, or `src/core/`.

What "binding table" means precisely — a declarative config, a lookup
keyed by mode, something else — is **not** decided here. Whatever shape it
takes, its job ends at producing
`ControlMapping`s, and it must not re-encode physical note/CC layout
knowledge that a profile already recorded (webseq's `src/midi/mappings.ts`
hand-writing `{ address: { type: "control-change", controller: 7 }, channel:
0 }` today is exactly the duplication a profile-driven generation step
removes).

### Known, accepted limitation

`ControlSurfaceAddress` (profile layer) is a strict superset of `MidiAddress`
(mapping layer): it adds `program-change`, `channel-pressure` and
`poly-pressure` for physical controls real devices have (scene buttons,
pressure-sensitive pads/strips) that the mapping contract deliberately
excludes as "not controller surfaces in the same sense." A `PhysicalControl`
addressed with one of those three kinds has no path into a `ControlMapping`
today — the generation step above cannot produce one for it.

This limitation does not affect the current Novation Launchpad Mini MK3
profile (81 controls), which addresses
every control with `note`, squarely inside `MidiAddress`. Widening
`MidiAddress` to close this is `docs/contracts/mapping.md`'s decision to make
deliberately, once a concrete profile needs it — not something Control
Surface should work around with its own parallel address translation. Stated
here so it isn't rediscovered as a surprise once a device with scene buttons
shows up.

## Bidirectional flow

Control Surface does not reimplement the round trip
`bindControlMapping()` (`docs/contracts/mapping-runtime.md`) already proves —
it decides _which_ `ControlMapping`s exist and are currently bound, not how a
bound mapping moves a value:

- **Hardware → software**: a `MidiInput` message reaches a bound mapping's
  `resolveIncomingValue()`, which pushes a value into the application
  `Control` via `setValue()`. Unchanged from today's runtime.
- **Software → hardware**: a `Control`'s `onChange()` reaches a bound
  mapping's `buildFeedbackMessage()`, sent through `MidiOutput`. Echo
  suppression remains in the mapping runtime; Control Surface binds and unbinds
  whole mappings; it never sits on the wire between the two directions
  itself.
- **What Control Surface adds**: which `ControlMapping`s are bound at all,
  and to which `Control`s, changes over the surface's lifecycle (connect/
  disconnect) and over mode/context changes. A mode switch
  is specified as _unbinding_ the outgoing mode's mappings (calling the
  `Unsubscribe`s `bindControlMapping()` already returns) and _binding_ the
  incoming mode's — a batch rebind, not a per-message routing decision added
  inside the mapping/runtime layer. This keeps `ControlMapping` static (per
  `docs/contracts/mapping.md`'s own "no conditions" boundary) and keeps mode
  logic entirely in Control Surface, not device profiles.

## Boundary rules

- **No MIDI/device-specific code in the sequencer.** Only one adapter module may import both Control Surface and application internals. The consumer-facing surface contract stays narrow as a profile's full control set is bound.
- **No application knowledge in profiles or MIDI Core.** A `PhysicalControl` names a button, not a mute; Control Surface is where a physical control is assigned application meaning.
- **Physical note/CC/program-change layout knowledge stays in profiles.** A binding table names roles and resolves `ControlId`s; it reads addresses from `PhysicalControl` rather than duplicating device addresses.

## What's deliberately not here

- **No application contract shape** — controls, actions, context, selection, events; see [docs/contracts/control-api.md](./contracts/control-api.md).
- **No lifecycle contract** — attach/detach, availability, device setup; see [docs/contracts/surface-lifecycle.md](./contracts/surface-lifecycle.md).
- **No modes/context model** — application context selection and surface-owned navigation; see [docs/contracts/surface-navigation.md](./contracts/surface-navigation.md).
- **No binding language detail** — see [docs/contracts/surface-bindings.md](./contracts/surface-bindings.md).
- **No runtime implementation detail** — see [docs/contracts/surface-runtime.md](./contracts/surface-runtime.md).
- **No curves, conditions, or many-to-one mappings** — no concrete profile currently requires them.
- **No widening of `MidiAddress`** — see "Known, accepted limitation" above.
