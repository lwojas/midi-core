# MIDI Core — Mock/Test Device

Status: Draft
Linear: [ECS-32](https://linear.app/ecs3d/issue/ECS-32/create-midi-core-mocktest-device)
Depends on: [ECS-27](https://linear.app/ecs3d/issue/ECS-27/define-midi-device-discovery-and-lifecycle-contract) ([docs/contracts/discovery-lifecycle.md](./discovery-lifecycle.md)), [ECS-29](https://linear.app/ecs3d/issue/ECS-29/implement-midi-input) ([docs/contracts/input.md](./input.md)), [ECS-30](https://linear.app/ecs3d/issue/ECS-30/implement-midi-output) ([docs/contracts/output.md](./output.md))
Source of truth: [`src/adapters/mock/`](../../src/adapters/mock)

## What this fills

The architecture doc (ECS-26) names a mock/test device as an extension
point so higher layers and tests don't require real hardware. ECS-29/30's
own tests each built a small, throwaway `RawMidiInput`/`RawMidiOutput`
fake local to one test file, explicitly noting that a shared, reusable
mock was a separate, later deliverable. This is that deliverable: a
generic mock implementing Core's own contracts, usable across the rest of
the project (and in this repo's tests going forward), with no
device-specific profile or behavior.

## A device is a paired input + output port

Per `docs/contracts/discovery-lifecycle.md`, Core's identity is a port,
not a device. `createMockDevice()` (`create-mock-device.ts`) reflects that:
it hands back a `MockMidiInput` and a `MockMidiOutput` with distinct ids
(`${id}-in` / `${id}-out`) but shared name/manufacturer — the same shape a
real physical controller takes when it surfaces as two separate ports.
There is no device-level object wrapping the pair; the two ports are just
returned together for convenience.

## `MockPort`: a reference implementation of the lifecycle contract

`WebMidiPortBase` forwards whatever state real hardware reports and
deliberately does **not** validate those transitions against
`isValidTransition()`, because real hardware doesn't necessarily respect
Core's state machine. A mock has no hardware to defer to, so `MockPort`
(`mock-port.ts`) takes the opposite stance: every state change — whether
from `connect()`/`disconnect()` or from a `simulate*()` test helper — is
checked against `isValidTransition()`, and an invalid one throws
synchronously (surfacing as a rejected promise from `connect()`/
`disconnect()`, since both are `async`). This makes the mock the first
implementation that actually enforces the transition table from
`docs/contracts/discovery-lifecycle.md`, so tests written against it are
exercising the real rules, not a looser stand-in.

`connect()`/`disconnect()` are idempotent no-ops when already
`connected`/`disconnected`; a repeated identical state elsewhere is a
no-op that fires no `onStateChange` event, per the lifecycle contract's
"a state never transitions to itself" rule.

Three test-only controls, all on `MockPort` so both `MockMidiInput` and
`MockMidiOutput` get them:

- **`simulateAvailable()`** — the `disconnected -> available` (or
  `error -> available`) transition representing a port re-appearing or an
  error condition clearing. Required before `connect()` can succeed again
  from either of those states, since the transition table doesn't allow
  going directly from `disconnected`/`error` to `connecting`.
- **`simulateError(error)`** — moves to `error` and emits it via
  `onError`, exercising the same channel real transports use.
- **`simulateDisconnect()`** — a device disappearing mid-operation,
  jumping straight to `disconnected` and skipping the graceful
  `disconnecting` step that `disconnect()` goes through.

## Messages: `emitRawMessage` in, `sentMessages` out

`MockMidiInput` implements `RawMidiInput`; `emitRawMessage(bytes)` is the
test-only hook standing in for "the device just sent these bytes."
Wrapped in `createMidiInput()`, it exercises the full decode path from
`docs/contracts/message-model.md`, including Note On/Off and Control
Change.

`MockMidiOutput` implements `RawMidiOutput`; `sendRaw(bytes)` records
bytes in `sentMessages` instead of sending them anywhere. Wrapped in
`createMidiOutput()`, a caller's `send(message)` can be asserted against
the exact wire bytes `encodeMidiMessage` produced.
`simulateSendFailures(true)` flips `sendRaw` to report a `send-failed`
transport error through `onError` instead of recording bytes, exercising
the ECS-30 error path without a real device to refuse the send.

Both directions can be exercised on one `createMockDevice()` pair by
wiring the output's `sendRaw` to also feed the input's `emitRawMessage`
(a manual "echo" — Core doesn't do this automatically, since Core has no
concept of a single physical device spanning two ports).

## `MockMidiDiscovery`

A `MidiDiscovery` whose ports only appear/disappear when a test calls
`addPort()`/`removePort()`, in contrast to `WebMidiDiscovery` which
mirrors a real `MIDIAccess`. `createMockDevice({ discovery })` registers
both of a device's ports with it on creation, so device-picker-style
discovery flows can be exercised without any transport at all.

## What's deliberately not here

- No device grouping beyond the paired-ports convenience — Core still has
  no "device" concept above a port.
- No device-specific profile, capability, or feedback behavior (LEDs, pad
  grids, SysEx) — this is a generic test double, not a fake Launchpad.
- No automatic echo/loopback between a device's input and output; a test
  that wants one wires it explicitly.
- No replacement for the real Web MIDI adapter (ECS-31) — this proves
  Core's contracts hold without hardware, not that they hold against real
  hardware.
