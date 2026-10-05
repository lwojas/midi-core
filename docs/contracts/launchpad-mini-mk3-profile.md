# Device Profile — Novation Launchpad Mini [MK3]

Status: Draft
Linear: [ECS-79](https://linear.app/ecs3d/issue/ECS-79/select-and-validate-one-real-device-with-the-surface-runtime)
Depends on: [docs/contracts/device-profile.md](./device-profile.md) (ECS-39),
[docs/contracts/profile-validation.md](./profile-validation.md) (ECS-42)
Evidence: midi-profiler repo, `profiles/novation-launchpad-mini-mk3/report.json`
(ECS-47 / ECS-62)
Source of truth: [`src/profile/devices/launchpad-mini-mk3.ts`](../../src/profile/devices/launchpad-mini-mk3.ts)

## Purpose

The first real-device `DeviceProfile` in this project. Selected for ECS-79's
hardware validation per the ticket's own criteria (documented MIDI
implementation, an inspectable third-party Ableton script, hardware on hand).
The profiler exercise that produced its evidence is treated as evidence of
feasibility, not as the selection itself.

## What it describes

- **Identity**: `novation.launchpad-mini-mk3`, "Novation" / "Launchpad Mini [MK3]".
- **Ports**: `midi-in`/`midi-out` (required, the Programmer-mode control
  surface this profile addresses); `daw-in`/`daw-out` (declared, not required,
  and not addressed by any control here).
- **81 controls**, all `channel: 0` in Programmer mode:
  - 64 pads, `kind: "pad"`, note `(8 - row) * 10 + (column + 1)`, row 0 = notes 81-88 down to row 7 = notes 11-18.
  - 8 top-row buttons, `kind: "button"`, CC 91-98 left to right.
  - 8 side-column buttons, `kind: "button"`, CC 89, 79, ... 19 top to bottom.
  - 1 logo button, `kind: "button"`, CC 99.
- Pads and buttons carry `rgb-led` feedback on `midi-out` (ECS-95). Each LED is
  lit by a device SysEx, `F0 00 20 29 02 0D 03 03 <LED> <red> <green> <blue> F7`,
  with the prefix in `rgbSysExPrefix` and each colour 0-127. The LED index is the
  pad's note or the button's CC. Colour is chosen by the binding, so the same
  pad can be a blue step in one mode and a red mute in another.
- **One grid**: `pads`, 8x8, cells mapping row/column to `pad-<note>`.
- **SysEx**: manufacturer id `00 20 29`, `required: false`.
- **Setup** (`docs/contracts/device-setup.md`): Device Inquiry request, Device
  Inquiry reply (checked; the four revision bytes are wildcards), and the Programmer-mode switch.
  Runs on `midi-in`/`midi-out` on every connect.

## Correction applied on import

Every control with `feedback` gets `feedbackPortId: "midi-out"`. The profiler's
evidence omitted it, even though feedback and input travel on different
physical ports here. Without it, `generateControlMappings()` defaults the
feedback port to `portId` (`midi-in`, an input port), and `bindSurfaceMode()`
then drops every feedback-bearing mapping entirely. `validateDeviceProfile()`
does not detect this, since it only checks a `feedbackPortId` that is present.
See [docs/hardware-validation.md](../hardware-validation.md) for the finding.

## Layout (ECS-90, ECS-95)

The sequencer's roles on this device, as the profile's default:

| Role | Control |
|---|---|
| Mode buttons: steps / mixer / transport | side-89 / side-79 / side-69 |
| Page up / down (tracks) | top-91 / top-92 (the arrows) |
| Page left / right (time) | top-93 / top-94 (the arrows) |
| Transport: play / stop / record / clear | side-59 / side-49 / side-39 / side-29 |

The first four top-row buttons are the arrows, per the device's user guide.
Their order (up, down, left, right, from the left) is an assumption, not yet
confirmed on hardware. Transport moved to the side column because the arrows
take CC 91-94. Paging up and down moves by eight tracks, and the window stops
at the track count the application provides. The mixer lays its eight tracks
across the top row, as its UI does, and paging moves that row to the next
eight tracks.

## Deliberately not modeled

The generated evidence's own `unresolved` list, unchanged: the Session/DAW-Fader
address scheme on the DAW ports, the bootloader pad layout, global brightness
and LED-feedback configuration SysEx, and generic (non-positional) button labels.
Programmer mode is the only mode this profile addresses. The mixer's faders
are not modeled, because the device only exposes them in DAW mode, on a separate
layout. See [docs/hardware-validation.md](../hardware-validation.md) (ECS-95).

## Validation

`src/profile/devices/launchpad-mini-mk3.test.ts`: zero diagnostics from
`validateDeviceProfile()`, 81 unique control ids, pad note numbering matches
the device's row-major layout, the pad grid covers every pad exactly once, every
feedback routes to `midi-out`, and button/pad address types and channels.
