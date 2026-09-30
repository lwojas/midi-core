# MIDI Core — Output Implementation

Status: Draft
Linear: [ECS-30](https://linear.app/ecs3d/issue/ECS-30/implement-midi-output)
Depends on: [ECS-27](https://linear.app/ecs3d/issue/ECS-27/define-midi-device-discovery-and-lifecycle-contract), [ECS-28](https://linear.app/ecs3d/issue/ECS-28/define-normalised-midi-message-model)
Related: [ECS-29](https://linear.app/ecs3d/issue/ECS-29/implement-midi-input) ([docs/contracts/input.md](./input.md))
Source of truth: [`src/core/types/output.ts`](../../src/core/types/output.ts), [`src/core/output/create-midi-output.ts`](../../src/core/output/create-midi-output.ts)

## Mirrors the input seam

Same shape as ECS-29, in reverse: **`RawMidiOutput`** is what a transport
must provide (`MidiConnection`'s lifecycle plus `sendRaw(bytes)`) —
implemented by a future Web MIDI adapter or the mock device (ECS-32).
**`MidiOutput`** is what consumers get (the same lifecycle plus
`send(message)`) — no raw bytes, no transport, no device knowledge.
`createMidiOutput(transport)` is the same kind of thin adapter as
`createMidiInput`: lifecycle passes straight through, `send()` calls the
ECS-28 codec and hands the resulting bytes to `sendRaw`.

## The transport error decision this ticket had to make

The ticket specifically calls out "including transport error handling."
Two different kinds of failure can happen on send, and they're handled
differently on purpose:

- **Bad message data** (`channel: 16`, `velocity: 200`, ...) is the
  caller's own mistake. `send()` calls `encodeMidiMessage()` first, which
  throws `MidiEncodeError` synchronously — same behavior as encode already
  has from ECS-28. `sendRaw` is never reached, so nothing is sent to the
  transport at all.
- **Transport-level send failures** (the port disconnected mid-send, the
  underlying API refuses to send) are *not* thrown by `sendRaw` or `send()`.
  `RawMidiOutput` is documented so implementations report these through the
  connection's existing `onError` — the same channel ECS-27 already built
  for every other transport error. This was a deliberate choice not to
  invent a second, parallel error-reporting path: `onError` already exists
  specifically for "something went wrong at the transport level," and a
  failed send is exactly that. It also keeps `createMidiOutput` from having
  to guess how to normalize an arbitrary thrown value from a real transport
  into a `MidiTransportError` — the transport implementation, which knows
  what actually happened, is in the best position to construct that value
  itself.

Net effect: a caller can tell "I sent garbage" (synchronous throw) apart
from "the device stopped listening" (async `onError`) without Core having
to invent a new distinction — it reuses the one from ECS-27.

## "Do not add device-specific feedback"

`send()` only turns a `MidiMessage` into bytes and hands them off. There is
no acknowledgement handling, no LED/feedback protocol, no notion of whether
a device "received" anything beyond the transport accepting the bytes.
Device feedback behavior belongs to a device profile layer, not here.

## What's deliberately not here

- No Web MIDI or other real transport implementation (same reasoning as
  ECS-29 — needs a browser).
- No mock/test device (ECS-32).
- No bidirectional wiring combining input+output on one port (ECS-31).
- No queuing, batching, or rate limiting of outgoing messages.
