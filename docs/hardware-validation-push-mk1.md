# Hardware Validation: Ableton Push 1 (Mk1)

Device profile: [src/profile/devices/push-mk1.ts](../src/profile/devices/push-mk1.ts)
Live runner: [scripts/push-mk1-live.mjs](../scripts/push-mk1-live.mjs)
Colour settings: [push-colours.md](push-colours.md)

The live runner uses CoreMIDI through `@julusian/midi` and midi-core's `RawMidiInput`/`RawMidiOutput` interfaces. The device must be put into User Mode with its physical User button before connecting; no verified setup handshake is available.

## Current validation results

| Area              | Result | Evidence                                                                                                       |
| ----------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| Lifecycle         | Pass   | Attach and detach complete; the port closes cleanly.                                                           |
| Pad feedback      | Pass   | LED sweep lit and cleared all 64 pads.                                                                         |
| Pad input         | Pass   | Press toggles the corresponding step control and lights that pad.                                              |
| Paging            | Pass   | Arrow CC 44-47 move the grid's virtual window.                                                                 |
| Mode selection    | Pass   | Note CC 50 selects steps; Session CC 51 is unassigned.                                                         |
| Transport         | Pass   | Play CC 85, Stop Clip CC 29, and Record CC 86 are bound as transport controls without requiring a mode switch. |
| Track mute        | Pass   | Upper control row CC 102-109 controls mute in steps and transport views.                                       |
| Step continuation | Pass   | A note spanning two page turns retains continuation feedback on both following pages.                          |

## Confirmed protocol observations

- Note and Session are CC 50/51. Stop Clip is CC 29. The navigation diamond is CC 44-47; CC 59 is a Live/User mode toggle, not a User Mode button.
- Shift is CC 49. A separate Select/Shift pair at CC 34/35 is not present on the tested unit.
- Encoder 1 (CC 71) and the Tempo encoder (CC 14) use signed 7-bit two's-complement deltas. Values below 64 decode as themselves; values 64 and above decode as `value - 128`. Clockwise turns produce 1 (sometimes 2); counter-clockwise turns produce 127, 126, and lower values. The other encoders are declared to use the same scheme but were not independently checked.
- Push LCD SysEx line identifiers are `0x18`, `0x19`, `0x1A`, and `0x1B` for lines 1-4.
- Play CC 85 and Shift CC 49 support off at value 0, dim steady at 1, dim blink at 2-3, full steady at 4, and full blink at 5-6; values above 6 clamp to full. The upper control row and pads use color-valued feedback rather than monochrome feedback.
- Pad velocity 36 produces a confirmed teal/green-blue playhead color. The upper control row CC 102-109 and selection side buttons CC 36-43 use color-valued feedback. Selection feedback values 10 (resting) and 22 (selected) were confirmed on hardware.
- Play, Stop, and Record are available without replacing the step grid. The upper control row provides mute independently of the pad grid.

## Remaining unverified

- Encoders other than Encoder 1 and the Tempo encoder have not been individually checked for relative encoding.
- The grid formula has been checked at representative points, not across all 64 pads.
- CC 113, CC 116, and paired buttons around CC 48-57 and CC 60-63 remain unassigned or unverified.
- The full color and brightness ranges for pads and selection buttons have not been mapped; only the values listed above are confirmed.
