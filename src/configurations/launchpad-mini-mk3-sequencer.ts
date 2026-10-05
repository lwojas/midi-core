import type { Action } from "../control-api/types/action.js";
import type { MidiInput } from "../core/types/input.js";
import { LAUNCHPAD_MINI_MK3_PAD_GRID, LAUNCHPAD_MINI_MK3_PROFILE } from "../profile/devices/launchpad-mini-mk3.js";
import { bindActionTrigger } from "../surface/action-binding.js";
import { toMidiSource } from "../surface/generate.js";
import type { ModeBinding, SurfaceBindingTable } from "../surface/types/bindings.js";
import type { MidiSource } from "../mapping/types/address.js";

/**
 * The application contract a sequencer exposes to a Launchpad Mini MK3 (ECS-89). A sequencer names its
 * controls and actions with these ids, and this configuration decides which device control drives each one
 * in each mode. The sequencer never sees pads, CCs or notes.
 */
export interface SequencerContract {
  /** Application control for the step at a virtual position. `{row}` and `{column}` are filled with the window's coordinates. */
  readonly stepTemplate: string;
  /** Application control (a number) holding the sequence length, in columns. Paging stops at its end. */
  readonly lengthControl: string;
  /** Application control for a track's mute, with `{track}` (1-based) filled in. */
  readonly muteTemplate: string;
  /** Transport actions the application supports. An action left out has no binding, and its device button does nothing. */
  readonly actions: { readonly play?: Action; readonly stop?: Action; readonly record?: Action; readonly clear?: Action };
}

const MODE_BUTTONS: readonly { readonly controller: number; readonly mode: string }[] = [
  { controller: 89, mode: "steps" },
  { controller: 79, mode: "mixer" },
  { controller: 69, mode: "transport" },
];

const PAGE_LEFT = 95;
const PAGE_RIGHT = 96;
const TRANSPORT = { play: 91, stop: 92, record: 93, clear: 94 } as const;

function sideButtonId(controller: number): string {
  return `side-${controller}`;
}

function topButtonSource(controller: number): MidiSource {
  const control = LAUNCHPAD_MINI_MK3_PROFILE.controls.find((candidate) => candidate.id === `top-${controller}`);
  const source = control && toMidiSource(control);
  if (!source) throw new Error(`Launchpad profile has no usable top-row button ${controller}.`);
  return source;
}

function fill(template: string, values: Record<string, number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

function modeButtons(): ModeBinding[] {
  return MODE_BUTTONS.map(({ controller, mode }) => ({
    kind: "navigate",
    physicalControlId: sideButtonId(controller),
    role: `mode: ${mode}`,
    navigate: { kind: "set-mode", mode },
  }));
}

/**
 * Builds the Launchpad's binding table for a sequencer: three modes (steps, mixer, transport) with the device's
 * mode buttons available in each. Steps and mutes toggle on press. The steps grid is a window onto the sequence,
 * paged by the page size the profile declares. `input` is the connected Launchpad input, which transport
 * triggers need.
 */
export function createLaunchpadSequencerBindings(input: MidiInput, contract: SequencerContract): SurfaceBindingTable {
  const grid = LAUNCHPAD_MINI_MK3_PAD_GRID;

  const pageBindings: ModeBinding[] = [
    { kind: "navigate", physicalControlId: `top-${PAGE_LEFT}`, role: "page left", navigate: { kind: "page", gridId: grid.id, direction: { row: 0, column: -1 } } },
    { kind: "navigate", physicalControlId: `top-${PAGE_RIGHT}`, role: "page right", navigate: { kind: "page", gridId: grid.id, direction: { row: 0, column: 1 } } },
  ];

  const stepBindings: ModeBinding[] = grid.cells.map((cell) => ({
    kind: "window",
    physicalControlId: cell.controlId,
    role: `step ${cell.row},${cell.column}`,
    gridId: grid.id,
    template: contract.stepTemplate,
    press: "toggle",
    columnCountControl: contract.lengthControl,
  }));

  // The top pad row (row 0) mutes tracks 1-8, one track per column.
  const muteBindings: ModeBinding[] = grid.cells
    .filter((cell) => cell.row === 0)
    .map((cell) => ({
      kind: "control",
      physicalControlId: cell.controlId,
      role: `mute ${cell.column + 1}`,
      resolve: { kind: "static", controlId: fill(contract.muteTemplate, { track: cell.column + 1 }) },
      press: "toggle",
    }));

  let transportUnbinds: Array<() => void> = [];

  return [
    { mode: "steps", bindings: [...modeButtons(), ...pageBindings, ...stepBindings], activateOn: { scope: "step" } },
    { mode: "mixer", bindings: [...modeButtons(), ...muteBindings], activateOn: { scope: "track" } },
    {
      mode: "transport",
      bindings: modeButtons(),
      hooks: {
        onEnter: () => {
          transportUnbinds = (Object.keys(TRANSPORT) as Array<keyof typeof TRANSPORT>).flatMap((name) => {
            const action = contract.actions[name];
            return action ? [bindActionTrigger(input, topButtonSource(TRANSPORT[name]), action)] : [];
          });
        },
        onExit: () => {
          for (const unbind of transportUnbinds) unbind();
          transportUnbinds = [];
        },
      },
    },
  ];
}
