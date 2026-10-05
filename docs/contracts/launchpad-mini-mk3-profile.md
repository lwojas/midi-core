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
- Pads and buttons carry `velocity-color-led` feedback on `midi-out`.
- **One grid**: `pads`, 8x8, cells mapping row/column to `pad-<note>`.
- **SysEx**: manufacturer id `00 20 29`, `required: false`.
- **Setup** (`docs/contracts/device-setup.md`): Device Inquiry request, Device
  Inquiry reply (checked, byte 12 is a wildcard), and the Programmer-mode switch.
  Runs on `midi-in`/`midi-out` on every connect.

## Correction applied on import

Every control with `feedback` gets `feedbackPortId: "midi-out"`. The profiler's
evidence omitted it, even though feedback and input travel on different
physical ports here. Without it, `generateControlMappings()` defaults the
feedback port to `portId` (`midi-in`, an input port), and `bindSurfaceMode()`
then drops every feedback-bearing mapping entirely. `validateDeviceProfile()`
does not detect this, since it only checks a `feedbackPortId` that is present.
See [docs/hardware-validation.md](../hardware-validation.md) for the finding.

## Deliberately not modeled

The generated evidence's own `unresolved` list, unchanged: the Session/DAW-Fader
address scheme on the DAW ports, the bootloader pad layout, global brightness
and LED-feedback configuration SysEx, and generic (non-positional) button labels.
Programmer mode is the only mode this profile addresses.

## Validation

`src/profile/devices/launchpad-mini-mk3.test.ts`: zero diagnostics from
`validateDeviceProfile()`, 81 unique control ids, pad note numbering matches
the device's row-major layout, the pad grid covers every pad exactly once, every
feedback routes to `midi-out`, and button/pad address types and channels.
