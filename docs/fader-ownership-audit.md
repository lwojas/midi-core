# Audit: ownership of the ECS-96 fader work

Status: Final (audit; the moves are follow-up tickets, not made here)
Linear: [ECS-98](https://linear.app/ecs3d/issue/ECS-98/audit-the-ecs-96-fader-work-for-domain-ownership-across-profile-midi)
Parent: [ECS-96](https://linear.app/ecs3d/issue/ECS-96/explore-driving-the-launchpads-mixer-faders-through-the-daw-fader)

## Purpose

ECS-96 works end to end: device, midi-core, sequencer, webseq. This audit checks where each piece of
that work lives. The layers, as ECS-98 names them:

- **Device profile** (`src/profile/`): everything device-specific.
- **midi-core generic code** (`src/surface/`, `src/mapping/`, `src/configurations/`): no note, CC or SysEx
  values of its own.
- **Sequencer configuration** (`src/configurations/sequencer.ts`): maps the profile's roles onto the
  application contract. No device protocol.
- **webseq** (its own repo): names its own controls and actions. No MIDI, CCs, channels or SysEx.

Each item is marked **correct** (in the right layer), **moved** (belongs elsewhere; follow-up ticket),
or **deliberate** (stays where it is, for the reason given).

## Results

| # | Item | Verdict | Reason |
|---|------|---------|--------|
| 1 | `sequencer.ts` builds bank and layout messages (`bankBytes`, `sendSysEx`) | **Moved** (in part) | The bank's prefix is already profile data (`bankPrefix`). The per-fader entry (index, type, CC, colour, F7) is Launchpad protocol and sits in the generic configuration. The profile should own the entry format. The send order (`activate`, bank, `showLayout`, `deactivate`) is a rule the profile documents in `DeviceModeProfile`, so the sequencer enforcing it is **deliberate**. |
| 2 | `faderModeDefinitions` assumes `faders-<bank>` and `fader-<bank>-<index>` | **Moved** | Two copies of the convention: `LAUNCHPAD_MINI_MK3_FADER_CONTROLS` builds the control ids in the profile, and `sequencer.ts` builds the same ids again. Mode ids are hard-coded in the profile's `layout.modeButtons` as well. The profile should declare each fader's control id and each bank's mode id, and the sequencer should read them. |
| 3 | `faders-` prefix and the side-59 transport rule | **Moved** (prefix); **correct** (rule) | `sequencer.ts:107` skips a `faders-` button by prefix. The check should use the set of fader mode ids the device actually built (it already exists as `faderModeIds`). The rule that a mode button sharing a control with a transport role is unbound in transport mode (`sequencer.ts:191-202`) is generic code. Only its comment ties it to side-59. The comment should say so. |
| 4 | `runtime.ts` `openOptionalPorts` | **Correct** | It iterates the profile's declared ports, opens only non-required ports a binding uses, and holds no device names. It cannot open a port the device never declared. **Gap, not an ownership fault:** fader-mode availability comes from the caller's `SequencerDevices.connectedPortIds`, not from what the runtime actually connected. If the DAW port fails to connect, the mode is still built and bound. Follow-up. |
| 5 | Page-turn bank resend (`pageActionBindings`, `resendBank`) | **Moved** | Device behaviour: the device keeps its bank state, and `docs/hardware-validation.md` records the resend as the page-turn workaround. The profile should say it (for example, a flag on `DeviceModeProfile`, such as `resendBankOnPageTurn`). The sequencer then reads the flag. |
| 6 | webseq `FADER_PAGE_SIZE = 8` | **Moved** | The 8 is the device's fader count: each profile bank has eight controllers. Page width is the application's choice, but its value must match the device. The sequencer contract should expose the fader count, derived from the profile, and webseq should read it. The contract's own comment (`{index}` is 0 to 7) hard-codes the same fact. |
| 7 | Demo `faderTemplates` and controls (`demo/launchpad-surface.js`) | **Correct** | The demo's `CONTRACT` is an application contract: its control ids and templates, with no protocol values. It is a second application, not a second copy of the sequencer configuration. It does not pass `faderActions`, so its page arrows do nothing. Acceptable for a demo. |
| 8 | DAW-port discovery by name (`dawInfo` in webseq's `useMidiControls.ts`; `dawPairFor` in `demo/launchpad.js`) | **Moved** | Both repeat the Launchpad's naming rule (`MIDI Out` to `DAW Out`, `MIDI In` to `DAW In`). The profile cannot own it, because it holds port ids, not operating-system port names. The device registry (`src/devices/registry.ts`) should own a pairing helper, and both apps should call it. |
| 9 | `docs/contracts/` against the code | **Incorrect docs, fixed here** | `device-profile.md` describes `faders.count` (no such field) and says the CCs are "set at runtime, not in the profile" (they are fixed per bank). `launchpad-mini-mk3-profile.md` repeats the claim about the CCs. No contract doc describes `SequencerContract.faderActions`, `faderTemplates`, `colours`, or `SequencerDevices`. The docs are corrected and the fader contract is added in `docs/contracts/sequencer-configuration.md`. |

## Also noticed (not ECS-98 scope)

- **Transport is unreachable on the Launchpad.** The layout binds `transport` to side-59 to side-29, but
  no mode button leads to the transport mode (side-69 is free, per the profile). The transport bindings bind
  only on entering that mode, so the transport controls do nothing on the device. `hardware-validation.md`
  (section 5) records this as a pass from before the move. The profile comment says transport gets its own
  surface in a separate issue.
- **Page-turn LED repaint** (the known issue in ECS-96) is out of scope, as ECS-98 says.

## Follow-up tickets

Each is a separate ticket with its own scope.

1. [ECS-99](https://linear.app/ecs3d/issue/ECS-99): profile owns the fader bank entry format (item 1). Done: `bankEntry` and `bankTypes` on the mode.
2. [ECS-100](https://linear.app/ecs3d/issue/ECS-100): profile declares fader control ids and bank mode ids; remove the naming convention from the sequencer (items 2, 3). Done: `modeId` and `controlIds` on each bank.
3. [ECS-101](https://linear.app/ecs3d/issue/ECS-101): profile declares the page-turn bank resend (item 5). Done: `resendBankOnPageTurn` on the mode.
4. [ECS-102](https://linear.app/ecs3d/issue/ECS-102): sequencer contract exposes the device's fader count; webseq drops `FADER_PAGE_SIZE` (item 6). Done: `sequencerFaderCount(profile)`, used by webseq.
5. [ECS-103](https://linear.app/ecs3d/issue/ECS-103): device registry owns the DAW port pairing helper (item 8). Done: `dawPortNames` on the registry entry, and `findDawPorts`.
6. [ECS-104](https://linear.app/ecs3d/issue/ECS-104): fader-mode availability reflects the ports the runtime actually connected (item 4 gap).
7. [ECS-105](https://linear.app/ecs3d/issue/ECS-105): decide transport's mode button on the Launchpad (see "Also noticed").
