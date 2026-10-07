import { createAction } from "../control-api/action.js";
import type { BooleanControlDef, Control, ControlDef, ControlValue, NumericControlDef } from "../control-api/types/control.js";
import type { SurfaceContext } from "../control-api/types/context.js";
import type { ControlRegistry } from "../control-api/types/registry.js";
import type { Unsubscribe } from "../core/types/discovery.js";
import type { MidiInput } from "../core/types/input.js";
import type { MidiOutput } from "../core/types/output.js";
import type { MidiSource, MidiTarget, RgbColour } from "../mapping/types/address.js";
import type { ControlMapping } from "../mapping/types/mapping.js";
import { bindControlMapping } from "../mapping/bind.js";
import { buildFeedbackMessage } from "../mapping/value.js";
import type { PhysicalControl } from "../profile/types/control.js";
import type { GridCell } from "../profile/types/grid.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import { bindActionTrigger } from "./action-binding.js";
import { toMidiSource, toMidiTarget } from "./generate.js";
import { resolveControlId } from "./types/bindings.js";
import type {
  ControlBinding,
  ControlPress,
  IndicatorBinding,
  ModeBinding,
  NavigationBinding,
  SurfaceBindingTable,
  SurfaceModeDefinition,
  WindowedControlBinding,
} from "./types/bindings.js";
import type { GenerateControlMappings } from "./types/generation.js";
import type { GridOffset, SurfaceNavigation } from "./types/navigation.js";
import { createWindowedControl } from "./windowed-control.js";

/**
 * Resolved live ports, keyed by `DevicePortProfile.id` — the same
 * "resolution already happened before construction" stance
 * `docs/contracts/surface-lifecycle.md` takes for `ControlSurface`
 * itself.
 */
export interface SurfacePorts {
  readonly inputs: Readonly<Record<string, MidiInput>>;
  readonly outputs: Readonly<Record<string, MidiOutput>>;
}

export interface BindSurfaceModeDeps {
  readonly profile: DeviceProfile;
  readonly context: SurfaceContext;
  readonly registry: ControlRegistry;
  readonly ports: SurfacePorts;
  readonly generate: GenerateControlMappings;
  /** Needed for navigation bindings and grid windows. Without it those bindings are not installed. */
  readonly navigation?: SurfaceNavigation;
}

/** `bindSurfaceMode`/`bindActiveMode`'s teardown — unlike the plain, synchronous `Unsubscribe` every other binding in this project returns, this one awaits `hooks.onExit` (which may itself be async) before resolving. */
export type SurfaceModeTeardown = () => Promise<void>;

function isControlBinding(binding: ModeBinding): binding is ControlBinding {
  return binding.kind === "control";
}

function isNavigationBinding(binding: ModeBinding): binding is NavigationBinding {
  return binding.kind === "navigate";
}

function isWindowedBinding(binding: ModeBinding): binding is WindowedControlBinding {
  return binding.kind === "window";
}

function isIndicatorBinding(binding: ModeBinding): binding is IndicatorBinding {
  return binding.kind === "indicator";
}

/**
 * Inert `MidiOutput` passed to `bindControlMapping()` when a mapping has
 * no `feedback` (so `output` is never read — see `src/mapping/bind.ts`)
 * and no output port was resolved for it either. Never actually used for
 * I/O; exists only because `bindControlMapping()`'s signature always
 * takes an `output`.
 */
const NULL_OUTPUT: MidiOutput = {
  port: { id: "", type: "output", name: null, manufacturer: null },
  state: "disconnected",
  connect: () => Promise.resolve(),
  disconnect: () => Promise.resolve(),
  onStateChange: () => () => {},
  onError: () => () => {},
  send: () => {
    throw new Error(
      "surface runtime: NULL_OUTPUT.send() was invoked — unreachable, since bindControlMapping() only sends through output when mapping.feedback is set",
    );
  },
};

/**
 * A toggle: each press flips `control`, and release is ignored. The control's own changes drive the
 * feedback, so the LED shows the value the press produced. Its initial value is painted on bind, and it
 * is cleared on unbind unless it's motorized (ECS-89).
 */
