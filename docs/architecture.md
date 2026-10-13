# MIDI Core - Architecture and Boundaries

Status: Draft

## Purpose

MIDI Core is a small, reusable contract between MIDI hardware and the clients that use it. It is a control surface, not part of the sequencer. This document defines what Core owns, what it explicitly excludes, and where the system can grow without committing to how that growth is implemented.

Concrete contracts (message shapes, discovery/lifecycle APIs, and profile schemas) are documented separately and must conform to these boundaries.

## Layered architecture

```
MIDI hardware
     |
MIDI Core
     |
Device / Profile / Mapping layer
     |
Application Control API
     |
Sequencer / Audio engine / UI
```

Each layer only talks to its immediate neighbors. Nothing above the Device/Profile/Mapping layer knows MIDI exists; nothing in Core knows what an application control or a Launchpad is. Data flows and is translated at each boundary rather than passed through untransformed.

## What Core owns

Core is responsible for the generic, device-agnostic parts of talking to MIDI hardware over a transport (initially Web MIDI):

- **Discovery** - enumerating available MIDI inputs/outputs and observing when devices appear or disappear.
- **Identity** - a stable way to refer to a device/port across a session (id, name, manufacturer where available), independent of any profile.
- **Lifecycle** - connection state for a device (available, connecting, connected, disconnected, error) and transitions between those states.
- **Input/Output** - sending and receiving MIDI data on a connected port, including raw bytes and a normalized message representation.
- **Generic capabilities** - transport-level facts a client can query for any MIDI device, such as whether a port supports input, output, or both.
- **Transport errors** - surfacing connection and transport failures in a consistent shape.

Core's job ends at: "here is a device, here is its lifecycle state, here are the messages flowing in and out, here is what went wrong." It does not interpret what any of that means to an application.

## What Core explicitly excludes

These are out of scope for Core and belong in higher layers:

- **Sequencer semantics** - tempo, transport, clips, tracks, timing, and quantization. The sequencer is a consumer of MIDI Core, not a peer.
- **UI state** - how a device or control is displayed, selected, or highlighted in an application.
- **Device-specific behavior** - a controller's pad grid, LED feedback protocol, button layout, or vendor SysEx. That belongs to the Device/Profile layer.
- **Application control mapping** - translating MIDI messages into application controls or application changes into MIDI. Core carries messages; it does not assign them meaning.

If an addition to Core requires knowing about a specific device, a sequencer concept, or a UI concept, it does not belong in Core.

## Extension points

Core is deliberately conservative, while its boundaries allow other layers to grow without changing Core's contract:

- **Device profiles** describe a device's capabilities, control layout, and feedback behavior. Profiles consume Core's normalized messages and capabilities without requiring Core to know about device types. See [docs/contracts/device-profile.md](contracts/device-profile.md).
- **Protocol families** - Core is scoped to MIDI 1.0 over Web MIDI. Its transport boundary can accommodate another protocol family, such as MIDI 2.0/MPE-aware transports, without speculative support in the current implementation.
- **Control Surface** - bidirectional translation between device profiles and the Application Control API is separate from Core. See [docs/control-surface-architecture.md](control-surface-architecture.md).
- **Mock/test device** - discovery and lifecycle contracts can be implemented by a mock transport so higher layers and tests do not require real hardware.

## Design principles

- **Composition over inheritance/config**: Core, protocol definition, device profile, and application mapping are separate, composable pieces.
- **Deterministic at runtime**: no runtime inference or AI-driven behavior in Core or the live control path. Offline tooling is separate from this architecture.
- **No speculative features**: extension points are documented, not built, until there is a concrete need.

## Non-goals

- No device-specific profiles (Launchpad/APC/Push or otherwise).
- No Application Control API or mapping UI.
- No exhaustive MIDI 1.0 standard coverage; only what's needed to carry normalized channel voice messages and generic capabilities.
- No vendor SysEx interpretation.
