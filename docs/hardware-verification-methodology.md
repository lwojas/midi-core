# Live Hardware Verification: Methodology

Status: Draft
Companion to: [docs/device-integration-guide.md](./device-integration-guide.md) (architecture),
[docs/hardware-validation.md](./hardware-validation.md),
[docs/hardware-validation-push-mk1.md](./hardware-validation-push-mk1.md)
Example script: [`scripts/push-mk1-contract-probe.mjs`](../scripts/push-mk1-contract-probe.mjs)

## Purpose

Device profiles may be based on offline research that contains incorrect
CC or control-label claims. Verify unresolved protocol questions against a
real device before treating them as facts. The following method makes those
checks repeatable and easier to interpret.

## What didn't work: fixed-timer, multi-phase scripts

The first version of the Push mk1 probe ran several phases back-to-back on
a hardcoded clock ("turn the encoder clockwise — 10 seconds"). In practice
this produced two failures:

- **Time pressure with no payoff.** A person locating the right physical
  control (especially one whose printed label is hard to read, see below)
  routinely needs longer than a guessed interval, and a countdown that
  isn't met just wastes the whole phase.
- **Confusing hand-offs.** Chaining several different controls (a button,
  then Encoder 1, then a different encoder) into one uninterrupted script
  run is hard to follow in real time and easy to get out of sync with.

## What worked

**1. Identify the control via its own feedback, not a printed label.**
Don't ask "press the button labeled Shift" — labels can be hard to read
unlit, or (as happened here) simply wrong. Instead, drive the device's own
feedback mechanism to show which physical control is under test:

- A button with `monochrome-led`/`velocity-color-led` feedback: send its
  feedback CC/note at full value, ask the person to look at (and/or press)
  whatever just lit, then turn it back off.
- A control identified by on-screen text (an LCD-equipped device, or any
  control whose neighboring display segment names it): write the
  instruction directly to that segment instead of describing a position in
  words.

This also checks the feedback path: if the light or text never appears, that
is itself a result to investigate, not a reason to guess which control was
tested.

**2. Wait for a quiet period, not a clock.** Each step should have no
deadline until the first relevant MIDI event arrives, then resolve shortly
after the stream of matching events goes quiet (`waitForQuiet()` in the
example script: no timer starts until a match, then a short debounce after
the last one). This removes operator pressure entirely — the person acts
at their own pace, and the script advances itself. Keep a generous backstop
timeout only as a safety net against a truly dead run (device unplugged,
wrong port), not as a visible countdown.

**3. One action per script invocation.** Resist bundling multiple controls
into one long run with several phases. A single-purpose CLI step
(`node scripts/push-mk1-contract-probe.mjs shift49`) that does exactly one
thing and exits is easier to reason about, easier to re-run in isolation
when something looks wrong, and lets the operator and the person running
the session agree on what's being tested before each one runs.

**4. Cross-reference more than one independent source before trusting
either.** A single hands-on verification doc's "no flagged mismatches"
summary did not hold up under direct re-testing here (CC 34/35). Treat
blanket claims in an existing research doc as a hypothesis to confirm, not
a settled fact, and when available, check a second independent source
(here: an unofficial diagram by a different, named author) before writing
the resolution down as fact. Two independent sources agreeing is much
stronger evidence than either alone.

**5. Read cited source material in full.** An abbreviated placeholder in a
code comment is not a substitute for the byte table or protocol detail in
the cited source document.

## Applying this to a new device or a new open question

1. Write (or copy) a small single-purpose script using `@julusian/midi`
   directly against the device's real port — see
   `scripts/node-midi-transport.mjs` for the shared port-finding helper,
   and `scripts/push-mk1-contract-probe.mjs` for the `waitForQuiet()`
   pattern and feedback-based identification.
2. One exported step per open question, selected by a CLI argument. Light
   or label the control under test before asking for input.
3. Run one step, read the raw bytes, confirm or refute with the person at
   the keyboard — don't move to the next step until the current one's
   result is agreed on.
4. Before writing a conclusion into a profile or a contract doc, check it
   against a second source if one exists (another research doc, an
   independent diagram, a different unit of the same device).
5. Record confirmed device-specific results with the relevant hardware
   documentation; keep this methodology device-agnostic.
