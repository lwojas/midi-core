# Hardware Validation: Novation Launchpad Mini MK3

Profile: [docs/contracts/launchpad-mini-mk3-profile.md](./contracts/launchpad-mini-mk3-profile.md)
Implementation: [src/profile/devices/launchpad-mini-mk3.ts](../src/profile/devices/launchpad-mini-mk3.ts)
Live runner: [scripts/launchpad-live.mjs](../scripts/launchpad-live.mjs)

## Current validation results

| Area              | Result | Evidence                                                                                                          |
| ----------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| Lifecycle         | Pass   | Attach and detach complete; both ports close cleanly.                                                             |
| Programmer mode   | Pass   | Device echoes the mode-switch SysEx `F0 00 20 29 02 0D 0E 01 F7`.                                                 |
| Pad input         | Pass   | Note 11-88 press and release reaches the app as the expected pad state.                                           |
| Button input      | Pass   | Top-row CC 91-98 and side-column controls decode on channel 0 in Programmer mode.                                 |
| Pad feedback      | Pass   | Application-driven set-all-on/off lights and clears all 64 pads; press-while-held feedback works.                 |
| Steps mode        | Pass   | Pads drive their corresponding controls; top-row controls are ignored.                                            |
| Transport mode    | Pass   | Top-row controls trigger play/stop/record/clear; pads do not change application state.                            |
| Note release      | Pass   | Note On with velocity 0 resolves to off.                                                                          |
| Fader modes       | Pass   | Volume, pan, and send banks report on channel 5 over the DAW port; fader color follows application level updates. |
| Fader paging      | Pass   | In webseq, DAW-port arrows page tracks and the fader bank is resent for the new page.                             |
| DAW-mode recovery | Pass   | Holding Session and pressing the bottom side-column button returns the device to Programmer layout.               |

## Protocol observations

- Programmer mode is layout `7F`; DAW Faders is layout `0D` and is available in DAW mode. DAW mode is controlled separately with SysEx `F0 00 20 29 02 0D 10 01 F7`; the DAW Fader layout uses `F0 00 20 29 02 0D 00 0D F7`.
- Fader-bank setup uses `F0 00 20 29 02 0D 01 00 <orientation> <fader>... F7`. Fader positions use channel 5; the confirmed volume, pan, and send CC ranges are 80-87, 88-95, and 102-109 respectively. Position feedback does not move the physical faders. Fader colors can represent application levels using palette indices 1-127; index 0 turns the fader off.
- In DAW Fader layout, pads, arrows, side buttons, and fader messages arrive on DAW Out, not MIDI Out. In Programmer layout, side-column controls are available on the main MIDI port. Optional DAW ports must be opened for fader-mode bindings.
- Session and Custom-mode layout changes can be silent. In DAW mode, holding Session for about half a second and pressing the bottom side-column button (CC 19) returned the device to Programmer layout. This device-level recovery path is independent of application navigation.
- Note On velocity 0 is the pad-release form. Top-row and side-column buttons use CC messages in Programmer mode.

## Remaining limitations

After a page turn, fader LEDs may not immediately show the new page's levels even though the bank is resent; the cause is not established. Transport has no assigned Launchpad mode button in the current sequencer configuration. Pan and send fader controls are not exposed by webseq.
