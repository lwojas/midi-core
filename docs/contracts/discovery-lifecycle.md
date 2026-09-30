# MIDI Core — Discovery and Lifecycle Contract

Status: Draft
Linear: [ECS-27](https://linear.app/ecs3d/issue/ECS-27/define-midi-device-discovery-and-lifecycle-contract)
Depends on: [ECS-26](https://linear.app/ecs3d/issue/ECS-26/define-midi-core-architecture-and-boundaries) ([docs/architecture.md](../architecture.md))
Source of truth: [`src/core/types/`](../../src/core/types)

## Scope

This defines the generic, device-agnostic contract for:

- **Identity** — how a port is referred to and described (`identity.ts`).
- **Discovery** — enumerating ports and observing add/remove (`discovery.ts`).
- **Lifecycle** — connect/disconnect and connection state (`lifecycle.ts`, `connection.ts`).
- **Transport errors** — failures in talking to a port (`errors.ts`).

It does not cover sending/receiving MIDI messages once connected — that's the
input/output contract (ECS-28/29/30) — and it says nothing about any specific
device's controls. Per the architecture boundaries, this stays independent of
device profiles.

## Identity: ports, not "devices"

Core's unit of identity is a `MidiPortInfo` — an input or output **port**, not
a grouped notion of a physical "device". This matches how the underlying
transport (Web MIDI) exposes hardware: a single physical controller commonly
shows up as one input port and one separate output port, each with its own
id. Grouping those into a single "device" requires a heuristic (matching by
name/manufacturer) that isn't reliable and isn't Core's job — if it's ever
needed, it belongs in a higher layer, not here.

## Discovery is separate from connection

`MidiDiscovery` only answers "what ports exist right now, and when does that
change." Listing a port doesn't imply anything about whether it's connected.
This keeps discovery usable independently (e.g. for a device-picker UI) without
forcing a connection attempt.

## Lifecycle: Core's own state machine

`ConnectionState` is Core's own abstraction — `available`, `connecting`,
`connected`, `disconnecting`, `disconnected`, `error` — not a passthrough of
Web MIDI's `state`/`connection` fields. Clients should not need to know which
transport is underneath.

`isValidTransition(from, to)` encodes the allowed transitions as part of the
contract, so implementations (starting with the mock device in ECS-32) and
their tests share one definition of "valid" instead of each re-deriving it:

```
available -> connecting -> connected -> disconnecting -> disconnected
available | connecting | connected -> error
disconnected -> available   (the port re-appears)
```

A state is never considered to "transition" to itself — repeated identical
states are a no-op for callers, not an event.

## Transport errors

`MidiTransportError` covers failures at the transport/connection level only
(`permission-denied`, `device-unavailable`, `connection-failed`,
`send-failed`, plus `unknown` as an escape hatch). It is intentionally not
exhaustive — device- or application-level failures are out of scope for Core
and are reported by higher layers in their own terms.

## What's deliberately not here

- No implementation against real Web MIDI or a mock transport — that's
  ECS-29/30 (input/output) and ECS-32 (mock/test device).
- No device grouping, no profile awareness.
- No message send/receive — only the connection that would carry them.
