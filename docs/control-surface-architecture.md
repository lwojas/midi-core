# Control Surface — Architecture

Status: Draft (architectural decision gate; no implementation)
Linear: [ECS-64](https://linear.app/ecs3d/issue/ECS-64/define-control-surface-architecture)
Project: [MIDI Core and Control Architecture](https://linear.app/ecs3d/project/midi-core-and-control-architecture-f934a737de3b)
Depends on: [ECS-63 audit](./control-surface-audit.md)
Related: [docs/architecture.md](../architecture.md),
[docs/contracts/device-profile.md](./contracts/device-profile.md) (ECS-39),
[docs/contracts/mapping.md](./contracts/mapping.md) (ECS-36),
[docs/contracts/mapping-runtime.md](./contracts/mapping-runtime.md) (ECS-37/57),
[docs/contracts/control-api.md](./contracts/control-api.md) (ECS-34/35)
Feeds: ECS-65 (application-facing surface contract), ECS-66 (lifecycle/runtime
model), ECS-67 (modes/context model), ECS-68 (declarative mapping vs. hooks),
ECS-69–80 (implementation)

## Purpose

[ECS-63's audit](./control-surface-audit.md) confirmed a real, unfilled gap
between the Device Profile schema and the Application Control API: nothing
turns a profile's physical controls into application control bindings as a
group, manages that group's lifecycle, switches which bindings are active, or
resolves a control dynamically. This ticket is the decision gate that names
that gap's owner — **Control Surface** — and draws its boundary precisely
enough that ECS-65–68 can each design one piece of it without re-litigating
where it sits or what it's built from. It is a boundary definition, not an
implementation: no new types, no new runtime code. Concrete contracts for the
pieces named here are ECS-65–68's scope, the same relationship
`docs/architecture.md` has to ECS-27/28/39 for MIDI Core.

## The four boundaries

The project's own vocabulary names four responsibilities. Three already exist
as shipped contracts; this ticket places the fourth between them:

| Name | Responsibility | Status |
|---|---|---|
| **MIDI Core** | Moves MIDI messages: discovery, lifecycle, normalized input/output. Knows nothing about devices or applications. | Built — [docs/architecture.md](../architecture.md) |
| **Device Profile** | Describes one device's hardware capabilities and protocol: its physical controls, where each lives on the wire, feedback, SysEx/handshake needs. Knows nothing about applications. | Built — [docs/contracts/device-profile.md](./contracts/device-profile.md) |
| **Control Surface** | Defines how a connected device's physical controls drive an application's controls: generates bindings from a profile, owns their lifecycle as a group, switches which are active by application-owned mode/context, resolves controls dynamically. Knows about both neighbors; is the only layer that does. | **New — this ticket** |
| **Application Contract** | Exposes an application's software controls/state for something else to read, set and observe. Knows nothing about MIDI or devices. | Built — [docs/contracts/control-api.md](./contracts/control-api.md) (there called the Application Control API) |

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

The ticket asks whether to formalize or reject a split between "MIDI message
↔ device control" mapping and "device control ↔ application control"
mapping — i.e., whether a device control needs its own identity and a second
binding stage distinct from the `ControlMapping` that already binds a MIDI
source straight to an application `ControlId`.

**Rejected.** A device control already has an identity: `PhysicalControl` (
`docs/contracts/device-profile.md`, ECS-39) names it (`id`, `label`, `kind`)
and addresses it (`input`/`feedback`). Introducing a second contract between
that and `ControlMapping` would duplicate work `ControlMapping` already does
— bind one address to one control — while adding an indirection with no
behavior of its own. That's exactly what this ticket's "evolve existing
mapping contracts where possible; do not duplicate them" instruction rules
out, and the audit's own recommendation is the same: keep
`ControlMapping`/`bindControlMapping()` as the leaf primitive.

**Formalized instead:** Control Surface's device-facing responsibility is a
*generation* step, not a new mapping contract — a pure function shape:

```
(DeviceProfile, binding table) -> ControlMapping[]
```

For each `PhysicalControl` the binding table assigns a role to, Control
Surface translates `PhysicalControl.input`/`feedback` (`ControlAddress`,
typed over `ControlSurfaceAddress`) into a `MidiSource`/`MidiTarget` (typed
over the narrower `MidiAddress`) and pairs it with the `ControlId` that role
resolves to for the application's current mode/context, producing one
`ControlMapping` exactly as `docs/contracts/mapping.md` already defines it.
This costs nothing beyond what ECS-72 already plans to build, and needs no
change to `src/mapping/`, `src/control-api/`, or `src/core/`.

What "binding table" means precisely — a declarative config, a lookup
keyed by mode, something else — is **not** decided here; that's ECS-68's
question ("declarative mapping vs. script/hook architecture"). This ticket
only fixes that whatever shape it takes, its job ends at producing
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

This is inert, not a gap this ticket closes: the one real profile this
project has generated (Novation Launchpad Mini MK3, 81 controls) addresses
every control with `note`, squarely inside `MidiAddress`. Widening
`MidiAddress` to close this is `docs/contracts/mapping.md`'s decision to make
deliberately, once a concrete profile needs it — not something Control
Surface should work around with its own parallel address translation. Stated
here so it isn't rediscovered as a surprise once a device with scene buttons
shows up.

## Bidirectional flow

Control Surface does not reimplement the round trip
`bindControlMapping()` (`docs/contracts/mapping-runtime.md`) already proves —
it decides *which* `ControlMapping`s exist and are currently bound, not how a
bound mapping moves a value:

- **Hardware → software**: a `MidiInput` message reaches a bound mapping's
  `resolveIncomingValue()`, which pushes a value into the application
  `Control` via `setValue()`. Unchanged from today's runtime.
- **Software → hardware**: a `Control`'s `onChange()` reaches a bound
  mapping's `buildFeedbackMessage()`, sent through `MidiOutput`. Unchanged,
  including ECS-57's echo suppression — Control Surface binds and unbinds
  whole mappings; it never sits on the wire between the two directions
  itself.
- **What Control Surface adds**: which `ControlMapping`s are bound at all,
  and to which `Control`s, changes over the surface's lifecycle (connect/
  disconnect, ECS-66) and over mode/context changes (ECS-67). A mode switch
  is specified as *unbinding* the outgoing mode's mappings (calling the
  `Unsubscribe`s `bindControlMapping()` already returns) and *binding* the
  incoming mode's — a batch rebind, not a per-message routing decision added
  inside the mapping/runtime layer. This keeps `ControlMapping` static (per
  `docs/contracts/mapping.md`'s own "no conditions" boundary) and keeps mode
  logic entirely in Control Surface, where the ticket requires it ("navigation/
  mapping behaviour belongs in the surface, not device profiles").

## Deliberately small proof scope

Per this ticket's instruction not to build a universal framework, the proof
this architecture needs is narrow and sequenced, not full feature coverage:

1. One profile (the already-real Launchpad Mini MK3, or ECS-71's generic
   mock) generates a set of `ControlMapping`s via the step above.
2. Those mappings bind against ECS-71's mock device and a minimal
   application contract (ECS-65), round-tripping input and feedback —
   proof that generation + existing `bindControlMapping()` compose, with no
   modes yet (ECS-77).
3. Mode switching (ECS-75) layers a second mapping set and the unbind/
   rebind behavior above on top of step 2 — proof the lifecycle/mode split
   holds once there's more than one static binding set.
4. Only after 1–3 hold does real hardware (ECS-79) and a real sequencer
   (ECS-78) replace the mock pieces. Validating against a mock first is the
   same ordering `docs/contracts/mock-device.md`'s mock already enabled for
   Core — this ticket doesn't skip ahead of it.

Anything not needed to prove 1–3 — curves/conditions, many-to-one mappings,
cross-device orchestration, automatic profile-to-port matching — stays
deferred exactly as the audit's "Non-gaps" section already named them; this
architecture does not reopen them.

## Boundary rules (restated as constraints on ECS-65–80)

These are not new decisions — they're `docs/architecture.md`'s existing
rules, restated here because they bind directly on the layer this ticket
defines:

- **No MIDI/device-specific code in the sequencer.** Only one adapter module
  may import both Control Surface and application internals — the same
  single-boundary shape webseq's `src/midi/` already proves for the mapping
  layer (ECS-38). Control Surface's consumer-facing side must be narrow
  enough that this still holds once a profile's full control set, not two
  hand-picked controls, is bound.
- **No application knowledge in profiles or MIDI Core.** A `PhysicalControl`
  names a button, not a mute; `DeviceProfile` has no field a mode/context
  model could ever populate. Control Surface is where a physical control is
  first assigned application meaning — never earlier.
- **Physical note/CC/program-change layout knowledge stays in profiles.**
  Control Surface's binding table names *roles* ("pad grid", "transport
  play") and resolves `ControlId`s for them; it must not carry a device's
  note numbers or CC numbers itself. That data already lives in
  `PhysicalControl` and must be read from there, not re-authored — the exact
  duplication webseq's `mappings.ts` has today and that a profile-driven
  generation step (ECS-72) removes.

## What's deliberately not here

- **No application contract shape** — controls, actions, context,
  selection, events. That's ECS-65.
- **No lifecycle contract** — attach/detach, availability, handshake
  boundary between profile and surface. That's ECS-66.
- **No modes/context model** — how application context selects a mode, who
  owns bank/page/navigation. That's ECS-67.
- **No binding language decision** — declarative config vs. hooks vs.
  something else for the generation step's "binding table." That's ECS-68.
- **No runtime code** — `ControlRegistry` remains unimplemented
  (`docs/contracts/control-api.md`, Gap 5 in the audit); this ticket names
  Control Surface as its consumer, not its implementer.
- **No curves, conditions, or many-to-one mappings** — unchanged from
  `docs/contracts/mapping.md`'s own deferral; no concrete profile has needed
  them.
- **No widening of `MidiAddress`** — see "Known, accepted limitation" above.

## Traceability

- ECS-63 — Audit existing MIDI Core and mapping architecture (prerequisite;
  this ticket's recommendation section is largely adopted here) — see
  [docs/control-surface-audit.md](./control-surface-audit.md).
- ECS-65 — Define application-facing surface contract (the Application
  Contract box above, extending `docs/contracts/control-api.md`).
- ECS-66 — Define surface lifecycle and runtime model (Control Surface's
  attach/detach/cleanup, built on Core's connection lifecycle) — see
  [docs/contracts/surface-lifecycle.md](./contracts/surface-lifecycle.md).
- ECS-67 — Define modes/context model (which `ControlMapping` set is active,
  and who owns navigation) — see
  [docs/contracts/surface-navigation.md](./contracts/surface-navigation.md).
- ECS-68 — Resolve declarative mapping vs. script/hook architecture (the
  generation step's "binding table" shape: declarative `ModeBinding`s plus
  two narrow `onEnter`/`onExit`/`resolveBindings` hooks, no scripts or
  state machines) — see
  [docs/contracts/surface-bindings.md](./contracts/surface-bindings.md).
- ECS-69 — Implement Control Surface runtime (`createSurfaceNavigation()`
  plus `bindSurfaceMode()`/`bindActiveMode()`: the foundation that calls
  `bindControlMapping()` against an injected generation step, without yet
  implementing that generation step (ECS-72) or `attach()`/`detach()`
  itself (ECS-76)) — see
  [docs/contracts/surface-runtime.md](./contracts/surface-runtime.md).
- ECS-70 — Implement application context/state interface
  (`createControl()`/`createAction()`/`createControlRegistry()`/
  `createSurfaceContext()`/`createSurfaceEventSource()`: the generic,
  in-memory reference implementation `docs/contracts/control-api.md`
  left unbuilt) — see
  [docs/contracts/control-api-runtime.md](./contracts/control-api-runtime.md).
- ECS-71 — Build generic mock device profile and test harness
  (`MOCK_SURFACE_DEVICE_PROFILE`: 8 knobs/4 buttons/8 pads + a step grid,
  paired with real mock MIDI ports and a `PhysicalControl`-id-driven
  harness) — see
  [docs/contracts/mock-surface-device.md](./contracts/mock-surface-device.md).
- ECS-72 — Implement basic control bindings (`generateControlMappings()`:
  the profile → `ControlMapping` generation step named above, filling
  ECS-69's injected `GenerateControlMappings` seam) — see
  [docs/contracts/surface-generation.md](./contracts/surface-generation.md).
- ECS-73 — Implement application → surface feedback
  (`bindEventFeedback()`: the missing `SurfaceEventSource` → MIDI half
  `docs/contracts/control-api.md`'s own "Feedback" section already
  named; demonstrates track volume/transport status/active steps via
  the existing `bindControlMapping()` path, and playhead via the new
  one; revised `MOCK_SURFACE_DEVICE_PROFILE`'s knobs to carry CC
  feedback, since a `"note"` address only ever pairs with a boolean
  control) — see
  [docs/contracts/application-surface-feedback.md](./contracts/application-surface-feedback.md).
- ECS-74 — Implement surface → application control
  (`bindActionTrigger()`: the missing MIDI → `Action` half, symmetric to
  ECS-73's event-feedback gap — `ControlMapping` only ever drives a
  `Control`'s value, never a fire-and-forget command; demonstrates
  volume/step input via the existing path and play/stop/record via the
  new one, with no raw MIDI vocabulary in application-side assertions)
  — see
  [docs/contracts/surface-application-control.md](./contracts/surface-application-control.md).
- ECS-75 — Implement basic mode switching (`switchMode()`: the
  unbind-then-bind sequence this document specified, as one explicit,
  awaitable step built from `bindActiveMode()`; demonstrated across
  Mixer/Transport/Step Grid sharing one profile on the generic mock
  surface device) — see
  [docs/contracts/mode-switching.md](./contracts/mode-switching.md).
- ECS-76 — Implement surface lifecycle/error handling
  (`createControlSurface()`: real `attach()`/`detach()` over live ports
  and an optional `HandshakeExecutor`, spontaneous-disconnect detection,
  and the `navigation.onChange()` subscription ECS-75 deferred — "that's
  `ControlSurface.attach()`" — now owning mode switching for the
  surface's whole attached lifetime) — see
  [docs/contracts/surface-lifecycle-runtime.md](./contracts/surface-lifecycle-runtime.md).
- ECS-77 — Validate minimal surface against a generic mock device (proof
  scope step 2 above; one real `ControlSurface` cycled through Mixer/
  Transport/Step Grid, no new production code — found that pad-press
  feedback is correctly echo-suppressed, not a gap) — see
  [docs/control-surface-validation.md](./control-surface-validation.md).
- ECS-78 — Integrate the sequencer through the Control Surface contract.
- ECS-79 — Select and validate one real device with the surface runtime
  (proof scope step 4 above).
- ECS-80 — Document future MIDI Profiler → surface integration.
