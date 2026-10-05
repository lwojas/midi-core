import type { SurfaceContext } from "../control-api/types/context.js";
import type { ControlRegistry } from "../control-api/types/registry.js";
import type { Unsubscribe } from "../core/types/discovery.js";
import type { ConnectionState } from "../core/types/lifecycle.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import type { DevicePortProfile } from "../profile/types/port.js";
import { bindActiveMode, type SurfacePorts } from "./bindings.js";
import type { SurfaceModeTeardown } from "./bindings.js";
import type { GenerateControlMappings } from "./types/generation.js";
import { switchMode } from "./mode-switching.js";
import { bindSelectionModePolicy } from "./selection-policy.js";
import { createSurfaceNavigation } from "./navigation.js";
import type { SurfaceError } from "./types/errors.js";
import { isValidSurfaceTransition, type SurfaceLifecycleChange, type SurfaceLifecycleState } from "./types/lifecycle.js";
import type { SurfaceNavigationState } from "./types/navigation.js";
import type { SurfaceBindingTable } from "./types/bindings.js";
import type { ControlSurface } from "./types/runtime.js";
import { runDeviceSetup } from "./setup.js";

export interface ControlSurfaceDeps {
  readonly profile: DeviceProfile;
  /** Resolved live ports, keyed by `DevicePortProfile.id` — resolved before construction, per `docs/contracts/surface-lifecycle.md`. */
  readonly ports: SurfacePorts;
  readonly bindingTable: SurfaceBindingTable;
  readonly context: SurfaceContext;
  readonly registry: ControlRegistry;
  readonly generate: GenerateControlMappings;
  readonly initialNavigation: SurfaceNavigationState;
}

/**
 * The reference `ControlSurface` implementation
 * (`docs/contracts/surface-lifecycle.md`, ECS-66), wiring attach/detach,
 * device setup, spontaneous-disconnect detection, and mode
 * switching to the real pieces this project already has
 * (`bindActiveMode`/`switchMode`, ECS-69/75) — the "runtime foundation"
 * those tickets built this on top of.
 */
