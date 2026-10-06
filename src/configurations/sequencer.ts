import type { Action } from "../control-api/types/action.js";
import type { MidiInput } from "../core/types/input.js";
import type { MidiOutput } from "../core/types/output.js";
import type { DeviceFaderBank, DeviceModeProfile } from "../profile/types/mode.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import type { DeviceLayout } from "../profile/types/layout.js";
import type { ControlGrid } from "../profile/types/grid.js";
import { bindActionTrigger } from "../surface/action-binding.js";
import { toMidiSource } from "../surface/generate.js";
import type { ControlBinding, ModeBinding, NavigationBinding, SurfaceBindingTable, SurfaceModeDefinition } from "../surface/types/bindings.js";
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
   * Application control per fader, keyed by bank id (ECS-96). `{index}` is filled with the fader's position in its bank,
   * 0 to 7, left to right. The application decides which track a position means, so its controls can page with the
   * mixer. A bank with no template has no bindings, and its mode still shows the layout.
   */
  readonly faderTemplates?: Readonly<Record<string, string>>;
  /**
   * The lit colours of steps and track mutes on an RGB device (ECS-95). Left out, each takes its default
   * (`DEFAULT_SEQUENCER_COLOURS`): steps blue, mutes red. A device without RGB ignores them.
   */
  readonly colours?: Partial<SequencerColours>;
}

export interface SequencerColours {
  readonly steps: RgbColour;
  readonly mutes: RgbColour;
}

/** The colours a sequencer uses when its contract names none: a lit step is blue, a muted track red (ECS-95). */
export const DEFAULT_SEQUENCER_COLOURS: SequencerColours = {
  steps: { red: 0, green: 0, blue: 127 },
  mutes: { red: 127, green: 0, blue: 0 },
};

/**
 * The device connection the mixer's fader modes need (ECS-96). `outputs` are the connected output ports by profile id:
 * a mode sends its messages on the output its `sendPortId` names. `connectedPortIds` lists every port the device has, so a
 * mode whose `requiredPortIds` aren't all here is unavailable. Without this, no fader mode is built.
 */
export interface SequencerDevices {
  readonly outputs: Readonly<Record<string, MidiOutput>>;
  /** Connected input ports by profile id, for the fader modes' own inputs (the DAW port's arrows). */
  readonly inputs: Readonly<Record<string, MidiInput>>;
  readonly connectedPortIds: readonly string[];
}

export interface SequencerBindings {
  readonly bindings: SurfaceBindingTable;
  /** Roles the profile could not resolve, one line each. Their bindings are omitted, and the rest still work. */
  readonly unresolved: readonly string[];
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

  const faderModes = devices ? faderModeDefinitions(profile, contract, devices) : [];
  const faderModeIds = new Set(faderModes.map((definition) => definition.mode));

  const modeBindings: ModeBinding[] = [];
  for (const { controlId, mode } of layout.modeButtons ?? []) {
    // A fader mode the device can't run is skipped silently: its button is simply not there on that device.
    if (mode.startsWith("faders-") && !faderModeIds.has(mode)) continue;
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
    { mode: "steps", bindings: [...modeBindings, ...stepPages, ...stepBindings], activateOn: { scope: "step" } },
    { mode: "mixer", bindings: [...modeBindings, ...mixerPages, ...muteBindings], activateOn: { scope: "track" } },
    {
      mode: "transport",
      bindings: modeBindings.filter((binding) => !transportControlIds.has(binding.physicalControlId)),
      hooks: {
        onEnter: () => {
          transportUnbinds = transportSources.map(({ source, action }) => bindActionTrigger(input, source, action));
        },
        onExit: () => {
          for (const unbind of transportUnbinds) unbind();
          transportUnbinds = [];
        },
      },
    },
    ...faderModes,
  ];

  return { bindings, unresolved };
}

