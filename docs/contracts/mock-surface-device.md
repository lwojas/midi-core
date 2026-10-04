# Control Surface — Generic Mock Device and Test Harness

Status: Draft
Linear: [ECS-71](https://linear.app/ecs3d/issue/ECS-71/build-generic-mock-device-profile-and-test-harness)
Project: [MIDI Core and Control Architecture](https://linear.app/ecs3d/project/midi-core-and-control-architecture-f934a737de3b)
Depends on: [docs/contracts/device-profile.md](./device-profile.md) (ECS-39),
[docs/contracts/mock-device.md](./mock-device.md) (ECS-32)
Related: [docs/control-surface-architecture.md](../control-surface-architecture.md) (ECS-64)
Source of truth: [`src/profile/generic/mock-surface-profile.ts`](../../src/profile/generic/mock-surface-profile.ts),
[`src/testing/mock-surface-device.ts`](../../src/testing/mock-surface-device.ts),
[`src/testing/mock-surface-harness.ts`](../../src/testing/mock-surface-harness.ts)

## What this fills

Every proof step `docs/control-surface-architecture.md` scoped (one
profile generating bindings, round-tripping against a mock, then mode
switching — ECS-77) needs a profile with actual physical controls to
generate anything from. The only profile that exists so far
(`GENERIC_MIDI_DEVICE_PROFILE`, ECS-41) deliberately has none — it's a
protocol baseline, not a device. This ticket is the one that does: a
fictional, non-vendor-specific profile built from nothing but this
schema, a matching pair of mock MIDI ports, and a harness that lets a
test drive and inspect both by `PhysicalControl` id instead of hand-
encoded bytes — "without real hardware or Launchpad-specific knowledge,"
per the ticket.

## The profile: 8 knobs, 4 buttons, 8 pads, one grid

`MOCK_SURFACE_DEVICE_PROFILE` (`src/profile/generic/mock-surface-profile.ts`)
follows the ticket's shape directly, each group picked for a specific
later proof need (ECS-77's own description names exactly these three):

| Group | Count | Address | Feedback | Proof need |
|---|---|---|---|---|
| `knob-1`..`knob-8` | 8 | CC 11–18, channel 0 | none | Mixer: 8 controls → 8 track volumes |
| `button-1`..`button-4` | 4 | note 101–104, channel 0 | none | Transport: buttons → play/stop/record(/spare) |
| `pad-1`..`pad-8` | 8 | note 37–44, channel 0 | note 37–44, channel 0, `main-out` | Step Grid: grid → steps, feedback ← active step/playhead |

The pads are also the ticket's "eight feedback outputs" and the grid's
cells — one `ControlGrid` (`"step-grid"`, 1 row × 8 columns) laying them
out in a row, "a minimal profile-defined grid sufficient to demonstrate
step input/playhead feedback" per the ticket; nothing here needed a
second dimension to prove that.

**No application meaning anywhere in the profile.** Labels are
`"Knob 1"`, `"Button 1"`, `"Pad 1"` — not `"Track 1 Volume"` or
`"Play"` — per the ticket's "keep physical control/protocol definitions
in the profile and application meaning out of it," the same boundary
`docs/architecture.md` already draws ("a `PhysicalControl` names a
button, not a mute"). Which `ControlId` a role resolves to, and which
button means "play," is ECS-68/72's job, not this profile's.

**Every address resolves a concrete `channel` (`0`).** Unlike a profile
built from partial real-world evidence (ECS-62's `unresolved` case),
nothing about a fictional device is partially known, so there's no
reason to leave anything unresolved here.

**No `sysex`/`handshake`.** Nothing about this device needs either, and
adding one — even a trivial "do nothing" one — would be exactly the kind
of invented device detail the ticket's "do not expand this into general
device profiling" rules out.

`src/profile/generic/mock-surface-profile.test.ts` runs
`validateDeviceProfile()` (ECS-42) against it directly: zero diagnostics,
proving the profile is itself a valid document by the same checks a real
one would be held to, not just structurally typed.

## `createMockSurfaceDevice()`: the profile, paired with real mock ports

`src/testing/mock-surface-device.ts` pairs `MOCK_SURFACE_DEVICE_PROFILE`
with a real `MockMidiInput`/`MockMidiOutput` pair
(`docs/contracts/mock-device.md`, ECS-32) whose ids match the profile's
own `"main-in"`/`"main-out"` — the same "use mock/generic MIDI I/O
through MIDI Core" the ticket asks for, reusing Core's existing mock
transport rather than a second, parallel fake. Anything built against
this — a `ControlSurface`, or, for now, the harness below — goes through
Core's real `MidiInput`/`MidiOutput` shapes; it never needs to know it
isn't real hardware.

## `createMockSurfaceHarness()`: by `PhysicalControl` id, not raw bytes

The ticket's "harness to inspect input and feedback" is
`src/testing/mock-surface-harness.ts`: `press()`/`release()`/`turnKnob()`
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

- **No `ControlSurface`, no bindings, no mode switching** — this ticket
  is the device and the harness only; wiring them into the Control
  Surface runtime (ECS-69), generating real bindings against this
  profile (ECS-72), or demonstrating Mixer/Transport/Step Grid end to end
  is ECS-77, built on top of what this ticket produces.
- **No general device profiling tooling** — per the ticket's own
  warning. This is one fixed, fictional profile, not a generator or
  template for arbitrary device shapes.
- **No real hardware, no Launchpad-specific knowledge** — the whole
  point; every address is invented for this profile alone.
- **No SysEx/handshake simulation** — this device doesn't have either;
  a future profile that needs to exercise `HandshakeExecutor`
  (`docs/contracts/surface-lifecycle.md`) against a mock would need its
  own profile, not an addition to this one.
