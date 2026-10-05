import type { Action } from "../control-api/types/action.js";
import type { MidiInput } from "../core/types/input.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import type { DeviceLayout } from "../profile/types/layout.js";
import type { ControlGrid } from "../profile/types/grid.js";
import { bindActionTrigger } from "../surface/action-binding.js";
import { toMidiSource } from "../surface/generate.js";
import type { ModeBinding, SurfaceBindingTable } from "../surface/types/bindings.js";
import type { MidiSource, RgbColour } from "../mapping/types/address.js";

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
}

export interface SequencerBindings {
  readonly bindings: SurfaceBindingTable;
  /** Roles the profile could not resolve, one line each. Their bindings are omitted, and the rest still work. */
  readonly unresolved: readonly string[];
}

const TRANSPORT_NAMES = ["play", "stop", "record", "clear"] as const;

/** The colour a lit step and a muted track show on an RGB pad (ECS-95). A usage default, like the layout. */
const STEP_COLOUR: RgbColour = { red: 0, green: 0, blue: 127 };
const MUTE_COLOUR: RgbColour = { red: 127, green: 0, blue: 0 };

/**
 * Builds the binding table for a sequencer on a device: three modes (steps, mixer, transport) with the device's
 * mode buttons available in each. Steps and mutes toggle on press. The steps grid is a window onto the sequence,
 * paged by the page size the profile's grid declares. Which controls play which role comes from the profile's
 * `layout` (ECS-90). `input` is the connected device input, which transport triggers need.
 *
 * Rows are tracks (ECS-95). Up and down page through tracks in both steps and mixer mode; left and right page
 * through time in steps mode only. The mixer shows one track per column of the grid's top row, with its mute there.
 */
export function createSequencerBindings(input: MidiInput, profile: DeviceProfile, contract: SequencerContract): SequencerBindings {
  const unresolved: string[] = [];
  const hasControl = (controlId: string) => profile.controls.some((control) => control.id === controlId);

  const layout: DeviceLayout = profile.layout ?? {};
  if (!profile.layout) unresolved.push("layout (the profile declares none)");

  const grid: ControlGrid | undefined = profile.grids?.find((candidate) => candidate.paging);
  if (!grid) unresolved.push("step grid (a grid with paging)");

  const modeBindings: ModeBinding[] = [];
  for (const { controlId, mode } of layout.modeButtons ?? []) {
    if (!hasControl(controlId)) {
      unresolved.push(`mode: ${mode} (control ${controlId})`);
      continue;
    }
    modeBindings.push({ kind: "navigate", physicalControlId: controlId, role: `mode: ${mode}`, navigate: { kind: "set-mode", mode } });
  }

  // Page buttons, split by axis: up/down page tracks (both modes), left/right page time (steps only).
  const pageBindings: Array<{ axis: "vertical" | "horizontal"; binding: ModeBinding }> = [];
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
      pageBindings.push({
        axis: direction.row !== 0 ? "vertical" : "horizontal",
        binding: { kind: "navigate", physicalControlId: controlId, role: side, navigate: { kind: "page", gridId: grid.id, direction } },
      });
    }
  }
  const pages = (axis: "vertical" | "horizontal") => pageBindings.filter((page) => page.axis === axis).map((page) => page.binding);

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
        colour: STEP_COLOUR,
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
          colour: MUTE_COLOUR,
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

  let transportUnbinds: Array<() => void> = [];

  const bindings: SurfaceBindingTable = [
    { mode: "steps", bindings: [...modeBindings, ...pages("vertical"), ...pages("horizontal"), ...stepBindings], activateOn: { scope: "step" } },
    { mode: "mixer", bindings: [...modeBindings, ...pages("vertical"), ...muteBindings], activateOn: { scope: "track" } },
    {
      mode: "transport",
      bindings: modeBindings,
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
  ];

  return { bindings, unresolved };
}