/** The fader mode for each bank the device can run (ECS-96). A mode exists only for a bank the application has a template for, on a device with the mode's ports. */
function faderModeDefinitions(profile: DeviceProfile, contract: SequencerContract, devices: SequencerDevices): SurfaceModeDefinition[] {
  const actions = contract.faderActions ?? {};
  const hasControl = (controlId: string) => profile.controls.some((control) => control.id === controlId);
  const banks = (profile.modes ?? []).flatMap((mode) => {
    const send = devices.outputs[mode.sendPortId];
    if (!send || !mode.requiredPortIds.every((portId) => devices.connectedPortIds.includes(portId))) return [];
    return mode.faders.banks.flatMap((bank) => {
      const template = contract.faderTemplates?.[bank.id];
      const controlIds = bank.controllers.map((_, index) => `fader-${bank.id}-${index}`);
      if (!template || !controlIds.every(hasControl)) return [];
      return [{ mode, bank, send, template, controlIds, modeId: `faders-${bank.id}`, dawInput: devices.inputs[mode.faders.inputPortId] }];
    });
  });
  const faderModeIds = new Set(banks.map((entry) => entry.modeId));
  const reachable = new Set(["steps", "mixer", "transport", ...faderModeIds]);

  return banks.map(({ mode, bank, send, template, controlIds, modeId, dawInput }) => {
    // The page arrows bind on the mode's own input, once the mode is entered, and unbind on leaving (ECS-96).
    let pageUnbinds: Array<() => void> = [];
    const navigation: NavigationBinding[] = (mode.modeButtons ?? [])
      .filter((button) => button.mode !== modeId && reachable.has(button.mode) && hasControl(button.controlId))
      .map((button) => ({ kind: "navigate", physicalControlId: button.controlId, role: `mode: ${button.mode}`, navigate: { kind: "set-mode", mode: button.mode } }));
    const faders: ControlBinding[] = bank.controllers.map((_, index) => ({
      kind: "control",
      physicalControlId: controlIds[index]!,
      role: `${bank.id} fader ${index + 1}`,
      resolve: { kind: "static", controlId: template.split("{index}").join(String(index)) },
    }));
    return {
      mode: modeId,
      bindings: [...navigation, ...faders],
      hooks: {
        // The layout shows only banks already set up, so the bank goes before the layout.
        onEnter: () => {
          for (const bytes of mode.activate) sendSysEx(send, bytes);
          sendSysEx(send, bankBytes(mode, bank));
          sendSysEx(send, mode.showLayout);
          pageUnbinds = pageActionBindings(profile, mode, dawInput, actions);
        },
        onExit: () => {
          for (const unbind of pageUnbinds) unbind();
          pageUnbinds = [];
          for (const bytes of mode.deactivate) sendSysEx(send, bytes);
        },
      },
    };
  });
}

/** Binds the mode's page arrows to the application's page actions, on the mode's own input. Returns their unbinders. */
function pageActionBindings(
  profile: DeviceProfile,
  mode: DeviceModeProfile,
  input: MidiInput | undefined,
  actions: NonNullable<SequencerContract["faderActions"]>,
): Array<() => void> {
  if (!input || !mode.pageButtons) return [];
  const unbinds: Array<() => void> = [];
  for (const name of ["pageUp", "pageDown", "pageLeft", "pageRight"] as const) {
    const controlId = mode.pageButtons[name];
    const action = actions[name];
    const control = controlId && profile.controls.find((candidate) => candidate.id === controlId);
    const source = control && toMidiSource(control);
    if (!action || !source) continue;
    unbinds.push(bindActionTrigger(input, source, action));
  }
  return unbinds;
}

/** A bank message: the profile's prefix, then each fader's index, type (0 unipolar, 1 bipolar), CC and colour, then F7. */
function bankBytes(mode: DeviceModeProfile, bank: DeviceFaderBank): number[] {
  return [...mode.bankPrefix, ...bank.controllers.flatMap((controller, index) => [index, bank.bipolar ? 1 : 0, controller, bank.colour]), 0xf7];
}

function sendSysEx(output: MidiOutput, bytes: readonly number[]): void {
  output.send({ type: "sysex", raw: Uint8Array.from(bytes) });
}
