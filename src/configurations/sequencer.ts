import { createAction } from "../control-api/action.js";
import type { Action } from "../control-api/types/action.js";
import type { MidiInput } from "../core/types/input.js";
import type { MidiOutput } from "../core/types/output.js";
import type { BankEntryField, DeviceFaderBank, DeviceModeProfile } from "../profile/types/mode.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import type { DeviceLayout } from "../profile/types/layout.js";
import type { ControlGrid } from "../profile/types/grid.js";
import { bindActionTrigger } from "../surface/action-binding.js";
import { toMidiSource } from "../surface/generate.js";
import type { ControlBinding, ModeBinding, NavigationBinding, SurfaceBindingTable, SurfaceModeDefinition, SurfaceModeHooks } from "../surface/types/bindings.js";
import type { MidiSource, RgbColour } from "../mapping/types/address.js";
import type { GridOffset } from "../surface/types/navigation.js";

/**
 * The application contract a sequencer exposes to a device (ECS-89). A sequencer names its controls and
 * actions with these ids, and the configuration decides which device control drives each one in each mode.
 * The sequencer never sees pads, CCs or notes.
 */
export interface SequencerContract {
  /** Application control for the step at a virtual position. `{row}` and `{column}` are filled with the window's coordinates. */
  readonly stepTemplate: string;
  /** Application control (a number) holding the sequence length, in columns. Paging stops at its end. */
  readonly lengthControl: string;
  /** Application control for a track's mute, with `{track}` (1-based) filled in. */
  readonly muteTemplate: string;
  /** Application control (a number) holding the track count. Vertical paging stops at its end (ECS-95). */
  readonly trackCountControl?: string;
  /** Transport actions the application supports. An action left out has no binding, and its device button does nothing. */
  readonly actions: { readonly play?: Action; readonly stop?: Action; readonly record?: Action; readonly clear?: Action };
  /**
   * Actions for the fader modes' page arrows (ECS-96). The application decides which tracks the faders show: a page
   * turn is a request to the application, not a surface navigation. An arrow left out has no binding.
   */
  readonly faderActions?: { readonly pageUp?: Action; readonly pageDown?: Action; readonly pageLeft?: Action; readonly pageRight?: Action };
  /**
   * Application control per fader, keyed by a fader mode's bank id (ECS-96): `volume`, `pan`, `send` on the Launchpad.
   * That key names the mode's group of CCs, not a group of application tracks; the application's own banks (A-D) are
   * `bankActions` and `bankControl` (ECS-114). `{index}` is filled with the fader's position in its bank, 0 to 7, left to
   * right. The application decides which track a position means, so its controls can page with the mixer. A bank with no
   * template has no bindings, and its mode still shows the layout.
   */
  readonly faderTemplates?: Readonly<Record<string, string>>;
  /**
   * Actions for the application's own banks (ECS-114): previous and next step through them, and `select[n]` selects bank
   * n (0 = A). The device's button for each comes from its profile's `layout.bank`. An action left out has no binding.
   */
  readonly bankActions?: { readonly previous?: Action; readonly next?: Action; readonly select?: Readonly<Record<number, Action>> };
  /**
   * Application control (a number) holding the active bank, 0 to 3 (ECS-114). A `select` button is lit while its own bank
   * is the active one, so the device shows where it is. Left out, the select buttons are not lit.
   */
  readonly bankControl?: string;
  /**
   * The lit colours of steps, track mutes, bank buttons and the playhead on an RGB device (ECS-95, ECS-114, ECS-131).
   * Left out, each takes its default (`DEFAULT_SEQUENCER_COLOURS`): steps blue, mutes red, banks green, playhead
   * white. A device without RGB ignores them. A step's duration continuation pads (ECS-127) are not configured here:
   * they're always a dimmed `steps`, so they read as part of the same note however `steps` itself is set.
   */
  readonly colours?: Partial<SequencerColours>;
  /**
   * Application control (a number) holding a step's duration, in steps, at the same virtual position `stepTemplate`
   * names — `{row}`/`{column}` fill the same way (ECS-127). Omitted, steps show no duration feedback: every active
   * step lights exactly one pad, as before this ticket.
   */
  readonly stepDurationTemplate?: string;
  /**
   * Application control (a number) holding the virtual column currently playing (ECS-131), matched against every
   * step regardless of its track row, so a whole page of tracks shows the same moving column. A value matching no
   * step on the current page (e.g. a sentinel the application sets while stopped) lights nothing — the sequencer's
   * own responsibility, not a flag this contract tracks. Omitted, steps show no playhead feedback.
   */
  readonly playheadControl?: string;
}

