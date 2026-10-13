# MIDI Core — Output Implementation

Status: Draft
Source of truth: [`src/core/types/output.ts`](../../src/core/types/output.ts), [`src/core/output/create-midi-output.ts`](../../src/core/output/create-midi-output.ts)

## Output contract

**`RawMidiOutput`** is what a transport
must provide (`MidiConnection`'s lifecycle plus `sendRaw(bytes)`) —
implemented by a Web MIDI adapter or mock device.
**`MidiOutput`** is what consumers get (the same lifecycle plus
`send(message)`) — no raw bytes, no transport, no device knowledge.
`createMidiOutput(transport)` is the same kind of thin adapter as
`createMidiInput`: lifecycle passes straight through, `send()` calls the
message codec and hands the resulting bytes to `sendRaw`.

## Transport error handling

Two different kinds of failure can happen on send, and they're handled
differently on purpose:

- **Bad message data** (`channel: 16`, `velocity: 200`, ...) is the
  caller's own mistake. `send()` calls `encodeMidiMessage()` first, which
  throws `MidiEncodeError` synchronously — same behavior as encode already
  has from the message codec. `sendRaw` is never reached, so nothing is sent to the
  transport at all.
- **Transport-level send failures** (the port disconnected mid-send, the
  underlying API refuses to send) are _not_ thrown by `sendRaw` or `send()`.
  `RawMidiOutput` is documented so implementations report these through the
  connection's existing `onError` channel for transport errors. This avoids
  inventing a second, parallel error-reporting path: `onError` already exists
  specifically for "something went wrong at the transport level," and a
  failed send is exactly that. It also keeps `createMidiOutput` from having
  to guess how to normalize an arbitrary thrown value from a real transport
  into a `MidiTransportError` — the transport implementation, which knows
  what actually happened, is in the best position to construct that value
  itself.

Callers can distinguish invalid message data (synchronous throw) from a
transport failure (reported through `onError`).

## "Do not add device-specific feedback"

`send()` only turns a `MidiMessage` into bytes and hands them off. There is
no acknowledgement handling, no LED/feedback protocol, no notion of whether
a device "received" anything beyond the transport accepting the bytes.
Device feedback behavior belongs to a device profile layer, not here.

## What's deliberately not here

- No Web MIDI or other real transport implementation.
- No mock/test device.
- No bidirectional wiring combining input and output on one port.
- No queuing, batching, or rate limiting of outgoing messages.
