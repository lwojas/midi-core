# MIDI Core — Normalized Message Model

Status: Draft
Linear: [ECS-28](https://linear.app/ecs3d/issue/ECS-28/define-normalised-midi-message-model)
Depends on: [ECS-26](https://linear.app/ecs3d/issue/ECS-26/define-midi-core-architecture-and-boundaries) ([docs/architecture.md](../architecture.md))
Related: [ECS-27](https://linear.app/ecs3d/issue/ECS-27/define-midi-device-discovery-and-lifecycle-contract) ([docs/contracts/discovery-lifecycle.md](./discovery-lifecycle.md))
Source of truth: [`src/core/types/message.ts`](../../src/core/types/message.ts), [`src/core/message/codec.ts`](../../src/core/message/codec.ts)

## Scope

A conservative normalized model for the message kinds Core needs to carry
faithfully: Note On/Off, Control Change, Pitch Bend, Program Change, Channel
and Polyphonic aftertouch, the system real-time messages useful for
transport sync (clock/start/continue/stop), and SysEx kept opaque. Everything
else Core doesn't model — other system common messages, Active Sensing,
System Reset, malformed input — decodes to `UnknownMessage`.

This does not cover discovery/lifecycle (ECS-27) or actually wiring a
transport (ECS-29/30) — just the shape of a message and how it converts to
and from wire bytes.

## What "normalized" means here

Normalization combines multi-byte protocol fields into single values — e.g.
pitch bend's two 7-bit bytes become one `0–16383` value with a documented
center of `8192`, rather than exposing `msb`/`lsb` separately. It does **not**
mean Core reinterprets meaning.

The clearest example: a Note On with velocity 0 decodes to `NoteOnMessage`
with `velocity: 0`, not to `NoteOffMessage`. Many MIDI implementations treat
the two as equivalent (it saves a byte under running status), but that's a
convention applications may choose to apply, not a structural fact about the
message. Rewriting it in Core would be Core making an application-level
judgment call — exactly what the architecture boundary (ECS-26) excludes.

## Channel is 0-15, not 1-16

`Channel` is the integer straight out of the status byte's low nibble
(`0–15`), not the musician-facing `1–16` convention. This avoids Core doing
an implicit +1/-1 conversion that every consumer would then have to know
about or double-guess. A UI or profile layer is free to display `channel + 1`
to a human; Core stays literal.

## Raw byte retention

Every message type carries an optional `raw: Uint8Array` — the exact bytes it
was decoded from.

- For the **fully modeled** types (all channel-voice and real-time messages),
  `raw` is present after a decode but is never consulted by `encodeMidiMessage`
  — encoding always re-derives bytes from the normalized fields. This means a
  message you build by hand (no `raw`) encodes identically to one that was
  decoded, and a stale `raw` left over from a decode can never cause encode to
  diverge from the fields you actually set. One rule, no "which one wins"
  ambiguity.
- For **`SysExMessage`** and **`UnknownMessage`**, `raw` is required, because
  Core has no fields to derive bytes from — `raw` *is* the message. This is
  what makes a receive-then-resend round-trip faithful even for the things
  Core doesn't understand.

## Decode is total, encode is not

`decodeMidiMessage` never throws. Truncated data, out-of-range bytes, or a
status byte Core doesn't model all fall back to `UnknownMessage` carrying the
original bytes. This matters because decode sits on the input path from real
hardware — a single malformed or unusual message shouldn't be able to throw
and take down a live input handler; it should just come through as something
Core admits it doesn't understand.

`encodeMidiMessage` does throw (`MidiEncodeError`) on out-of-range fields
(e.g. `channel: 16`, `velocity: 200`). Encode's input is the caller's own
constructed data, not external device bytes, so an invalid value there is a
programming error worth surfacing rather than silently producing malformed
wire bytes.

`decodeMidiMessage` assumes it's given one complete message's bytes (as Web
MIDI's `MIDIMessageEvent.data` already provides) — it does not parse a
multi-message stream or handle running status. That's a transport-level
framing concern for ECS-29, not a message-model concern.

## What's deliberately not here

- No note-name/musical helpers, no meaning assigned to CC numbers, no
  application-level rescaling (e.g. pitch bend to `-1..1`) — those are
  mapping/application concerns.
- No running-status decoding or multi-message stream parsing.
- No SysEx content interpretation (manufacturer ID parsing, etc.).
- No wiring to a real or mock transport — that's ECS-29/30/32.