export interface SequencerColours {
  readonly steps: RgbColour;
  readonly mutes: RgbColour;
  /** The colour of the lit bank select button (ECS-114). */
  readonly banks: RgbColour;
  /** The colour of the playhead's pad (ECS-131), overriding every other colour a step would otherwise show there. */
  readonly playhead: RgbColour;
}

/** The colours a sequencer uses when its contract names none: a lit step is blue, a muted track red (ECS-95), a lit bank green (ECS-114), the playhead white (ECS-131). */
export const DEFAULT_SEQUENCER_COLOURS: SequencerColours = {
  steps: { red: 0, green: 0, blue: 127 },
  mutes: { red: 127, green: 0, blue: 0 },
  banks: { red: 0, green: 127, blue: 0 },
  playhead: { red: 127, green: 127, blue: 127 },
};

/** How much a step's own colour dims for a duration continuation pad (ECS-127): a quarter intensity reads as clearly part of the same note, never mistaken for an active step. */
const CONTINUATION_DIM_FACTOR = 0.25;

function dimColour(colour: RgbColour, factor: number): RgbColour {
  return { red: Math.round(colour.red * factor), green: Math.round(colour.green * factor), blue: Math.round(colour.blue * factor) };
}

const bankLetter = (index: number) => String.fromCharCode("A".charCodeAt(0) + index);

/** Runs several mode hook sets as one: each set's `onEnter` in order, then each set's `onExit` in order (ECS-114). */
function joinHooks(...sets: Array<SurfaceModeHooks | undefined>): SurfaceModeHooks | undefined {
  const present = sets.filter((hooks): hooks is SurfaceModeHooks => hooks !== undefined);
  if (present.length === 0) return undefined;
  return {
    onEnter: async () => {
      for (const hooks of present) await hooks.onEnter?.();
    },
    onExit: async () => {
      for (const hooks of present) await hooks.onExit?.();
    },
  };
}

/**
 * The device ports the mixer's fader modes need (ECS-96). `outputs` and `inputs` are the ports the application has, by profile
 * id: a mode sends its messages on the output its `sendPortId` names. A mode whose `requiredPortIds` aren't all supplied
 * here is not built. Whether a supplied port connects is the surface's to report (ECS-104): a mode whose port fails to
 * connect is refused when it is entered, not left running without the port.
 */
export interface SequencerDevices {
  readonly outputs: Readonly<Record<string, MidiOutput>>;
  /** Input ports by profile id, for the fader modes' own inputs (the DAW port's arrows). */
  readonly inputs: Readonly<Record<string, MidiInput>>;
}

export interface SequencerBindings {
  readonly bindings: SurfaceBindingTable;
  /** Roles the profile could not resolve, one line each. Their bindings are omitted, and the rest still work. */
  readonly unresolved: readonly string[];
}

/**
 * The number of faders one page of the mixer shows (ECS-102): the smallest fader count among the profile's fader banks,
 * so every bank can show a full page. The application sizes its fader pages with it. 0 when the profile has no fader banks.
 */
export function sequencerFaderCount(profile: DeviceProfile): number {
  const counts = (profile.modes ?? []).flatMap((mode) => mode.faders.banks.map((bank) => bank.controllers.length));
  return counts.length === 0 ? 0 : Math.min(...counts);
}

