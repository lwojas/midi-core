# MIDI Core — Input Implementation

Status: Draft
Linear: [ECS-29](https://linear.app/ecs3d/issue/ECS-29/implement-midi-input)
Depends on: [ECS-27](https://linear.app/ecs3d/issue/ECS-27/define-midi-device-discovery-and-lifecycle-contract) ([docs/contracts/discovery-lifecycle.md](./discovery-lifecycle.md)), [ECS-28](https://linear.app/ecs3d/issue/ECS-28/define-normalised-midi-message-model) ([docs/contracts/message-model.md](./message-model.md))
Source of truth: [`src/core/types/input.ts`](../../src/core/types/input.ts), [`src/core/input/create-midi-input.ts`](../../src/core/input/create-midi-input.ts)

## The gap this fills

ECS-27 defined `MidiConnection` — port, state, connect/disconnect, state/error
subscriptions — but deliberately said nothing about how raw bytes actually
arrive; that was explicitly left for this ticket. ECS-29 adds the missing
piece: a way to receive incoming MIDI, decoded, without callers needing to
know what transport is underneath.

## Two interfaces, one on each side of the seam

- **`RawMidiInput`** (`types/input.ts`) — what a transport must provide:
  `MidiConnection`'s lifecycle plus `onRawMessage(bytes)`, one complete
  message per call (matching how `decodeMidiMessage` expects to be fed — see
  the message model doc). A future Web MIDI adapter implements this. So does
  the mock/test device (ECS-32).
- **`MidiInput`** (`types/input.ts`) — what a consumer gets: the same
  lifecycle, plus `onMessage(message)` delivering normalized `MidiMessage`
  values. No raw bytes, no transport type, no device identity beyond
  `MidiPortInfo`. This is "keep transport details and device knowledge
  outside consumers" made concrete: a consumer holding a `MidiInput` cannot
  tell which transport produced it.

`createMidiInput(transport: RawMidiInput): MidiInput` (`input/create-midi-input.ts`)
is the adapter between them. It's intentionally thin — lifecycle passes
straight through, and `onMessage` is just "subscribe to raw, decode, forward."
All the actual decoding logic already exists in the ECS-28 codec; this ticket
doesn't reimplement it, just wires it to a live stream.

`port` and `state` are exposed as getters over the transport's own fields, so
a `MidiInput` always reflects the transport's current value rather than a
stale snapshot taken when it was wrapped.

## No real transport is implemented here

There is no Web MIDI adapter yet, and no mock/test device (that's ECS-32).
Both would implement `RawMidiInput` and be handed to `createMidiInput()`
unchanged — that's the point of the seam. Building a real Web MIDI adapter
needs a browser (`navigator.requestMIDIAccess`), which isn't available in
this repo's Node/Vitest toolchain; it's better scoped as its own ticket once
there's a concrete reason to run against real hardware or a browser context,
rather than bolted onto this one.

Tests here use a small in-memory `FakeRawInput` test double, local to
`create-midi-input.test.ts`, just to exercise the wiring. It is not the
project's mock/test device — ECS-32 is a separate, more complete, reusable
deliverable meant for use across the rest of the project (and beyond just
input).

## What's deliberately not here

- No Web MIDI or other real transport implementation.
- No mock/test device (ECS-32).
- No output/send path (ECS-30) or bidirectional wiring (ECS-31).
- No buffering, backpressure, or message batching — `onMessage` delivers
  messages as the transport produces them, synchronously, one at a time.
