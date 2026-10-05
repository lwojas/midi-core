# Integration: the Sequencer through the Control Surface Contract

Status: Final (integration report)
Linear: [ECS-78](https://linear.app/ecs3d/issue/ECS-78/integrate-the-sequencer-through-the-control-surface-contract)
Project: [MIDI Core and Control Architecture](https://linear.app/ecs3d/project/midi-core-and-control-architecture-f934a737de3b)
Depends on: ECS-69–77 (the full Control Surface runtime, validated against a
generic mock device)
Source of truth: in `webseq` (the sibling repo this project's architecture
docs call "the sequencer"), not here — `src/midi/surfaceProfile.ts`,
`src/midi/mappings.ts`, `src/midi/useMidiControls.ts`,
`test/midiSurfaceIntegration.test.ts`, `test/midiSurfaceReplacement.test.ts`

## Purpose

Proof scope step 4 of `docs/control-surface-architecture.md`: "real hardware
(ECS-79) and a real sequencer (ECS-78) replace the mock pieces" validated in
ECS-77. This ticket replaces ECS-77's `createFakeSequencer()` with `webseq`
— the actual sequencer this project's Control Surface work has targeted
since ECS-38 — and replaces ECS-38's own direct `bindControlMapping()` call
(one hand-written `ControlMapping` per control, raw CC/note numbers
authored in `webseq/src/midi/mappings.ts`) with the full Control Surface
contract: a `DeviceProfile` plus a `SurfaceBindingTable` driving
`createControlSurface()`. No new production code was needed in **this**
repo — every piece ECS-69–77 shipped (`createControlSurface`,
`generateControlMappings`, `bindSurfaceMode`/`bindActiveMode`,
`createControlRegistry`, `createSurfaceContext`) was already sufficient;
this ticket's work is entirely in `webseq`, consuming this project's public
`midi-core/surface`, `midi-core/profile`, and `midi-core/control-api`
subpaths (already exported since ECS-69–71).

## What changed in `webseq`

- **`src/midi/surfaceProfile.ts` (new)** — a `DeviceProfile` describing the
  two physical controls ECS-38 already proved against a real Launchpad Mini
  custom-mode fader bank (a CC7 fader, a note-0 pad), expressed through this
  project's profile schema instead of as raw addresses on a `ControlMapping`.
  Deliberately not Launchpad- or vendor-specific — real hardware selection
  is ECS-79's job, not this one's. The fader's `input` channel is left
  unresolved (not pinned to `0`), which `toMidiSource()` already turns into
  `channel: "any"` — the exact behavior ECS-38's hand-written mapping needed
  to let any fader strip in a bank drive the control, now expressed through
  the profile's own "partially resolved address" case (ECS-62) instead of a
  mapping-layer special case.
- **`src/midi/mappings.ts` (rewritten)** — no longer builds a
  `ControlMapping`; it now exports a `SurfaceBindingTable` naming each
  `PhysicalControl`'s role and the `ControlId` it resolves to (both static —
  track-1 only, same scope ECS-38 chose), plus the same `createTrack1*`
  control-factory shape as before (reused, not duplicated, from
  `controlAdapter.ts`, which is unchanged).
- **`src/midi/useMidiControls.ts` (rewritten internals, unchanged public
  API)** — `connect()` now builds a `ControlRegistry` from the track-1
  controls and calls `createControlSurface({ profile, ports, bindingTable,
  context, registry, generate: generateControlMappings, initialNavigation })`,
  then `surface.attach()`/`surface.detach()` in place of the manual
  `input.connect()`/`output.connect()` + `bindControlMapping()` calls ECS-38
  made directly. `MidiPanel.tsx`, `App.tsx`, and everything in `src/model/`
  needed zero changes — exactly the "this file could be deleted and nothing
  else would need to change" boundary ECS-38 already established, preserved
  across the rewrite.

## Confirmed: no MIDI/device vocabulary in the sequencer

`src/model/`, `src/components/`, and `src/App.tsx` contain no reference to
Launchpad, APC, SysEx, or any CC/note-on/note-off/control-change vocabulary
— confirmed by grep across all three, not just inferred from the adapter
boundary. The only place any of that appears is `src/midi/` (the one
adapter module ECS-38/this architecture's boundary rule allows) and a
user-facing hint string in `MidiPanel.tsx` ("CC7 ↔ volume") — UI copy, not
an import or a branch.

## Demonstrated: device and application replacement

Both of ECS-78's explicit swap requirements are proven as passing tests
(`webseq/test/midiSurfaceReplacement.test.ts`), not just asserted:

- **Device replacement, application unchanged**: the real
  `createTrack1Controls()` (backed by the real `projectReducer`) bound
  against `MOCK_SURFACE_DEVICE_PROFILE` — this repo's own generic mock
  surface device (ECS-71), not `webseq`'s CC7/note-0 controller — through a
  binding table that only names different `PhysicalControl` ids. Neither
  `controlAdapter.ts` nor the controls it builds changed between this test
  and the main integration test.
- **Application replacement, device profile unchanged**: `webseq`'s own
  `WEBSEQ_CONTROLLER_PROFILE`/`TRACK1_BINDING_TABLE` bound against a bare
  pair of `midi-core` `Control`s with no `Project`/reducer behind them at
  all — proving neither file carries any webseq-specific assumption beyond
  the two `ControlId` strings they already named.

## Preserved: working functionality

`webseq/test/midiSurfaceIntegration.test.ts` re-proves every behavior
ECS-38's original `midiMappings.test.ts` established — CC7 ↔ volume, note-0
↔ mute, the "any channel" fader-bank fix, bidirectional feedback, ECS-57's
echo suppression, and clean teardown — now driven through
`createControlSurface()` end to end instead of a direct
`bindControlMapping()` call. All 19 assertions pass unchanged in substance;
only the harness construction (`createControlSurface().attach()`/`detach()`
instead of manual connect + bind) differs from ECS-38's version.

## What's deliberately not here

- **No real hardware** — `webseq` still connects through Web MIDI to
  whatever device the user selects in `MidiPanel.tsx`'s port pickers;
  selecting and validating one specific real device against the surface
  runtime is ECS-79, unchanged in scope by this ticket.
- **No modes/navigation** — `TRACK1_BINDING_TABLE` has exactly one mode
  (`"default"`), since this integration has no paging/bank-switching
  requirement; ECS-75's mode-switching machinery is available to `webseq`
  unchanged whenever it needs more than one.
- **No new midi-core production code** — every runtime piece this
  integration needed already shipped in ECS-69–77.