const TRANSPORT_NAMES = ["play", "stop", "record", "clear"] as const;


/**
 * Builds the binding table for a sequencer on a device: three modes (steps, mixer, transport) with the device's
 * mode buttons available in each. Steps and mutes toggle on press. The steps grid is a window onto the sequence,
 * paged by the page size the profile's grid declares. Which controls play which role comes from the profile's
 * `layout` (ECS-90). `input` is the connected device input, which transport triggers need.
 *
 * Rows are tracks (ECS-95). Up and down page through tracks in both steps and mixer mode; left and right page
 * through time in steps mode only. The mixer shows one track per column of the grid's top row, with its mute there.
 */
export function createSequencerBindings(input: MidiInput, profile: DeviceProfile, contract: SequencerContract, devices?: SequencerDevices): SequencerBindings {
  const unresolved: string[] = [];
  const hasControl = (controlId: string) => profile.controls.some((control) => control.id === controlId);

  const layout: DeviceLayout = profile.layout ?? {};
  const colours: SequencerColours = { ...DEFAULT_SEQUENCER_COLOURS, ...contract.colours };
  if (!profile.layout) unresolved.push("layout (the profile declares none)");

  const grid: ControlGrid | undefined = profile.grids?.find((candidate) => candidate.paging);
  if (!grid) unresolved.push("step grid (a grid with paging)");

  // Bank buttons (ECS-114): previous, next, and one select button per bank. Their presses are triggers bound on the device
  // input while each mode is shown, as transport's are, and each select button shows the active bank as an indicator.
  const bankRoles = layout.bank ?? {};
  // A bank button is bound on the input its control is on: the main input for most, but a fader layout's arrows arrive on the
  // DAW input (ECS-114). A profile without a main input declared binds everything on the main input.
  const mainInputPortId = profile.ports?.find((port) => port.type === "input" && port.role === "main")?.id;
  const inputFor = (portId: string) => (mainInputPortId === undefined || portId === mainInputPortId ? input : devices?.inputs[portId]);
  const bankTriggers: Array<{ input: MidiInput; source: MidiSource; action: Action }> = [];
  const bindBankAction = (role: string, controlId: string | undefined, action: Action | undefined) => {
    if (controlId === undefined || !action) return;
    const control = profile.controls.find((candidate) => candidate.id === controlId);
    const source = control && toMidiSource(control);
    const triggerInput = control && inputFor(control.portId);
    if (!source || !triggerInput) {
      unresolved.push(`bank: ${role} (control ${controlId})`);
      return;
    }
    bankTriggers.push({ input: triggerInput, source, action });
  };
  bindBankAction("previous", bankRoles.previous, contract.bankActions?.previous);
  bindBankAction("next", bankRoles.next, contract.bankActions?.next);
  for (const [index, controlId] of Object.entries(bankRoles.select ?? {})) {
    bindBankAction(`select ${bankLetter(Number(index))}`, controlId, contract.bankActions?.select?.[Number(index)]);
  }
  const bankControl = contract.bankControl;
  const bankIndicators: ModeBinding[] =
    bankControl === undefined
      ? []
      : Object.entries(bankRoles.select ?? {}).map(([index, controlId]): ModeBinding => ({
          kind: "indicator",
          physicalControlId: controlId,
          role: `bank ${bankLetter(Number(index))} lit`,
          resolve: { kind: "static", controlId: bankControl },
          lit: Number(index),
          colour: colours.banks,
        }));
  // Each mode gets its own bank hooks, bound and unbound as the mode is entered and left, the way transport's are.
  const bankHooks = (): SurfaceModeHooks | undefined => {
    if (bankTriggers.length === 0) return undefined;
    let unbinds: Array<() => void> = [];
    return {
      onEnter: () => {
        unbinds = bankTriggers.map(({ input: triggerInput, source, action }) => bindActionTrigger(triggerInput, source, action));
      },
      onExit: () => {
        for (const unbind of unbinds) unbind();
        unbinds = [];
      },
    };
  };

  const faderModes = devices ? faderModeDefinitions(profile, contract, devices, { bankIndicators, bankHooks }) : [];
  const faderModeIds = new Set(faderModes.map((definition) => definition.mode));
  const declaredFaderModeIds = new Set((profile.modes ?? []).flatMap((mode) => mode.faders.banks.map((bank) => bank.modeId)));

  const modeBindings: NavigationBinding[] = [];
  for (const { controlId, mode } of layout.modeButtons ?? []) {
    // A fader mode the device can't run is skipped silently: its button is simply not there on that device.
    if (declaredFaderModeIds.has(mode) && !faderModeIds.has(mode)) continue;
    if (!hasControl(controlId)) {
      unresolved.push(`mode: ${mode} (control ${controlId})`);
      continue;
    }
    modeBindings.push({ kind: "navigate", physicalControlId: controlId, role: `mode: ${mode}`, navigate: { kind: "set-mode", mode } });
  }

  // Page buttons, each resolved once. Steps: up/down page tracks (rows), left/right page time (columns). The mixer
  // lays tracks across the top row, so there left/right page tracks, and up/down have nothing to page.
  const pageButtons: Array<{ side: string; controlId: string; direction: GridOffset; gridId: string }> = [];
  if (grid) {
    for (const [side, controlId, direction] of [
      ["page up", layout.pageUp, { row: -1, column: 0 }],
      ["page down", layout.pageDown, { row: 1, column: 0 }],
      ["page left", layout.pageLeft, { row: 0, column: -1 }],
      ["page right", layout.pageRight, { row: 0, column: 1 }],
    ] as const) {
      if (controlId === undefined) continue;
      if (!hasControl(controlId)) {
        unresolved.push(`${side} (control ${controlId})`);
        continue;
      }
      pageButtons.push({ side, controlId, direction, gridId: grid.id });
    }
  }
  const pageBinding = (button: (typeof pageButtons)[number], direction: GridOffset, role: string): ModeBinding => ({
    kind: "navigate",
    physicalControlId: button.controlId,
    role,
    navigate: { kind: "page", gridId: button.gridId, direction },
  });
  const stepPages = pageButtons.map((button) => pageBinding(button, button.direction, button.side));
  const mixerPages = pageButtons
    .filter((button) => button.direction.column !== 0)
    .map((button) => pageBinding(button, { row: button.direction.column, column: 0 }, `${button.side} (tracks)`));

  const cells = grid?.cells ?? [];
  const stepBindings: ModeBinding[] = grid
    ? cells.map((cell) => ({
        kind: "window",
        physicalControlId: cell.controlId,
        role: `step ${cell.row},${cell.column}`,
        gridId: grid.id,
        template: contract.stepTemplate,
        press: "toggle",
        columnCountControl: contract.lengthControl,
        rowCountControl: contract.trackCountControl,
        colour: colours.steps,
        ...(contract.stepDurationTemplate !== undefined
          ? { durationTemplate: contract.stepDurationTemplate, continuationColour: dimColour(colours.steps, CONTINUATION_DIM_FACTOR) }
          : {}),
        ...(contract.playheadControl !== undefined ? { playheadControl: contract.playheadControl, playheadColour: colours.playhead } : {}),
      }))
    : [];

  // The mixer lays tracks across the grid's top row, one per column, as its UI does. The window is horizontal, so the
  // page's tracks run across the columns, and paging up and down moves the page by tracks.
  const muteBindings: ModeBinding[] = grid
    ? cells
        .filter((cell) => cell.row === 0)
        .map((cell) => ({
          kind: "window",
          physicalControlId: cell.controlId,
          role: `mute ${cell.column + 1}`,
          gridId: grid.id,
          template: contract.muteTemplate,
          press: "toggle",
          orientation: "horizontal",
          rowCountControl: contract.trackCountControl,
          colour: colours.mutes,
        }))
    : [];

  const transportSources: Array<{ name: (typeof TRANSPORT_NAMES)[number]; source: MidiSource; action: Action }> = [];
  for (const name of TRANSPORT_NAMES) {
    const controlId = layout.transport?.[name];
    const action = contract.actions[name];
    if (controlId === undefined || !action) continue;
    const control = profile.controls.find((candidate) => candidate.id === controlId);
    const source = control && toMidiSource(control);
    if (!source) {
      unresolved.push(`transport: ${name} (control ${controlId})`);
      continue;
    }
    transportSources.push({ name, source, action });
  }

  // A mode button that shares a control with a transport role (ECS-96: the Launchpad's side-59 selects a fader bank, and
  // is also a transport control) is not bound in the transport mode, where the transport role wins.
  const transportControlIds = new Set(Object.values(layout.transport ?? {}).filter((id): id is string => id !== undefined));

  let transportUnbinds: Array<() => void> = [];

  const bindings: SurfaceBindingTable = [
    {
      mode: "steps",
      bindings: [...modeBindings, ...stepPages, ...stepBindings, ...bankIndicators],
      hooks: joinHooks(bankHooks()),
      activateOn: { scope: "step" },
    },
    {
      mode: "mixer",
      bindings: [...modeBindings, ...mixerPages, ...muteBindings, ...bankIndicators],
      hooks: joinHooks(bankHooks()),
      activateOn: { scope: "track" },
    },
    {
      mode: "transport",
      bindings: [...modeBindings.filter((binding) => !transportControlIds.has(binding.physicalControlId)), ...bankIndicators],
      hooks: joinHooks(
        {
          onEnter: () => {
            transportUnbinds = transportSources.map(({ source, action }) => bindActionTrigger(input, source, action));
          },
          onExit: () => {
            for (const unbind of transportUnbinds) unbind();
            transportUnbinds = [];
          },
        },
        bankHooks(),
      ),
    },
    ...faderModes,
  ];

  return { bindings, unresolved };
}

