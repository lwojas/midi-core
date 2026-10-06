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

The device connection the fader modes need:

- **`outputs`** — connected output ports by profile id. A mode sends on the output its `sendPortId` names.
- **`inputs`** — connected input ports by profile id, for a mode's own inputs (the DAW port's arrows).
- **`connectedPortIds`** — every port the device has. A mode whose `requiredPortIds` are not all listed is
  unavailable.

Without `devices`, no fader mode is built.

## Which fader modes exist

A fader mode is built for a profile mode and a bank when all of these hold:

1. `devices.outputs` has the mode's `sendPortId`.
2. Every id in the mode's `requiredPortIds` is in `connectedPortIds`.
3. The contract has a `faderTemplates` entry for the bank's id.
4. The profile has a control for each fader, named as the bank and index define it.

Its mode id is `faders-<bankId>`. A mode button that names a `faders-` mode with no built mode is left out, and
its button is not bound.

## Sending on enter and leave

- **Enter:** the mode's `activate` messages, then the bank message, then `showLayout`.
- **Page turn:** the bank message is resent, then the application's page action runs.
- **Leave:** the mode's `deactivate` messages.

The bank message is the profile's `bankPrefix`, then one entry per fader (index, type, CC, colour), then F7.
