# Editing the Push's sequencer colours

All of the Push Mk1's sequencer LED colours are set in one place: the **COLOUR CONFIGURATION** block at the top of
[`src/profile/devices/push-mk1.ts`](../src/profile/devices/push-mk1.ts). Nothing else needs to change to restyle
the grid or the mute buttons.

## What can be styled

| Entry                         | Where it shows                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GRID_COLOURS.stepEven`       | A note start (an active step) on an **even track row** (rows 1, 3, 5... on screen, 0-based 0, 2, 4...) |
| `GRID_COLOURS.stepOdd`        | A note start on an **odd track row**                                                                   |
| `GRID_COLOURS.stepLengthEven` | The continuation cells of a longer note on an even track row                                           |
| `GRID_COLOURS.stepLengthOdd`  | The continuation cells of a longer note on an odd track row                                            |
| `GRID_COLOURS.playhead`       | The pad under the playhead; overrides every other colour on that pad                                   |
| `MUTE_COLOURS.muted`          | A track's mute button while the track is muted                                                         |
| `MUTE_COLOURS.unmuted`        | A track's mute button while the track is not muted                                                     |

Rule: **the track row's parity picks Even/Odd; whether the cell starts a note or continues one picks
Step/StepLength.** The column never matters. The row is the track's own index, so the pattern holds across track paging.

```text
             step       length     length     length
Track 1      EVEN       EVEN       EVEN       EVEN
Track 2      ODD        ODD        ODD        ODD
Track 3      EVEN       EVEN       EVEN       EVEN
```

## How to change a colour

Every entry is a `{ colour, velocity }` pair:

```ts
stepOdd: { colour: { red: 0, green: 100, blue: 0 }, velocity: 22 }, // green
```

- **`velocity`** is what actually lights the LED. The Push's pads and mute strip are `velocity-color-led`s: the
  device maps a raw velocity (pads) or CC value (mute strip) to a colour from its own fixed table. **To get a
  different colour, change the `velocity`.**
- **`colour`** is only the label the sequencer asks for. The Push is never sent it as RGB; it is looked up, by exact
  match, in the palette built from these same entries to find the velocity. So it does not need to look like the
  real colour, but:
  - it must be **different between roles** (two roles with identical `colour` resolve to the first entry's velocity,
    and the second role's velocity is ignored);

Edit the entry in place: the layout and the palette are both built from it, so they cannot drift apart.

## Choosing a velocity

The Push has no documented velocity-to-colour table. These are the bytes that have been confirmed or tried here (see
[`hardware-validation-push-mk1.md`](hardware-validation-push-mk1.md)):

| Byte  | Shows                         | Status                                                                    |
| ----- | ----------------------------- | ------------------------------------------------------------------------- |
| `127` | Full-on / default step colour | In use before this scheme; as a pad colour it is what steps always showed |
| `36`  | Teal                          | Confirmed on a pad                                                        |
| `22`  | Green                         | Confirmed on the selection buttons; not yet checked on pads in this role  |
| `6`   | Red                           | Confirmed on the upper control row; not yet checked on pads in this role  |
| `2`   | Brighter white                | From the hands-on ramp; unverified on pads                                |
| `1`   | Dim white                     | From the hands-on ramp; unverified on pads                                |

To try another colour, set a different `velocity` (0-127), rebuild, and look at the real device.
`scripts/push-mk1-pad-color-probe.mjs` steps a single pad through raw velocities by hand, which is the quickest way
to find a byte you like.

## Making a change

1. Edit the `velocity` (and, if adding a new role, its `colour`) in `GRID_COLOURS` / `MUTE_COLOURS`.
2. `npm run build`; `npm test`. `src/configurations/sequencer-colours.test.ts` asserts the exact velocities, so
   update the numbers there to match.
3. Check on a real Push (User Mode). The tests only prove that the byte is sent, not what colour it shows.

## Overriding from an application

The Push's scheme is a device default. An application can still override any of it through
`SequencerContract.colours` (`stepEven`/`stepOdd`/`stepLengthEven`/`stepLengthOdd`/`playhead`/`mutes`/`unmuted`);
precedence is the application's own, then the device layout, then the sequencer's built-in defaults. On the Push an
application colour only takes effect if it matches a palette entry's `colour`, otherwise the pad shows plain on/off,
so for the Push prefer editing the entries above. See
[`contracts/sequencer-configuration.md`](contracts/sequencer-configuration.md).

## Other devices

The Launchpad and other RGB-SysEx devices take the `colour` directly as RGB and have no `velocity`. Their colours
come from `DEFAULT_SEQUENCER_COLOURS` (`src/configurations/sequencer.ts`) or the application's contract. If
`stepOdd` is unset a device shows the even colour on every row, and an unset step-length colour is a dimmed step
colour.
