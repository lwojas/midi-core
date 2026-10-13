# MIDI ↔ Control Mapping — Runtime

Status: Draft
Source of truth: [`src/mapping/bind.ts`](../../src/mapping/bind.ts)

## What this proves

`bindControlMapping()` wires `ControlMapping` conversion to live MIDI
input and output: an incoming message updates a `Control`, and a control
value change sends MIDI feedback when the mapping declares a target.

## `bindControlMapping()`

```ts
function bindControlMapping<D extends ControlDef>(
  mapping: ControlMapping,
  input: MidiInput,
  output: MidiOutput,
  control: Control<D>,
  options?: { shouldApply?: () => boolean },
): Unsubscribe;
```

Two independent subscriptions, matching the two directions the mapping
contract names:

- **MIDI → Control**: every message `input` delivers is passed to
  `resolveIncomingValue(message, mapping.source, control.def)` — or, when
  `mapping.relativeEncoding` is set, to the same function with a
  `relative: { encoding, current: control.getValue() }` argument, so a
  relative encoder's delta accumulates onto the control's live value
  instead of being scaled directly. A defined result is pushed into
  `control` via `setValue()`. A message that doesn't match the source, or
  whose kind doesn't pair with the control's kind, is silently ignored —
  the same "not every caller's concern" stance `resolveIncomingValue()`
  itself takes. `options.shouldApply`, when supplied, is checked
  first on every message: a `false` result is treated exactly like a
  non-matching message (ignored, nothing queued for echo suppression).
  Omitted — the default, and every call site before this option existed —
  every matching message applies, unconditionally. This runtime has no
  idea what `shouldApply` actually checks; `src/surface/bindings.ts`
  (`docs/contracts/surface-bindings.md`) is what supplies a
  modifier-state predicate through it, keeping the word "modifier" itself
  out of this device-agnostic layer.
- **Control → MIDI**: only set up when `mapping.feedback` is present. Every
  `control.onChange()` is passed to
  `buildFeedbackMessage(mapping.feedback, control.def, value)`, and a
  defined result is sent through `output`. A mapping with no `feedback` is
  input-only, per `docs/contracts/mapping.md` — nothing is wired for it.
  `shouldApply`/`relativeEncoding` only affect the MIDI → Control
  direction; feedback is unaffected by either.

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
value is pushed onto a small queue _before_ being pushed into `control`;
`onChange` is skipped exactly when it reports a value found anywhere in
that queue, since that's the control confirming a change this function
itself made (or several — see below), not a new one to echo. A match
drops everything queued up to and including it; a change whose value
isn't in the queue at all still sends feedback normally.

Echo suppression is necessary for continuous controls whose device
reflects incoming values as its own position or LED state. Without it,
each reported value would be echoed back to the device.

**Why a queue, searched in full, not a single remembered value or only the
queue's front.** The first version of this suppression remembered only
the _one_ most recently pushed-in value — against webseq's real `Control`
(dispatch now, notify on a later render) that leaked feedback: several
`setValue()` calls can happen before the _first_ one's `onChange`
confirmation fires, each overwriting the single remembered value, so the
first confirmation no longer matches once it (eventually) arrives.

Moving to a FIFO queue matched only at its front fixed that lag case but
not a second, worse one: a direct capture of a Launchpad Mini's fader
(bypassing the browser and webseq entirely, with real timestamps) showed
it sends CC in **bursts** — roughly 8 messages ~1ms apart, then a
200–450ms pause — not a steady stream. A UI's render cycle easily catches
up during the pause but can't keep pace _within_ a burst, so several
`setValue()` calls land before a single render notifies `onChange` once,
for the burst's _final_ value only — the intermediate ones are never
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
`input`/`output` talk to. Mock and hardware round trips exercise the
same generic path — Core and the mapping layer stay unaware of the device.

## What's deliberately not here

- **No `ControlRegistry` wiring** — `bindControlMapping()` takes a
  `Control` directly, not a `ControlId` resolved through a registry. A
  caller that wants to resolve `mapping.control` dynamically (e.g. a
  control appearing/disappearing) composes that itself.
- **No device profiles** — nothing here names a collection of
  `ControlMapping`s as "the mapping for a Launchpad," or knows about any
  specific controller.
- **No curves** — still a deliberately undesigned extension point, per
  `docs/contracts/mapping.md`.
- **No knowledge of what a condition means** — `options.shouldApply`
  is a bare predicate this runtime calls and nothing more; it
  doesn't know "modifier," "soft takeover," or any other concrete
  condition. Supplying one is entirely the caller's (`src/surface/
bindings.ts`'s) job.
- **No cross-mapping or session-level echo suppression** — suppression
  is scoped to one `bindControlMapping()` call's own
  just-made change; it has no notion of "soft takeover," a time window, or
  coordinating across multiple mappings/controls. A device-specific
  takeover behavior belongs to the profile layer.

## Relative turns scale by the control's own metadata

A relative encoder's decoded delta is applied by `applyRelativeDelta()`
(`src/mapping/value.ts`) according to the target `ControlDef`, not by one
universal increment:

- **number**: one `step` per detent when the range has at most 256 step
  positions. Otherwise a range with `min > 0` and `max / min >= 100`
  (frequencies, times) moves by a constant ratio per detent, about 100
  detents end to end; any other range moves by `range / 100`, rounded up
  to a whole `step`. A turn always moves at least one `step`, and values
  clamp to `min`/`max`.
- **boolean**: the direction sets the value (clockwise on).
- **enum**: one option per turn in its direction, clamped at the ends.
- **string**: no relative meaning; ignored.

A faster turn arrives as a larger delta and counts as that many detents.
Windowed and selection-bound encoder targets accept number, boolean and
enum controls; the live target's own `def` decides the behavior.