function bindToggle(
  input: MidiInput,
  source: MidiSource,
  control: Control<BooleanControlDef>,
  feedback: { target: MidiTarget; output: MidiOutput; kind: string | undefined; lit?: RgbColour } | undefined,
): { unsubscribe: Unsubscribe; painter?: FeedbackPainter } {
  const action = createAction({ id: `toggle.${control.def.id}`, label: control.def.label }, () => control.setValue(!control.getValue()));
  const unbindTrigger = bindActionTrigger(input, source, action);
  if (!feedback) return { unsubscribe: unbindTrigger };

  const send = (value: boolean) => {
    const message = buildFeedbackMessage(feedback.target, control.def, value, feedback.lit);
    if (message !== undefined) feedback.output.send(message);
  };
  const unbindFeedback = control.onChange((value) => send(value));
  return {
    unsubscribe: () => {
      unbindTrigger();
      unbindFeedback();
    },
    painter: {
      paint: () => send(control.getValue()),
      clear: () => {
        if (feedback.kind !== "motorized") send(false);
      },
    },
  };
}

/** A feedback-bearing binding's LED or motor, painted from current state on enter and (for LEDs) cleared on exit. */
interface FeedbackPainter {
  paint(): void;
  clear(): void;
}

/** What a control rests at when a mode releases it: off for a boolean, the bottom of the range for a number. */
function restValue(def: ControlDef): ControlValue<ControlDef> | undefined {
  if (def.kind === "boolean") return false as ControlValue<ControlDef>;
  if (def.kind === "number") return def.min as ControlValue<ControlDef>;
  return undefined;
}

/**
 * The virtual row and column of a window's cell: its grid position plus the page offset. A horizontal window swaps the
 * grid's axes, so its tracks run across the columns (ECS-95).
 */
function windowPosition(binding: WindowedControlBinding, cell: { row: number; column: number }, offset: GridOffset): [number, number] {
  return binding.orientation === "horizontal"
    ? [offset.row + cell.column, offset.column + cell.row]
    : [offset.row + cell.row, offset.column + cell.column];
}

function fillTemplate(template: string, row: number, column: number): string {
  return template
    .split("{row}")
    .join(String(row))
    .split("{column}")
    .join(String(column))
    .split("{track}")
    .join(String(row + 1));
}

/**
 * A `"toggle"` window cell whose LED composes more than its own control's on/off (ECS-127, ECS-131), in place of
 * `bindToggle`'s plain single-colour feedback: the cell's own `template` control (active, full `colour`), an
 * earlier active cell's duration reaching this one on the current page (continuation, `continuationColour`), and
 * the shared playhead column (always painted last, so it's the one thing never obscured by the other two). A
 * press still only ever toggles this cell's own `template` control — duration and the playhead are feedback-only
 * signals this cell merely reads, the same "a press never writes a control it doesn't own" rule `IndicatorBinding`
 * and the bank-select buttons already follow.
 *
 * Re-subscribes its predecessor and playhead controls on every navigation change, since a page turn changes which
 * application controls those virtual positions actually name — the same reason `createWindowedControl` retargets
 * its own control on `navigation.onChange()`.
 */
