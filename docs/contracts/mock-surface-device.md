# Control Surface — Generic Mock Device and Test Harness

Status: Draft
Depends on: [docs/contracts/device-profile.md](./device-profile.md),
[docs/contracts/mock-device.md](./mock-device.md)
Related: [docs/control-surface-architecture.md](../control-surface-architecture.md)
Source of truth: [`src/profile/generic/mock-surface-profile.ts`](../../src/profile/generic/mock-surface-profile.ts),
[`src/testing/mock-surface-device.ts`](../../src/testing/mock-surface-device.ts),
[`src/testing/mock-surface-harness.ts`](../../src/testing/mock-surface-harness.ts)

## What this fills

`MOCK_SURFACE_DEVICE_PROFILE` is a fictional, non-vendor-specific device
with physical controls, a matching pair of mock MIDI ports, and a harness
that lets tests drive and inspect controls by `PhysicalControl` id
instead of hand-encoded bytes. It requires neither real hardware nor
vendor-specific knowledge.

## The profile: 8 knobs, 4 buttons, 8 pads, one grid

`MOCK_SURFACE_DEVICE_PROFILE` (`src/profile/generic/mock-surface-profile.ts`)
provides the following groups for exercising mixer, transport, and step
grid bindings:

| Group                  | Count | Address                 | Feedback                          | Proof need                                               |
| ---------------------- | ----- | ----------------------- | --------------------------------- | -------------------------------------------------------- |
| `knob-1`..`knob-8`     | 8     | CC 11–18, channel 0     | CC 11–18, channel 0, `main-out`   | Mixer: 8 controls → 8 track volumes, feedback ← volume   |
| `button-1`..`button-4` | 4     | note 101–104, channel 0 | none                              | Transport: buttons → play/stop/record(/spare)            |
| `pad-1`..`pad-8`       | 8     | note 37–44, channel 0   | note 37–44, channel 0, `main-out` | Step Grid: grid → steps, feedback ← active step/playhead |

Knobs provide input and feedback. A `"note"`
address can only pair with a boolean control
(`docs/contracts/mapping.md`'s source/target table), so demonstrating
_numeric or enum_ feedback (track volume, transport status) needed a
CC-addressed feedback target, modeled by a motorized fader/LED-ring
encoder that reports position and accepts a position-set on the same
CC. Buttons remain input-only.

The pads are the grid's cells — one `ControlGrid` (`"step-grid"`, 1 row
× 8 columns) lays them out in a row, sufficient for step input and
playhead feedback.

**No application meaning anywhere in the profile.** Labels are
`"Knob 1"`, `"Button 1"`, `"Pad 1"` — not `"Track 1 Volume"` or
`"Play". This keeps physical control/protocol definitions in the profile
and application meaning out of it, preserving the boundary
`docs/architecture.md`already draws ("a`PhysicalControl`names a
button, not a mute"). Which`ControlId` a role resolves to, and which
button means "play," is owned by surface bindings and generation, not
this profile.

**Every address resolves a concrete `channel` (`0`).** Nothing about a
fictional device is partially known, so there's no
reason to leave anything unresolved here.

**No `sysex`/`setup`.** Nothing about this device needs either, and
adding one — even a trivial "do nothing" one — would invent device detail
without a need.

`src/profile/generic/mock-surface-profile.test.ts` runs
`validateDeviceProfile()` against it directly: zero diagnostics,
proving the profile is itself a valid document by the same checks a real
one would be held to, not just structurally typed.

## `createMockSurfaceDevice()`: the profile, paired with real mock ports

`src/testing/mock-surface-device.ts` pairs `MOCK_SURFACE_DEVICE_PROFILE`
with a real `MockMidiInput`/`MockMidiOutput` pair
(`docs/contracts/mock-device.md`) whose ids match the profile's
own `"main-in"`/`"main-out"` — using mock/generic MIDI I/O through MIDI
Core and reusing its existing mock transport rather than a second,
parallel fake. Anything built against
this — a `ControlSurface`, or, for now, the harness below — goes through
Core's real `MidiInput`/`MidiOutput` shapes; it never needs to know it
isn't real hardware.

## `createMockSurfaceHarness()`: by `PhysicalControl` id, not raw bytes

`src/testing/mock-surface-harness.ts` provides input and feedback
inspection: `press()`/`release()`/`turnKnob()`
look up a `PhysicalControl`'s declared `input` address and emit the
matching encoded message on `MockMidiInput`; `decodedFeedback()`/
`lastFeedbackFor()` decode everything sent through `MockMidiOutput` and
(for the latter) match it back to a specific control's declared
`feedback` address. A test presses `"pad-3"`; it never needs to know pad
3 is note 39.

Each method throws rather than silently doing something unintended for a
mismatched call — `press()` on a knob, `turnKnob()` on a button, any
method against an id not on the profile — the same "a caller's own bad
input is a programming error worth surfacing immediately" stance
`MidiOutput.send()`/`Control.setValue()` already take, rather than this
harness guessing at what was meant.

## What's deliberately not here

- **No `ControlSurface`, bindings, or mode switching** — this document
  describes the device and harness only; runtime wiring and binding
  generation are separate responsibilities.
- **No general device profiling tooling** — this is one fixed, fictional profile, not a generator or
  template for arbitrary device shapes.
- **No real hardware, no Launchpad-specific knowledge** — the whole
  point; every address is invented for this profile alone.
- **No SysEx/setup simulation** — this device doesn't have either; a future profile that needs setup against a mock would need its own profile, not an addition to this one.