/** The fader mode for each bank the device can run (ECS-96). A mode exists only for a bank the application has a template for, on a device with the mode's ports. */
function faderModeDefinitions(
  profile: DeviceProfile,
  contract: SequencerContract,
  devices: SequencerDevices,
  shared: { bankIndicators: readonly ModeBinding[]; bankHooks: () => SurfaceModeHooks | undefined },
): SurfaceModeDefinition[] {
  const actions = contract.faderActions ?? {};
  const hasControl = (controlId: string) => profile.controls.some((control) => control.id === controlId);
  const banks = (profile.modes ?? []).flatMap((mode) => {
    const send = devices.outputs[mode.sendPortId];
    const supplied = new Set([...Object.keys(devices.outputs), ...Object.keys(devices.inputs)]);
    if (!send || !mode.requiredPortIds.every((portId) => supplied.has(portId))) return [];
    return mode.faders.banks.flatMap((bank) => {
      const template = contract.faderTemplates?.[bank.id];
      if (!template || !bank.controlIds.every(hasControl)) return [];
      return [{ mode, bank, send, template, controlIds: bank.controlIds, modeId: bank.modeId, dawInput: devices.inputs[mode.faders.inputPortId] }];
    });
  });
  const faderModeIds = new Set(banks.map((entry) => entry.modeId));
  const reachable = new Set(["steps", "mixer", "transport", ...faderModeIds]);

  return banks.map(({ mode, bank, send, template, controlIds, modeId, dawInput }) => {
    // The page arrows bind on the mode's own input, once the mode is entered, and unbind on leaving (ECS-96).
    let pageUnbinds: Array<() => void> = [];
    const navigation: NavigationBinding[] = (mode.modeButtons ?? [])
      .filter((button) => button.mode !== modeId && reachable.has(button.mode) && hasControl(button.controlId))
      .flatMap((button): NavigationBinding[] => {
        const target = { kind: "set-mode", mode: button.mode } as const;
        const bindings: NavigationBinding[] = [{ kind: "navigate", physicalControlId: button.controlId, role: `mode: ${button.mode}`, navigate: target }];
        // ECS-126: also bind the button's main-port twin, so a press still reaches the surface after the device's own
        // Setup-menu combo has silently forced it back to Programmer mode (see recoveryControlId's doc comment).
        if (button.recoveryControlId && hasControl(button.recoveryControlId)) {
          bindings.push({ kind: "navigate", physicalControlId: button.recoveryControlId, role: `mode: ${button.mode} (recovery)`, navigate: target });
        }
        return bindings;
      });
    const faders: ControlBinding[] = bank.controllers.map((_, index) => ({
      kind: "control",
      physicalControlId: controlIds[index]!,
      role: `${bank.id} fader ${index + 1}`,
      resolve: { kind: "static", controlId: template.split("{index}").join(String(index)) },
    }));
    return {
      mode: modeId,
      bindings: [...navigation, ...faders, ...shared.bankIndicators],
      // The surface refuses to enter this mode while one of its ports isn't connected (ECS-104).
      requiredPortIds: mode.requiredPortIds,
      hooks: joinHooks(
        {
          // The layout shows only banks already set up, so the bank goes before the layout.
          onEnter: () => {
            for (const bytes of mode.activate) sendSysEx(send, bytes);
            sendSysEx(send, bankBytes(mode, bank));
            sendSysEx(send, mode.showLayout);
            pageUnbinds = pageActionBindings(profile, mode, dawInput, actions, () => sendSysEx(send, bankBytes(mode, bank)));
          },
          onExit: () => {
            for (const unbind of pageUnbinds) unbind();
            pageUnbinds = [];
            for (const bytes of mode.deactivate) sendSysEx(send, bytes);
          },
        },
        shared.bankHooks(),
      ),
    };
  });
}