function bindStepFeedback(
  binding: WindowedControlBinding,
  physical: PhysicalControl,
  cell: GridCell,
  deps: BindSurfaceModeDeps,
  navigation: SurfaceNavigation,
  input: MidiInput,
  source: MidiSource,
): { unsubscribe: Unsubscribe; painter?: FeedbackPainter } {
  const ownDef: BooleanControlDef = { id: `window.${binding.gridId}.${cell.row}.${cell.column}`, label: physical.label, kind: "boolean", default: false };
  const own = createWindowedControl(
    ownDef,
    () => {
      const offset = navigation.state.gridOffset ?? { row: 0, column: 0 };
      const [row, column] = windowPosition(binding, cell, offset);
      const control = deps.registry.getControl(fillTemplate(binding.template, row, column));
      return control?.def.kind === "boolean" ? (control as Control<BooleanControlDef>) : undefined;
    },
    navigation,
  );
  const pressAction = createAction({ id: `toggle.${ownDef.id}`, label: physical.label }, () => own.setValue(!own.getValue()));
  const unbindPress = bindActionTrigger(input, source, pressAction);

  const target = toMidiTarget(physical);
  const output = target ? deps.ports.outputs[physical.feedbackPortId ?? physical.portId] : undefined;
  if (!target || !output) {
    return {
      unsubscribe: () => {
        unbindPress();
        own.dispose();
      },
    };
  }

  const send = (on: boolean, colour: RgbColour | undefined) => {
    const message = buildFeedbackMessage(target, ownDef, on, colour);
    if (message !== undefined) output.send(message);
  };

  /** The active/duration controls one page-relative physical `column` to the left names, at this cell's row. */
  const predecessorAt = (physicalColumn: number): { active?: Control<BooleanControlDef>; duration?: Control<NumericControlDef> } => {
    const offset = navigation.state.gridOffset ?? { row: 0, column: 0 };
    const [row, column] = windowPosition(binding, { row: cell.row, column: physicalColumn }, offset);
    const active = deps.registry.getControl(fillTemplate(binding.template, row, column));
    const duration = binding.durationTemplate !== undefined ? deps.registry.getControl(fillTemplate(binding.durationTemplate, row, column)) : undefined;
    return {
      active: active?.def.kind === "boolean" ? (active as Control<BooleanControlDef>) : undefined,
      duration: duration?.def.kind === "number" ? (duration as Control<NumericControlDef>) : undefined,
    };
  };

  const paint = () => {
    const offset = navigation.state.gridOffset ?? { row: 0, column: 0 };
    const [, column] = windowPosition(binding, cell, offset);

    if (binding.playheadControl !== undefined) {
      const playhead = deps.registry.getControl(binding.playheadControl);
      if (playhead?.def.kind === "number" && (playhead as Control<NumericControlDef>).getValue() === column) {
        send(true, binding.playheadColour);
        return;
      }
    }

    if (own.getValue()) {
      send(true, binding.colour);
      return;
    }

    if (binding.durationTemplate !== undefined) {
      // Nearest predecessor first: an overlapping earlier span still reads as "this cell is covered" either way,
      // but checking from the closest one out keeps the scan proportional to the distance that actually matters.
      for (let j = cell.column - 1; j >= 0; j--) {
        const { active, duration } = predecessorAt(j);
        if (active?.getValue() === true && duration !== undefined && duration.getValue() > cell.column - j) {
          send(true, binding.continuationColour);
          return;
        }
      }
    }

    send(false, undefined);
  };

  let predecessorUnsubscribes: Unsubscribe[] = [];
  let playheadUnsubscribe: Unsubscribe | undefined;
  const resubscribe = () => {
    for (const unsubscribe of predecessorUnsubscribes) unsubscribe();
    predecessorUnsubscribes = [];
    playheadUnsubscribe?.();
    playheadUnsubscribe = undefined;

    if (binding.durationTemplate !== undefined) {
      for (let j = 0; j < cell.column; j++) {
        const { active, duration } = predecessorAt(j);
        if (active) predecessorUnsubscribes.push(active.onChange(paint));
        if (duration) predecessorUnsubscribes.push(duration.onChange(paint));
      }
    }
    if (binding.playheadControl !== undefined) {
      const playhead = deps.registry.getControl(binding.playheadControl);
      if (playhead) playheadUnsubscribe = playhead.onChange(paint);
    }
  };

  resubscribe();
  const unbindOwn = own.onChange(paint);
  const unbindNavigation = navigation.onChange(() => {
    resubscribe();
    paint();
  });

  return {
    unsubscribe: () => {
      unbindPress();
      unbindOwn();
      unbindNavigation();
      for (const unsubscribe of predecessorUnsubscribes) unsubscribe();
      playheadUnsubscribe?.();
      own.dispose();
    },
    painter: { paint, clear: () => send(false, undefined) },
  };
}

function painterFor(
  target: MidiTarget,
  control: Control<ControlDef>,
  output: MidiOutput,
  feedbackKind: string | undefined,
): FeedbackPainter {
  const send = (value: ControlValue<ControlDef> | undefined) => {
    if (value === undefined) return;
    const message = buildFeedbackMessage(target, control.def, value);
    if (message !== undefined) output.send(message);
  };
  return {
    paint: () => send(control.getValue()),
    // A motorized control's position is its value, so leaving the mode must not move it.
    clear: () => {
      if (feedbackKind !== "motorized") send(restValue(control.def));
    },
  };
}

/**
 * Installs one mode's bindings against live MIDI ports: runs `hooks.onEnter`,
 * resolves this mode's `ControlBinding`s to `ControlMapping`s via the injected
 * `generate` (ECS-72), binds each with the existing `bindControlMapping()`
 * (`docs/contracts/mapping-runtime.md`), installs navigation bindings and grid
 * windows (ECS-89), paints each feedback-bearing control from its current value, and
 * returns one teardown. The teardown unbinds everything, clears the LEDs it owned
 * (motorized controls keep their position), then runs `hooks.onExit`.
 *
 * A binding this runtime can't resolve all the way to a live control and port (a
 * dangling reference, a `ControlId` nothing in `registry` has, a port with nothing
 * resolved for it) is silently skipped, not thrown. That's the same "report, don't
 * invent, don't crash a live caller" stance this project takes everywhere else.
 */
