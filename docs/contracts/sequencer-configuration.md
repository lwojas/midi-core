# Sequencer Configuration — Contract (ECS-95, ECS-96)

## Purpose

`createSequencerBindings(input, profile, contract, devices?)` in `src/configurations/sequencer.ts` builds the
binding table for a sequencer on a device. The sequencer names its controls and actions with the
`SequencerContract`. The configuration maps the device's roles (from the profile's `layout` and `modes`) onto
those names. The sequencer never sees pads, CCs, notes or SysEx.

This document covers the fader parts (ECS-96). The step and track parts are in the `SequencerContract` type's own
doc comments.

## SequencerContract: fader fields

- **`faderActions`** — `{ pageUp?, pageDown?, pageLeft?, pageRight? }`, each an `Action`. The page arrows of the
  fader modes. A page turn is a request to the application: the application decides which tracks the faders show.
  An arrow left out has no binding. The configuration resends the bank before the application's action runs.
- **`faderTemplates`** — `Record<bankId, string>`. The application control for each fader in a bank, where
  `{index}` is the fader's position in its bank, 0 to 7, left to right. A bank with no template has no fader mode,
  and its mode button is not shown on that device.
- **`colours`** — `Partial<{ steps, mutes }>` (ECS-95). Left out, each takes `DEFAULT_SEQUENCER_COLOURS`.

## Fader count (ECS-102)

`sequencerFaderCount(profile)` is the number of faders one page of the mixer shows: the smallest fader count among
the profile's fader banks, or 0 when there are none. The application sizes its fader pages with it, so a page
never assumes the device's count. The Launchpad's count is 8.

## SequencerDevices

The device ports the fader modes need. These are the ports the application has, not the ones that connected:

- **`outputs`** — output ports by profile id. A mode sends on the output its `sendPortId` names.
- **`inputs`** — input ports by profile id, for a mode's own inputs (the DAW port's arrows).

Without `devices`, no fader mode is built.

## Which fader modes exist

A fader mode is built for a profile mode and a bank when all of these hold:

1. `devices.outputs` has the mode's `sendPortId`.
2. Every id in the mode's `requiredPortIds` is in `devices.outputs` or `devices.inputs`.

## Connection (ECS-104)

Whether a supplied port connects is decided when the surface attaches. A port that fails to connect is left closed.
Each fader mode carries its `requiredPortIds` into the surface's mode definition. The surface refuses to enter the
mode while any of them isn't connected: the switch is refused, the surface stays in its mode, and a
`port-unavailable` error is reported. No fader setup is sent to the device for a refused mode.

A bank also needs both of these to get a mode:

- The contract has a `faderTemplates` entry for the bank's id.
- The profile has a control for each fader, named as the bank and index define it.

Its mode id is `faders-<bankId>`. A mode button that names a `faders-` mode with no built mode is left out, and
its button is not bound.

## Sending on enter and leave

- **Enter:** the mode's `activate` messages, then the bank message, then `showLayout`.
- **Page turn:** the bank message is resent, then the application's page action runs.
- **Leave:** the mode's `deactivate` messages.

The bank message is the profile's `bankPrefix`, then one entry per fader (index, type, CC, colour), then F7.