/** Binds the mode's page arrows to the application's page actions, on the mode's own input. Returns their unbinders. */
function pageActionBindings(
  profile: DeviceProfile,
  mode: DeviceModeProfile,
  input: MidiInput | undefined,
  actions: NonNullable<SequencerContract["faderActions"]>,
  resendBank: () => void,
): Array<() => void> {
  if (!input || !mode.pageButtons) return [];
  const unbinds: Array<() => void> = [];
  for (const name of ["pageUp", "pageDown", "pageLeft", "pageRight"] as const) {
    const controlId = mode.pageButtons[name];
    const action = actions[name];
    const control = controlId && profile.controls.find((candidate) => candidate.id === controlId);
    const source = control && toMidiSource(control);
    if (!action || !source) continue;
    // A device that forgets its fader setup on a page turn (the profile says so) gets the bank resent before the application
    // moves its tracks. The application only sees the page action; the bank message is midi-core's to send (ECS-101).
    const turn = mode.resendBankOnPageTurn
      ? createAction(action.def, () => {
          resendBank();
          action.invoke();
        })
      : action;
    unbinds.push(bindActionTrigger(input, source, turn));
  }
  return unbinds;
}

/** A bank message: the profile's prefix, then each fader's entry in the profile's field order (ECS-99), then F7. */
function bankBytes(mode: DeviceModeProfile, bank: DeviceFaderBank): number[] {
  const entries = bank.controllers.flatMap((controller, index) => {
    const values: Record<BankEntryField, number> = {
      index,
      type: bank.bipolar ? mode.bankTypes.bipolar : mode.bankTypes.unipolar,
      controller,
      colour: bank.colour,
    };
    return mode.bankEntry.map((field) => values[field]);
  });
  return [...mode.bankPrefix, ...entries, 0xf7];
}

function sendSysEx(output: MidiOutput, bytes: readonly number[]): void {
  output.send({ type: "sysex", raw: Uint8Array.from(bytes) });
}