export async function bindSurfaceMode(
  modeDefinition: SurfaceModeDefinition | undefined,
  deps: BindSurfaceModeDeps,
): Promise<SurfaceModeTeardown> {
  if (!modeDefinition) {
    return async () => {};
  }

  await modeDefinition.hooks?.onEnter?.();

  const bindings = modeDefinition.hooks?.resolveBindings
    ? modeDefinition.hooks.resolveBindings(deps.context)
    : modeDefinition.bindings ?? [];

  const unsubscribes: Unsubscribe[] = [];
  const painters: FeedbackPainter[] = [];

  const controlBindings = bindings.filter((binding): binding is ControlBinding => isControlBinding(binding) && binding.press !== "toggle");
  const generated = deps.generate(deps.profile, controlBindings, deps.context);
  for (const { mapping, inputPortId, outputPortId } of generated) {
    const control = deps.registry.getControl(mapping.control);
    const input = deps.ports.inputs[inputPortId];
    if (!control || !input) continue;

    const output = outputPortId !== undefined ? deps.ports.outputs[outputPortId] : undefined;
    if (mapping.feedback && !output) continue;

    unsubscribes.push(bindControlMapping(mapping, input, output ?? NULL_OUTPUT, control));
    if (mapping.feedback && output) {
      painters.push(painterFor(mapping.feedback, control, output, feedbackKindOf(deps.profile, mapping.id)));
    }
  }

  for (const binding of bindings.filter((candidate): candidate is ControlBinding => isControlBinding(candidate) && candidate.press === "toggle")) {
    const physical = deps.profile.controls.find((candidate) => candidate.id === binding.physicalControlId);
    const source = physical && toMidiSource(physical);
    const input = physical && deps.ports.inputs[physical.portId];
    const controlId = resolveControlId(binding.resolve, deps.context);
    const control = controlId !== undefined ? deps.registry.getControl(controlId) : undefined;
    if (!physical || !source || !input || !control || control.def.kind !== "boolean") continue;
    const target = toMidiTarget(physical);
    const output = target ? deps.ports.outputs[physical.feedbackPortId ?? physical.portId] : undefined;
    if (target && !output) continue;
    const handle = bindToggle(
      input,
      source,
      control as Control<BooleanControlDef>,
      target && output ? { target, output, kind: physical.feedback?.kind, lit: binding.colour } : undefined,
    );
    unsubscribes.push(handle.unsubscribe);
    if (handle.painter) painters.push(handle.painter);
  }

  // An indicator lights its button while its number control holds the binding's value (ECS-114). Feedback only: nothing is
  // bound from the button, so a press never writes the control.
  for (const binding of bindings.filter(isIndicatorBinding)) {
    const physical = deps.profile.controls.find((candidate) => candidate.id === binding.physicalControlId);
    const target = physical && toMidiTarget(physical);
    const output = physical && deps.ports.outputs[physical.feedbackPortId ?? physical.portId];
    const controlId = resolveControlId(binding.resolve, deps.context);
    const control = controlId !== undefined ? deps.registry.getControl(controlId) : undefined;
    if (!physical || !target || !output || !control || control.def.kind !== "number") continue;

    const number = control as Control<NumericControlDef>;
    const def: BooleanControlDef = { id: `indicator.${binding.physicalControlId}`, label: physical.label, kind: "boolean", default: false };
    const send = (on: boolean) => {
      const message = buildFeedbackMessage(target, def, on, binding.colour);
      if (message !== undefined) output.send(message);
    };
    unsubscribes.push(number.onChange((value) => send(value === binding.lit)));
    painters.push({ paint: () => send(number.getValue() === binding.lit), clear: () => send(false) });
  }

  const navigation = deps.navigation;
  for (const binding of bindings.filter(isNavigationBinding)) {
    const physical = deps.profile.controls.find((candidate) => candidate.id === binding.physicalControlId);
    const source = physical && toMidiSource(physical);
    const input = physical && deps.ports.inputs[physical.portId];
    if (!navigation || !source || !input) continue;
    const navigate = binding.navigate;
    const paging = navigate.kind === "page" ? deps.profile.grids?.find((candidate) => candidate.id === navigate.gridId)?.paging : undefined;
    if (navigate.kind === "page" && !paging) continue;

    const action = createAction({ id: `navigate.${binding.physicalControlId}`, label: binding.role }, () => {
      if (navigate.kind === "set-mode") navigation.setMode(navigate.mode);
      else if (paging) navigation.pageBy({ row: navigate.direction.row * paging.rows, column: navigate.direction.column * paging.columns });
    });
    unsubscribes.push(bindActionTrigger(input, source, action));
  }

  for (const binding of bindings.filter(isWindowedBinding)) {
    const physical = deps.profile.controls.find((candidate) => candidate.id === binding.physicalControlId);
    const grid = deps.profile.grids?.find((candidate) => candidate.id === binding.gridId);
    const cell = grid?.cells.find((candidate) => candidate.controlId === binding.physicalControlId);
    const source = physical && toMidiSource(physical);
    const input = physical && deps.ports.inputs[physical.portId];
    if (!navigation || !physical || !grid || !cell || !source || !input) continue;

    // ECS-127 / ECS-131: a toggle step carrying duration and/or playhead feedback owns its LED alone, composing all
    // three signals into one colour rather than racing a second, independent feedback path against the same pad.
    if (binding.press === "toggle" && (binding.durationTemplate !== undefined || binding.playheadControl !== undefined)) {
      const handle = bindStepFeedback(binding, physical, cell, deps, navigation, input, source);
      unsubscribes.push(handle.unsubscribe);
      if (handle.painter) painters.push(handle.painter);
      continue;
    }

    const def: BooleanControlDef = {
      id: `window.${binding.gridId}.${cell.row}.${cell.column}`,
      label: physical.label,
      kind: "boolean",
      default: false,
    };
    const windowed = createWindowedControl(
      def,
      () => {
        const offset = navigation.state.gridOffset ?? { row: 0, column: 0 };
        const control = deps.registry.getControl(fillTemplate(binding.template, ...windowPosition(binding, cell, offset)));
        return control?.def.kind === "boolean" ? (control as Control<BooleanControlDef>) : undefined;
      },
      navigation,
    );

    const target = toMidiTarget(physical);
    const outputPortId = physical.feedbackPortId ?? physical.portId;
    const output = target ? deps.ports.outputs[outputPortId] : undefined;
    if (target && !output) {
      windowed.dispose();
      continue;
    }

    if (binding.press === "toggle") {
      const handle = bindToggle(
        input,
        source,
        windowed,
        target && output ? { target, output, kind: physical.feedback?.kind, lit: binding.colour } : undefined,
      );
      unsubscribes.push(() => windowed.dispose(), handle.unsubscribe);
      if (handle.painter) painters.push(handle.painter);
      continue;
    }

    const mapping: ControlMapping = { id: binding.physicalControlId, control: def.id, source, ...(target ? { feedback: target } : {}) };
    unsubscribes.push(() => windowed.dispose());
    unsubscribes.push(bindControlMapping(mapping, input, output ?? NULL_OUTPUT, windowed));
    if (target && output) {
      painters.push(painterFor(target, windowed as Control<ControlDef>, output, physical.feedback?.kind));
    }
  }

  for (const painter of painters) painter.paint();

  return async () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    for (const painter of painters) painter.clear();
    await modeDefinition.hooks?.onExit?.();
  };
}

function feedbackKindOf(profile: DeviceProfile, physicalControlId: string): string | undefined {
  return profile.controls.find((candidate) => candidate.id === physicalControlId)?.feedback?.kind;
}

/**
 * Looks up the `SurfaceModeDefinition` matching `navigation.state.mode` in `table` and
 * installs it via `bindSurfaceMode`, passing `navigation` through for navigation bindings
 * and grid windows. A navigation mode with no matching table entry binds nothing, rather
 * than treating a surface with an unconfigured mode as an error.
 */
export async function bindActiveMode(
  table: SurfaceBindingTable,
  navigation: SurfaceNavigation,
  deps: BindSurfaceModeDeps,
): Promise<SurfaceModeTeardown> {
  const modeDefinition = table.find((definition) => definition.mode === navigation.state.mode);
  return bindSurfaceMode(modeDefinition, { ...deps, navigation });
}
