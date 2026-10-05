import type { Action } from "../control-api/types/action.js";
import type { MidiInput } from "../core/types/input.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import type { ControlGrid } from "../profile/types/grid.js";
import { bindActionTrigger } from "../surface/action-binding.js";
import { toMidiSource } from "../surface/generate.js";
import type { ModeBinding, SurfaceBindingTable } from "../surface/types/bindings.js";
import type { MidiSource } from "../mapping/types/address.js";

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
  /** Transport actions the application supports. An action left out has no binding, and its device button does nothing. */
  readonly actions: { readonly play?: Action; readonly stop?: Action; readonly record?: Action; readonly clear?: Action };
}

/**
 * Which device control plays each sequencer role (ECS-90). A profile says what a device has; a layout says
 * which of those controls the sequencer uses for what. The configuration resolves these ids against the
 * profile, and reports any it cannot find rather than guessing.
 *
 * The step grid is not named here: it is the profile's grid with `paging`, and the track mutes are its top row.
 */
export interface SequencerLayout {
  /** Mode buttons, in order. Each switches the surface to the named mode, and is available in every mode. */
  readonly modeButtons: readonly { readonly controlId: string; readonly mode: string }[];
  /** Page buttons, one each side. A side left out has no page binding. */
  readonly pageLeft?: string;
  readonly pageRight?: string;
  /** Transport buttons. A button left out has no binding. */
  readonly transport?: { readonly play?: string; readonly stop?: string; readonly record?: string; readonly clear?: string };
}

/** A device the sequencer can drive: its profile, and the layout of the controls the sequencer uses. */
export interface SequencerDevice {
  readonly profile: DeviceProfile;
  readonly layout: SequencerLayout;
}

export interface SequencerBindings {
  readonly bindings: SurfaceBindingTable;
  /** Roles the profile could not resolve, one line each. Their bindings are omitted, and the rest still work. */
  readonly unresolved: readonly string[];
}

const TRANSPORT_NAMES = ["play", "stop", "record", "clear"] as const;

function fill(template: string, values: Record<string, number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

/**
 * Builds the binding table for a sequencer on a device: three modes (steps, mixer, transport) with the device's
 * mode buttons available in each. Steps and mutes toggle on press. The steps grid is a window onto the sequence,
 * paged by the page size the profile's grid declares. `input` is the connected device input, which transport
 * triggers need.
 */
export function createSequencerBindings(input: MidiInput, device: SequencerDevice, contract: SequencerContract): SequencerBindings {
  const { profile, layout } = device;
  const unresolved: string[] = [];
  const hasControl = (controlId: string) => profile.controls.some((control) => control.id === controlId);

  const grid: ControlGrid | undefined = profile.grids?.find((candidate) => candidate.paging);
  if (!grid) unresolved.push("step grid (a grid with paging)");

  const modeBindings: ModeBinding[] = [];
  for (const { controlId, mode } of layout.modeButtons) {
    if (!hasControl(controlId)) {
      unresolved.push(`mode: ${mode} (control ${controlId})`);
      continue;
    }
    modeBindings.push({ kind: "navigate", physicalControlId: controlId, role: `mode: ${mode}`, navigate: { kind: "set-mode", mode } });
  }

  const pageBindings: ModeBinding[] = [];
  if (grid) {
    for (const [side, controlId, column] of [
      ["page left", layout.pageLeft, -1],
      ["page right", layout.pageRight, 1],
    ] as const) {
      if (controlId === undefined) continue;
      if (!hasControl(controlId)) {
        unresolved.push(`${side} (control ${controlId})`);
        continue;
      }
      pageBindings.push({ kind: "navigate", physicalControlId: controlId, role: side, navigate: { kind: "page", gridId: grid.id, direction: { row: 0, column } } });
    }
  }

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
      }))
    : [];

  // The grid's top row (row 0) mutes tracks 1-8, one track per column.
  const muteBindings: ModeBinding[] = cells
    .filter((cell) => cell.row === 0)
    .map((cell) => ({
      kind: "control",
      physicalControlId: cell.controlId,
      role: `mute ${cell.column + 1}`,
      resolve: { kind: "static", controlId: fill(contract.muteTemplate, { track: cell.column + 1 }) },
      press: "toggle",
    }));

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
    { mode: "steps", bindings: [...modeBindings, ...pageBindings, ...stepBindings], activateOn: { scope: "step" } },
    { mode: "mixer", bindings: [...modeBindings, ...muteBindings], activateOn: { scope: "track" } },
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
