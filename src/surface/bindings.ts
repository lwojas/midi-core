import { createAction } from "../control-api/action.js";
import type { BooleanControlDef, Control, ControlDef, ControlValue } from "../control-api/types/control.js";
import type { SurfaceContext } from "../control-api/types/context.js";
import type { ControlRegistry } from "../control-api/types/registry.js";
import type { Unsubscribe } from "../core/types/discovery.js";
import type { MidiInput } from "../core/types/input.js";
import type { MidiOutput } from "../core/types/output.js";
import type { MidiSource, MidiTarget } from "../mapping/types/address.js";
import type { ControlMapping } from "../mapping/types/mapping.js";
import { bindControlMapping } from "../mapping/bind.js";
import { buildFeedbackMessage } from "../mapping/value.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import { bindActionTrigger } from "./action-binding.js";
import { toMidiSource, toMidiTarget } from "./generate.js";
import { resolveControlId } from "./types/bindings.js";
import type {
  ControlBinding,
  ControlPress,
  ModeBinding,
  NavigationBinding,
  SurfaceBindingTable,
  SurfaceModeDefinition,
  WindowedControlBinding,
} from "./types/bindings.js";
import type { GenerateControlMappings } from "./types/generation.js";
import type { SurfaceNavigation } from "./types/navigation.js";
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
  feedback: { target: MidiTarget; output: MidiOutput; kind: string | undefined } | undefined,
): { unsubscribe: Unsubscribe; painter?: FeedbackPainter } {
  const action = createAction({ id: `toggle.${control.def.id}`, label: control.def.label }, () => control.setValue(!control.getValue()));
  const unbindTrigger = bindActionTrigger(input, source, action);
  if (!feedback) return { unsubscribe: unbindTrigger };

  const send = (value: boolean) => {
    const message = buildFeedbackMessage(feedback.target, control.def, value);
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

function fillTemplate(template: string, row: number, column: number): string {
  return template
    .split("{row}")
    .join(String(row))
    .split("{column}")
    .join(String(column))
    .split("{track}")
    .join(String(row + 1));
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
    const handle = bindToggle(input, source, control as Control<BooleanControlDef>, target && output ? { target, output, kind: physical.feedback?.kind } : undefined);
    unsubscribes.push(handle.unsubscribe);
    if (handle.painter) painters.push(handle.painter);
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
        const control = deps.registry.getControl(fillTemplate(binding.template, cell.row + offset.row, cell.column + offset.column));
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
      const handle = bindToggle(input, source, windowed, target && output ? { target, output, kind: physical.feedback?.kind } : undefined);
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