export function createControlSurface(deps: ControlSurfaceDeps): ControlSurface {
  const navigation = createSurfaceNavigation(deps.initialNavigation);

  let state: SurfaceLifecycleState = "detached";
  const stateListeners = new Set<(change: SurfaceLifecycleChange) => void>();
  const errorListeners = new Set<(error: SurfaceError) => void>();

  let currentModeTeardown: SurfaceModeTeardown | undefined;
  let unsubscribeNavigation: Unsubscribe | undefined;
  let unsubscribeSelectionPolicy: Unsubscribe | undefined;
  const connectionWatchers: Unsubscribe[] = [];
  const connectedPortIds = new Set<string>();
  let detachRequested = false;
  let modeSwitchQueue: Promise<void> = Promise.resolve();

  function transitionTo(next: SurfaceLifecycleState): void {
    const from = state;
    if (!isValidSurfaceTransition(from, next)) {
      throw new Error(`Invalid Control Surface lifecycle transition: ${from} -> ${next}`);
    }
    state = next;
    const change: SurfaceLifecycleChange = { from, to: next };
    for (const listener of stateListeners) listener(change);
  }

  function reportError(error: SurfaceError): void {
    for (const listener of errorListeners) listener(error);
  }

  function requiredPorts(): readonly DevicePortProfile[] {
    return deps.profile.ports.filter((port) => port.required);
  }

  function resolvePort(port: DevicePortProfile) {
    return port.type === "input" ? deps.ports.inputs[port.id] : deps.ports.outputs[port.id];
  }

  /** Watches a connected port for leaving `"connected"` on its own — not via our own `detach()` — per surface-lifecycle.md's distinction between a spontaneous failure and a graceful disconnect. */
  function watchForSpontaneousDisconnect(port: DevicePortProfile, connection: { onStateChange(listener: (state: ConnectionState, previous: ConnectionState) => void): Unsubscribe }): void {
    connectionWatchers.push(
      connection.onStateChange((next) => {
        if (detachRequested || next === "connected") return;
        const error: SurfaceError = { code: "port-unavailable", message: `Port "${port.id}" left "connected" unexpectedly.` };
        reportError(error);
        if (isValidSurfaceTransition(state, "error")) transitionTo("error");
      }),
    );
  }

  function clearConnectionWatchers(): void {
    for (const unwatch of connectionWatchers) unwatch();
    connectionWatchers.length = 0;
  }

  function enqueueModeSwitch(work: () => Promise<void>): void {
    modeSwitchQueue = modeSwitchQueue.then(work, work);
  }

  async function installInitialMode(): Promise<void> {
    currentModeTeardown = await bindActiveMode(deps.bindingTable, navigation, bindDeps());
  }

  function bindDeps() {
    return { profile: deps.profile, context: deps.context, registry: deps.registry, ports: deps.ports, generate: deps.generate };
  }

  async function teardownCurrentMode(): Promise<void> {
    const teardown = currentModeTeardown;
    currentModeTeardown = undefined;
    if (teardown) await teardown();
  }

  async function attach(): Promise<void> {
    if (state !== "detached") {
      throw new Error(`attach() called while not detached (current state: "${state}")`);
    }

    transitionTo("attaching");
    detachRequested = false;

    try {
      for (const port of requiredPorts()) {
        const connection = resolvePort(port);
        if (!connection) {
          throw { code: "port-unavailable", message: `Required port "${port.id}" was not supplied.` } satisfies SurfaceError;
        }
        try {
          await connection.connect();
        } catch (cause) {
          throw { code: "port-unavailable", message: `Required port "${port.id}" failed to connect.`, cause } satisfies SurfaceError;
        }
        connectedPortIds.add(port.id);
        watchForSpontaneousDisconnect(port, connection);
      }

      if (deps.profile.setup) {
        await runDeviceSetup(deps.profile.setup, deps.ports);
      }
    } catch (error) {
      const surfaceError: SurfaceError = isSurfaceError(error) ? error : { code: "unknown", message: "attach() failed.", cause: error };
      reportError(surfaceError);
      transitionTo("error");
      throw surfaceError;
    }

    transitionTo("attached");

    await installInitialMode();

    unsubscribeSelectionPolicy = bindSelectionModePolicy(deps.bindingTable, deps.context, navigation);

    unsubscribeNavigation = navigation.onChange((change) => {
      if (change.from.mode === change.to.mode) return;
      enqueueModeSwitch(async () => {
        if (state !== "attached") return;
        try {
          currentModeTeardown = await switchMode(deps.bindingTable, navigation, currentModeTeardown ?? (async () => {}), bindDeps());
        } catch (cause) {
          reportError({ code: "unknown", message: "Mode switch failed.", cause });
        }
      });
    });
  }

  async function detach(): Promise<void> {
    if (state === "detached" || state === "detaching") return;

    const recoveringFromError = state === "error";
    if (!recoveringFromError) transitionTo("detaching");

    detachRequested = true;
    unsubscribeNavigation?.();
    unsubscribeNavigation = undefined;
    unsubscribeSelectionPolicy?.();
    unsubscribeSelectionPolicy = undefined;
    await modeSwitchQueue;
    clearConnectionWatchers();
    await teardownCurrentMode();

    try {
      for (const port of requiredPorts()) {
        if (!connectedPortIds.has(port.id)) continue;
        const connection = resolvePort(port);
        await connection?.disconnect();
        connectedPortIds.delete(port.id);
      }
    } catch (cause) {
      const surfaceError: SurfaceError = { code: "unknown", message: "detach() failed to disconnect a port.", cause };
      reportError(surfaceError);
      if (!recoveringFromError) transitionTo("error");
      throw surfaceError;
    }

    transitionTo("detached");
  }

  return {
    profile: deps.profile,
    get state() {
      return state;
    },
    navigation,
    attach,
    detach,
    onStateChange(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    onError(listener) {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
  };
}

function isSurfaceError(value: unknown): value is SurfaceError {
  return typeof value === "object" && value !== null && "code" in value && "message" in value;
}
