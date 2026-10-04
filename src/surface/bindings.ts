import type { SurfaceContext } from "../control-api/types/context.js";
import type { ControlRegistry } from "../control-api/types/registry.js";
import type { Unsubscribe } from "../core/types/discovery.js";
import type { MidiInput } from "../core/types/input.js";
import type { MidiOutput } from "../core/types/output.js";
import { bindControlMapping } from "../mapping/bind.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import type { ControlBinding, ModeBinding, SurfaceBindingTable, SurfaceModeDefinition } from "./types/bindings.js";
import type { GenerateControlMappings } from "./types/generation.js";
import type { SurfaceNavigation } from "./types/navigation.js";

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
}

/** `bindSurfaceMode`/`bindActiveMode`'s teardown — unlike the plain, synchronous `Unsubscribe` every other binding in this project returns, this one awaits `hooks.onExit` (which may itself be async) before resolving. */
export type SurfaceModeTeardown = () => Promise<void>;

function isControlBinding(binding: ModeBinding): binding is ControlBinding {
  return binding.kind === "control";
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
 * Installs one mode's bindings against live MIDI ports: runs
 * `hooks.onEnter`, resolves this mode's `ControlBinding`s to
 * `ControlMapping`s via the injected `generate` (ECS-72's scope — this is
 * the agreed seam, see `docs/contracts/surface-runtime.md`), binds each
 * with the existing `bindControlMapping()`
 * (`docs/contracts/mapping-runtime.md`), and returns one teardown that
 * unbinds every one of them and then runs `hooks.onExit`.
 *
 * `NavigationBinding`s in `modeDefinition.bindings` are not wired here —
 * see "What's deliberately not here" in `docs/contracts/surface-runtime.md`.
 * A `ControlBinding` this runtime can't resolve all the way to a live
 * `Control` and port (a dangling reference, a `ControlId` nothing in
 * `registry` has, a port id with nothing resolved for it) is silently
 * skipped, not thrown — the same "report, don't invent, don't crash a
 * live caller" stance this project takes everywhere else a mapping might
 * be misconfigured.
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

  const controlBindings = bindings.filter(isControlBinding);
  const generated = deps.generate(deps.profile, controlBindings, deps.context);

  const unsubscribes: Unsubscribe[] = [];

  for (const { mapping, inputPortId, outputPortId } of generated) {
    const control = deps.registry.getControl(mapping.control);
    const input = deps.ports.inputs[inputPortId];
    if (!control || !input) continue;

    const output = outputPortId !== undefined ? deps.ports.outputs[outputPortId] : undefined;
    if (mapping.feedback && !output) continue;

    unsubscribes.push(bindControlMapping(mapping, input, output ?? NULL_OUTPUT, control));
  }

  return async () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    await modeDefinition.hooks?.onExit?.();
  };
}

/**
 * Looks up the `SurfaceModeDefinition` matching `navigation.state.mode`
 * in `table` and installs it via `bindSurfaceMode`. This is the function
 * a `ControlSurface` implementation (ECS-76) calls at the two lifecycle
 * moments `docs/contracts/surface-lifecycle.md` already names — entering
 * `"attached"` to install, entering `"detaching"` to tear down (by
 * awaiting the returned teardown) — without this function knowing
 * anything about ports connecting or a handshake running. A navigation
 * mode with no matching table entry binds nothing, rather than treating a
 * surface with an unconfigured mode as an error.
 */
export async function bindActiveMode(
  table: SurfaceBindingTable,
  navigation: SurfaceNavigation,
  deps: BindSurfaceModeDeps,
): Promise<SurfaceModeTeardown> {
  const modeDefinition = table.find((definition) => definition.mode === navigation.state.mode);
  return bindSurfaceMode(modeDefinition, deps);
}
