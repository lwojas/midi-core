# Integration: the Sequencer through the Control Surface Contract

Status: Integration reference
Source of truth: in `webseq` (the sibling repo this project's architecture
docs call "the sequencer"), not here — `src/midi/surfaceProfile.ts`,
`src/midi/mappings.ts`, `src/midi/useMidiControls.ts`,
`test/midiSurfaceIntegration.test.ts`, `test/midiSurfaceReplacement.test.ts`

## Purpose

`webseq` consumes a `DeviceProfile` and `SurfaceBindingTable` through
`createControlSurface()`, keeping raw MIDI addresses out of application code.
The integration uses the public `midi-core/surface`, `midi-core/profile`, and
`midi-core/control-api` subpaths and requires no device-specific runtime code
in this repository.

## Integration pattern

- **Device profile** — `src/midi/surfaceProfile.ts` describes two physical
  controls used with a Launchpad Mini custom-mode fader bank: a CC7 fader and
  a note-0 pad. They are represented through the profile schema rather than
  as raw addresses on a `ControlMapping`; the profile is not tied to a
  Launchpad or vendor. The fader input channel is unresolved, so
  `toMidiSource()` produces `channel: "any"`. This lets any fader strip in a
  bank drive the control through partially resolved profile addresses.
- **Bindings** — `src/midi/mappings.ts` exports a `SurfaceBindingTable` that
  maps each `PhysicalControl` role to a `ControlId` (static, targeting track
  1). The track-1 control factories are supplied by `controlAdapter.ts`.
- **Runtime setup** — `src/midi/useMidiControls.ts` builds a
  `ControlRegistry` from the track-1 controls and calls
  `createControlSurface({ profile, ports, bindingTable, context, registry,
generate: generateControlMappings, initialNavigation })`. The adapter uses
  `surface.attach()` and `surface.detach()` for lifecycle management. Public
  application components and the model need not import MIDI or change when
  this adapter is replaced.

## Replacement coverage

Device and application replacement are covered by
`webseq/test/midiSurfaceReplacement.test.ts`:

- **Device replacement, application unchanged**: the real
  `createTrack1Controls()` (backed by the real `projectReducer`) bound
  against `MOCK_SURFACE_DEVICE_PROFILE` — this repo's own generic mock
  surface device, not `webseq`'s CC7/note-0 controller — through a
  binding table that only names different `PhysicalControl` ids. Neither
  `controlAdapter.ts` nor the controls it builds changed between this test
  and the main integration test.
- **Application replacement, device profile unchanged**: `webseq`'s own
  `WEBSEQ_CONTROLLER_PROFILE`/`TRACK1_BINDING_TABLE` bound against a bare
  pair of `midi-core` `Control`s with no `Project`/reducer behind them at
  all — proving neither file carries any webseq-specific assumption beyond
  the two `ControlId` strings they already named.

## Tested behavior

`webseq/test/midiSurfaceIntegration.test.ts` exercises CC7-to-volume,
note-0-to-mute, any-channel fader-bank input, bidirectional feedback, echo
suppression, and clean teardown through `createControlSurface()` end to end.
The integration test contains 19 assertions covering these behaviors.

## Constraints

- **No real hardware** — `webseq` still connects through Web MIDI to
  whatever device the user selects in `MidiPanel.tsx`'s port pickers;
  this integration does not validate a specific physical device against the
  surface runtime.
- **No modes/navigation** — `TRACK1_BINDING_TABLE` has exactly one mode
  (`"default"`), since this integration has no paging/bank-switching
  requirement. The surface runtime supports mode switching when the
  application needs additional modes.
- **No device-specific runtime code** — the integration uses the existing
  public `midi-core` runtime APIs.
