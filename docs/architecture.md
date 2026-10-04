# MIDI Core — Architecture and Boundaries

Status: Draft
Linear: [ECS-26](https://linear.app/ecs3d/issue/ECS-26/define-midi-core-architecture-and-boundaries)
Project: [MIDI Core and Control Architecture](https://linear.app/ecs3d/project/midi-core-and-control-architecture-f934a737de3b)

## Purpose

MIDI Core is a small, reusable contract between MIDI hardware and the clients that
use it. It is a control surface, not part of the sequencer. This document defines
what Core owns, what it explicitly excludes, and where the system is meant to grow
without committing to how that growth is implemented.

Everything here is a boundary definition. Concrete contracts (message shapes,
discovery/lifecycle APIs, profile schemas) are scoped to their own tickets
(ECS-27, ECS-28, ECS-39) and must conform to the boundaries set out below.

## Layered architecture

```
MIDI hardware
     |
MIDI Core                    <- this document
     |
Device / Profile / Mapping layer
     |
Application Control API
     |
Sequencer / Audio engine / UI
```

Each layer only talks to its immediate neighbors. Nothing above the Device/Profile/
Mapping layer knows MIDI exists; nothing in Core knows what an application control
or a Launchpad is. Data flows and is translated at each boundary — it is not passed
through untransformed.

## What Core owns

Core is responsible for the generic, device-agnostic parts of talking to MIDI
hardware over a transport (initially Web MIDI):

- **Discovery** — enumerating available MIDI inputs/outputs and observing when
  devices appear or disappear.
- **Identity** — a stable way to refer to a device/port across a session (id,
  name, manufacturer where available), independent of any profile.
- **Lifecycle** — connection state for a device (e.g. available, connecting,
  connected, disconnected, error) and the transitions between those states.
- **Input/Output** — sending and receiving MIDI data on a connected port,
  including both raw bytes and a normalized message representation (channel
  voice messages, etc.) that is easier to consume than raw MIDI bytes.
- **Generic capabilities** — transport-level facts a client can query that hold
  for any MIDI device (e.g. does this port support input, output, or both),
  as opposed to what a *specific* device can do.
- **Transport errors** — surfacing failures at the connection/transport level
  (permission denied, device disconnected mid-operation, send failure) in a
  consistent shape.

Core's job ends at: "here is a device, here is its lifecycle state, here are the
messages flowing in and out, here is what went wrong." It does not interpret what
any of that *means* to an application.

## What Core explicitly excludes

These are out of scope for Core, by design, and belong in higher layers:

- **Sequencer semantics** — tempo, transport (play/stop/record), clips, tracks,
  timing/quantization. The sequencer is a consumer of MIDI Core, not a peer.
- **UI state** — anything about how a device or control is displayed, selected,
  or highlighted in an application. Core has no concept of "UI."
- **Device-specific behavior** — knowledge of any particular controller (e.g.
  Launchpad, APC, Push): its pad grid, LED feedback protocol, button layout,
  or vendor SysEx. That is the Device/Profile layer's job, built on top of Core.
- **Application control mapping** — translating an incoming MIDI message into
  "the user turned knob X" or an application control change into an outgoing
  MIDI message. That is the Application Control API and the mapping layer
  between it and device profiles. Core carries messages; it does not assign
  them meaning.

If a proposed addition to Core requires knowing about a specific device, a
sequencer concept, or a UI concept, it does not belong in Core.

## Extension points

Core is deliberately conservative today, but the boundary is drawn to leave room
for growth elsewhere without changing Core's contract:

- **Device profiles** — a layer above Core that describes a specific device's
  capabilities, control layout, and feedback behavior. Profiles consume Core's
  normalized messages and capabilities; they do not require Core to know about
  device types. Schema is defined in ECS-39.
- **Protocol families** — Core is scoped to MIDI 1.0 over Web MIDI for now.
  The boundary between Core and the transport is kept narrow enough that a
  future protocol family (e.g. MIDI 2.0/MPE-aware transports) could be added
  alongside it without requiring changes to the layers above Core, but no such
  support is implemented speculatively now.
- **Mapping layer** — bidirectional translation between device profiles and the
  Application Control API is a separate, later concern (see project milestone
  sequence). Core's input/output contract is shaped so that a mapping layer can
  be built on top of it without Core needing to change. This layer is now named
  **Control Surface**; see
  [docs/control-surface-architecture.md](control-surface-architecture.md)
  (ECS-64).
- **Mock/test device** — Core's discovery and lifecycle contracts are designed
  to be implementable by a mock transport, so higher layers and tests do not
  require real hardware. This lands with ECS-27, not this ticket.

Extension points are named here so later contracts don't box themselves in —
none of them are implemented by this ticket.

## Design principles

- **Composition over inheritance/config**: Core, protocol definition, device
  profile, and application mapping are separate, composable pieces rather than
  one configurable system.
- **Deterministic at runtime**: no runtime inference or AI-driven behavior in
  Core (or anywhere in the live control path). Offline tooling (e.g. a future
  MIDI profiler) is a separate concern from this architecture.
- **No speculative features**: extension points are documented, not built,
  until a concrete ticket needs them.

## Non-goals (for Core, and for this ticket)

- No device-specific profiles (Launchpad/APC/Push or otherwise).
- No Application Control API or mapping UI.
- No exhaustive MIDI 1.0 standard coverage — only what's needed to carry
  normalized channel voice messages and generic capabilities.
- No vendor SysEx interpretation.
- This ticket produces no runtime code — the concrete Core contract (types,
  interfaces, discovery/lifecycle API, normalized message model) is the scope
  of ECS-27 and ECS-28, built against the boundaries defined here.

## Traceability

- ECS-27 — Define MIDI device discovery and lifecycle contract (implements
  Discovery, Identity, Lifecycle above).
- ECS-28 — Define normalised MIDI message model (implements Input/Output's
  normalized representation above).
- ECS-39 — Define device profile schema (implements the Device profiles
  extension point above) — see
  [docs/contracts/device-profile.md](contracts/device-profile.md).
- ECS-40 — Define protocol/profile composition model (lets a profile's
  controls and message-level behavior be composed from reusable protocol
  families — MCU, MIDI Clock/transport, MMC, vendor protocols — plus
  device-specific extensions, instead of every device hand-authoring its
  full control layout) — see
  [docs/contracts/protocol-composition.md](contracts/protocol-composition.md).
- ECS-41 — Define generic MIDI device profile (the first concrete profile
  built against ECS-39/40: every channel-voice message kind, no
  manufacturer assumptions, no physical controls, usable as a placeholder
  or as a starting point for a real device profile) — see
  [docs/contracts/generic-midi-profile.md](contracts/generic-midi-profile.md).
- ECS-42 — Define profile validation and diagnostics (actionable findings
  for a profile document's dangling references, unknown enum values, and
  a `sysex`/`handshake` marked required with nothing in it to perform —
  reported, never invented or guessed) — see
  [docs/contracts/profile-validation.md](contracts/profile-validation.md).
- ECS-32 — Create MIDI Core mock/test device (implements the Mock/test
  device extension point above).
- ECS-34 — Define application Control API (implements the Application
  Control API layer above, as an independent contract separate from
  Core — see
  [docs/contracts/control-api.md](contracts/control-api.md)).
- ECS-35 — Define control/value model (control identifiers, value types,
  normalisation, ranges, state-change semantics). Settled as part of
  ECS-34's `ControlDef`/`Control` shapes, since the Control API couldn't be
  designed without first deciding those — see
  [docs/contracts/control-api.md](contracts/control-api.md#controlvalue-model-ecs-35).
- ECS-36 — Define MIDI ↔ Control mapping contract (implements the Mapping
  layer extension point above: bidirectional translation between a
  `MidiMessage` and a `Control`, the only layer that depends on both Core
  and the Control API) — see
  [docs/contracts/mapping.md](contracts/mapping.md).
- ECS-37 — Implement basic bidirectional mappings (wires ECS-36's
  `ControlMapping` contract to a live `MidiInput`/`MidiOutput`/`Control`:
  an incoming message updates a control, and a control change sends MIDI
  back) — see
  [docs/contracts/mapping-runtime.md](contracts/mapping-runtime.md).
- ECS-63 — Audit existing MIDI Core and mapping architecture against the
  missing Control Surface layer — see
  [docs/control-surface-audit.md](control-surface-audit.md).
- ECS-64 — Define Control Surface architecture (names and bounds the layer
  the Mapping layer extension point above pointed to, composing
  `ControlMapping`/`bindControlMapping()` rather than replacing them) — see
  [docs/control-surface-architecture.md](control-surface-architecture.md).
- ECS-65 — Define application-facing surface contract (extends the
  Application Control API with `Action`, `Selection`/`SurfaceContext` and
  `SurfaceEvent`/`SurfaceEventSource`, covering transport, track volumes,
  parameters, steps and playhead without exposing device protocols) — see
  [docs/contracts/control-api.md](contracts/control-api.md).
- ECS-66 — Define surface lifecycle and runtime model (`ControlSurface`'s
  attach/detach as one aggregate state over Core's own per-port
  `ConnectionState`, the handshake-execution boundary, and where
  `ControlMapping` binding hooks into the lifecycle without this ticket
  deciding what a binding is) — see
  [docs/contracts/surface-lifecycle.md](contracts/surface-lifecycle.md).
- ECS-67 — Define modes/context model (`SurfaceNavigation`'s
  surface-owned mode/bank/page/grid-offset, kept strictly separate from
  `SurfaceContext`'s application-owned selection, with context only ever
  influencing a mode by being read, never by writing it) — see
  [docs/contracts/surface-navigation.md](contracts/surface-navigation.md).
- ECS-68 — Resolve declarative mapping vs. script/hook architecture
  (`ModeBinding`'s declarative role ↔ `ControlId`/navigation-action pairs,
  plus `onEnter`/`onExit`/`resolveBindings` as the only hooks, rejecting
  state machines and scripts as the mode-binding authoring mechanism) —
  see [docs/contracts/surface-bindings.md](contracts/surface-bindings.md).
- ECS-69 — Implement Control Surface runtime (`createSurfaceNavigation()`'s
  concrete modes, and `bindSurfaceMode()`/`bindActiveMode()`'s
  install/teardown orchestration around an injected generation step and
  the existing `bindControlMapping()`) — see
  [docs/contracts/surface-runtime.md](contracts/surface-runtime.md).
- ECS-70 — Implement application context/state interface (the generic,
  in-memory `Control`/`Action`/`ControlRegistry`/`SurfaceContext`/
  `SurfaceEventSource` `docs/contracts/control-api.md` left unbuilt;
  widened `SurfaceEventSource.onEvent` to `SurfaceEvent<unknown>` after
  finding the bare default couldn't type the contract's own payload
  examples) — see
  [docs/contracts/control-api-runtime.md](contracts/control-api-runtime.md).
- ECS-71 — Build generic mock device profile and test harness
  (`MOCK_SURFACE_DEVICE_PROFILE`'s 8 knobs/4 buttons/8-pad step grid,
  paired with real mock MIDI ports via `createMockSurfaceDevice()`, and
  `createMockSurfaceHarness()`'s `PhysicalControl`-id-driven press/
  release/turnKnob and feedback inspection) — see
  [docs/contracts/mock-surface-device.md](contracts/mock-surface-device.md).
- ECS-72 — Implement basic control bindings (`generateControlMappings()`
  fills ECS-69's injected `GenerateControlMappings` seam: translates a
  `PhysicalControl`'s declared `input`/`feedback` into a `MidiSource`/
  `MidiTarget`, resolves its `ControlId` via `resolveControlId()`, and
  pairs the result with its port id(s)) — see
  [docs/contracts/surface-generation.md](contracts/surface-generation.md).
- ECS-73 — Implement application → surface feedback
  (`bindEventFeedback()`'s `SurfaceEventSource` → MIDI direction,
  demonstrated alongside the existing `Control` → MIDI direction against
  track volume/transport status/active steps/playhead; added CC
  feedback to the mock device's knobs since a `"note"` target only ever
  pairs with a boolean control) — see
  [docs/contracts/application-surface-feedback.md](contracts/application-surface-feedback.md).
