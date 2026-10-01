# MIDI ↔ Control Mapping — Runtime

Status: Draft
Linear: [ECS-37](https://linear.app/ecs3d/issue/ECS-37/implement-basic-bidirectional-mappings) (initial implementation), [ECS-57](https://linear.app/ecs3d/issue/ECS-57/suppress-midi-feedback-echo-for-values-that-just-arrived-via-the-same) (echo suppression)
Depends on: [ECS-29](https://linear.app/ecs3d/issue/ECS-29/implement-midi-input) ([docs/contracts/input.md](./input.md)), [ECS-30](https://linear.app/ecs3d/issue/ECS-30/implement-midi-output) ([docs/contracts/output.md](./output.md)), [ECS-36](https://linear.app/ecs3d/issue/ECS-36/define-midi-control-mapping-contract) ([docs/contracts/mapping.md](./mapping.md))
Source of truth: [`src/mapping/bind.ts`](../../src/mapping/bind.ts)

## What this proves

`docs/contracts/mapping.md` (ECS-36) defined `ControlMapping` and the pure
conversion functions (`resolveIncomingValue()`, `buildFeedbackMessage()`)
but deliberately stopped short of wiring them to anything live — no code
reading a `MidiInput`, no code calling a `Control`'s `setValue()`. This
ticket is that wiring: `bindControlMapping()` proves the full round trip —
an incoming MIDI message updates an abstract `Control`, and a `Control`
value change sends MIDI back out — using only pieces that already exist.

## `bindControlMapping()`

```ts
function bindControlMapping<D extends ControlDef>(
  mapping: ControlMapping,
  input: MidiInput,
  output: MidiOutput,
  control: Control<D>,
): Unsubscribe;
```

Two independent subscriptions, matching the two directions the mapping
contract names:

- **MIDI → Control**: every message `input` delivers is passed to
  `resolveIncomingValue(message, mapping.source, control.def)`; a defined
  result is pushed into `control` via `setValue()`. A message that doesn't
  match the source, or whose kind doesn't pair with the control's kind, is
  silently ignored — the same "not every caller's concern" stance
  `resolveIncomingValue()` itself takes.
- **Control → MIDI**: only set up when `mapping.feedback` is present. Every
  `control.onChange()` is passed to
  `buildFeedbackMessage(mapping.feedback, control.def, value)`, and a
  defined result is sent through `output`. A mapping with no `feedback` is
  input-only, per `docs/contracts/mapping.md` — nothing is wired for it.

Both subscriptions are torn down together by the single `Unsubscribe`
`bindControlMapping()` returns.

## One mapping, one call

`bindControlMapping()` binds exactly one `ControlMapping` to exactly one
`Control`, mirroring `createMidiInput()`/`createMidiOutput()`'s own
per-port scope rather than introducing a batch/registry-driven API.
Binding a device's whole control layout (e.g. a future Launchpad profile's
set of `ControlMapping`s) is calling this once per mapping against
whichever `Control` a `ControlRegistry` resolves `mapping.control` to; nothing
here assumes a single input/output pair or forces mappings to be bound
together.

## Echo suppression, no device knowledge

`bindControlMapping()` is the one piece of code sitting between both
directions for a given `(mapping, control)` pair, so it's the one place
that can tell "this change came from MIDI" apart from any other caller of
`setValue()` (a UI, automation, another mapping): every resolved incoming
value is pushed onto a small queue *before* being pushed into `control`;
`onChange` is skipped exactly when it reports a value found anywhere in
that queue, since that's the control confirming a change this function
itself made (or several — see below), not a new one to echo. A match
drops everything queued up to and including it; a change whose value
isn't in the queue at all still sends feedback normally.

This was originally scoped out (ECS-37) on the reasoning that "this runtime
has no way to tell a MIDI-originated change apart from any other caller" —
real hardware testing (a Launchpad Mini custom-mode fader bank, surfaced in
webseq's ECS-38 integration) showed that reasoning was wrong for exactly
the case that matters most: a continuous control whose device reflects
incoming values as its own position/LED state (a touch fader, an LED ring)
fought itself on every move, because every value it reported back was
immediately echoed back to it. ECS-57 added the suppression above once
that was a concrete, observed problem rather than a hypothetical one.

**Why a queue, searched in full, not a single remembered value or only the
queue's front.** The first version of this suppression remembered only
the *one* most recently pushed-in value — against webseq's real `Control`
(dispatch now, notify on a later render) that leaked feedback: several
`setValue()` calls can happen before the *first* one's `onChange`
confirmation fires, each overwriting the single remembered value, so the
first confirmation no longer matches once it (eventually) arrives.

Moving to a FIFO queue matched only at its front fixed that lag case but
not a second, worse one: a direct capture of a Launchpad Mini's fader
(bypassing the browser and webseq entirely, with real timestamps) showed
it sends CC in **bursts** — roughly 8 messages ~1ms apart, then a
200–450ms pause — not a steady stream. A UI's render cycle easily catches
up during the pause but can't keep pace *within* a burst, so several
`setValue()` calls land before a single render notifies `onChange` once,
for the burst's *final* value only — the intermediate ones are never
individually confirmed. Matching only the queue's front left those
skipped entries stuck at the front forever, so every later confirmation
(including the next burst's) mismatched against a stale value and leaked
through as feedback — compounding, since nothing ever drained it.
Searching the whole queue for a match, and dropping everything up to and
including it, fixes this: a confirmation for a later value is treated as
accounting for everything queued before it too, not left waiting for
individual confirmations that will never come.

See `src/mapping/bind.ts`'s doc comment and the "lagging Control" /
"coalesced burst" tests in `src/mapping/bind.test.ts` for the exact
reproductions of both failure modes.

What's still true: this needs no device knowledge, and still doesn't
compare values for anything other than detecting its own just-made
change(s) (no clamping/rounding/dedup beyond that). A `Control`
implementation that transforms a value before storing/reporting it (so
the `onChange` value doesn't exactly equal what was pushed in) simply
won't get suppression for that change — feedback fires as it always did,
not a regression. Likewise, if a particular `setValue()` call is a no-op
(its resolved value matches what the control already holds, so no
`onChange` ever fires for it), that entry never leaves the queue via a
matching confirmation and can end up matched against a later, unrelated
`onChange` that happens to carry the same value — a narrow, documented
edge case rather than something this runtime guards against with
out-of-order matching, session windows, or control-reported transaction
ids.

Nothing here knows what a `Control` is backed by, or what kind of device
`input`/`output` talk to. Proven against the mock device
(`src/mapping/bind.test.ts`); a real round trip against hardware (e.g. the
Launchpad Mini used to validate ECS-31) still only exercises the same
generic path — Core and the mapping layer stay unaware a Launchpad is on
the other end.

## What's deliberately not here

- **No `ControlRegistry` wiring** — `bindControlMapping()` takes a
  `Control` directly, not a `ControlId` resolved through a registry. A
  caller that wants to resolve `mapping.control` dynamically (e.g. a
  control appearing/disappearing) composes that itself; it isn't this
  ticket's concern.
- **No device profiles** — nothing here names a collection of
  `ControlMapping`s as "the mapping for a Launchpad," or knows about any
  specific controller. That's ECS-39.
- **No curves or conditions** — same extension points
  `docs/contracts/mapping.md` already named as deliberately undesigned;
  this ticket implements the contract as defined, not more.
- **No cross-mapping or session-level echo suppression** — ECS-57's
  suppression is scoped to one `bindControlMapping()` call's own
  just-made change; it has no notion of "soft takeover," a time window, or
  coordinating across multiple mappings/controls. A device-specific
  takeover behavior is a profile-layer (ECS-39) concern, not this one.
