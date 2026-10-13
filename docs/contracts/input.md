# MIDI Core — Input Implementation

Status: Draft
Source of truth: [`src/core/types/input.ts`](../../src/core/types/input.ts), [`src/core/input/create-midi-input.ts`](../../src/core/input/create-midi-input.ts)

## Input contract

`MidiInput` delivers decoded incoming MIDI without callers needing to know
which transport is underneath.

## Two interfaces, one on each side of the seam

- **`RawMidiInput`** (`types/input.ts`) — what a transport must provide:
  `MidiConnection`'s lifecycle plus `onRawMessage(bytes)`, one complete
  message per call (matching how `decodeMidiMessage` expects to be fed — see
  the message model doc). A Web MIDI adapter or mock device can implement it.
- **`MidiInput`** (`types/input.ts`) — what a consumer gets: the same
  lifecycle, plus `onMessage(message)` delivering normalized `MidiMessage`
  values. No raw bytes, no transport type, no device identity beyond
  `MidiPortInfo`. This is "keep transport details and device knowledge
  outside consumers" made concrete: a consumer holding a `MidiInput` cannot
  tell which transport produced it.

`createMidiInput(transport: RawMidiInput): MidiInput` (`input/create-midi-input.ts`)
is the adapter between them. It's intentionally thin — lifecycle passes
straight through, and `onMessage` is just "subscribe to raw, decode, forward."
The adapter uses the message model's decoder to convert the live stream.

`port` and `state` are exposed as getters over the transport's own fields, so
a `MidiInput` always reflects the transport's current value rather than a
stale snapshot taken when it was wrapped.

## Transport independence

Any transport implementing `RawMidiInput` can be passed to
`createMidiInput()` unchanged. A real Web MIDI adapter requires a browser
(`navigator.requestMIDIAccess`).

Tests use an in-memory `FakeRawInput` test double local to
`create-midi-input.test.ts` to exercise the wiring.

## What's deliberately not here

- No Web MIDI or other real transport implementation.
- No output/send path or bidirectional wiring.
- No buffering, backpressure, or message batching — `onMessage` delivers
  messages as the transport produces them, synchronously, one at a time.
