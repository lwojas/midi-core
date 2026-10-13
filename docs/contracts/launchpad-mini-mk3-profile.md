# Device Profile — Novation Launchpad Mini [MK3]

Status: Draft
Evidence: midi-profiler repo, `profiles/novation-launchpad-mini-mk3/report.json`
Source of truth: [`src/profile/devices/launchpad-mini-mk3.ts`](../../src/profile/devices/launchpad-mini-mk3.ts)

## Purpose

A real-device `DeviceProfile` for the Novation Launchpad Mini [MK3].

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
- Pads and buttons carry `rgb-led` feedback on `midi-out`. Each LED is
  lit by a device SysEx, `F0 00 20 29 02 0D 03 03 <LED> <red> <green> <blue> F7`,
  with the prefix in `rgbSysExPrefix` and each colour 0-127. The LED index is the
  pad's note or the button's CC. Colour is chosen by the binding, so the same
  pad can be a blue step in one mode and a red mute in another.
- **One grid**: `pads`, 8x8, cells mapping row/column to `pad-<note>`.
- **SysEx**: manufacturer id `00 20 29`, `required: false`.
- **Setup** (`docs/contracts/device-setup.md`): Device Inquiry request, Device
  Inquiry reply (checked; the four revision bytes are wildcards), and the Programmer-mode switch.
  Runs on `midi-in`/`midi-out` on every connect.

## Feedback port

Every control with `feedback` has `feedbackPortId: "midi-out"`, since feedback
and input travel on different physical ports. Without it,
`generateControlMappings()` defaults the feedback port to `portId` (`midi-in`,
an input port), and `bindSurfaceMode()` drops every feedback-bearing mapping.
`validateDeviceProfile()` only checks a `feedbackPortId` that is present.

## Layout

The sequencer's roles on this device, as the profile's default:

| Role                                    | Control                                                  |
| --------------------------------------- | -------------------------------------------------------- |
| Mode buttons: steps / mixer             | side-89 / side-79 (side-69 is free for the mixer faders) |
| Page up / down (tracks)                 | top-91 / top-92 (the arrows)                             |
| Page left / right (time)                | top-93 / top-94 (the arrows)                             |
| Transport: play / stop / record / clear | side-59 / side-49 / side-39 / side-29                    |

The first four top-row buttons are the arrows, per the device's user guide.
Their order (up, down, left, right, from the left) is an assumption, not yet
confirmed on hardware. Transport moved to the side column because the arrows
take CC 91-94. Paging up and down moves by eight tracks, and the window stops
at the track count the application provides. The mixer lays its eight tracks
across the top row, as its UI does, so left and right page it through the
tracks eight at a time, and up and down do nothing there.

## Modes

`mixer-faders`: the DAW Fader layout, eight faders on `daw-in`/`daw-out` (channel 5 for
fader moves, channel 6 for fader colour). It needs the DAW ports, so it is unavailable on
a Launchpad without them. Entering sends DAW mode on, the bank, then the layout; leaving
sends the Programmer layout and DAW mode off. Each bank's CCs are fixed in the profile
(volume 80-87, pan 88-95, send 102-109); the sequencer sends the bank to make them live.

## Deliberately not modeled

The generated evidence's own `unresolved` list, unchanged: the Session/DAW-Fader
address scheme on the DAW ports, the bootloader pad layout, global brightness
and LED-feedback configuration SysEx, and generic (non-positional) button labels.
Programmer mode is the only mode this profile addresses. The mixer's faders
are not modeled, because the device only exposes them in DAW mode, on a separate
layout.

## Validation

`src/profile/devices/launchpad-mini-mk3.test.ts`: zero diagnostics from
`validateDeviceProfile()`, 81 unique control ids, pad note numbering matches
the device's row-major layout, the pad grid covers every pad exactly once, every
feedback routes to `midi-out`, and button/pad address types and channels.
