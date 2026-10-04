import { bindActiveMode, type BindSurfaceModeDeps, type SurfaceModeTeardown } from "./bindings.js";
import type { SurfaceBindingTable } from "./types/bindings.js";
import type { SurfaceNavigation } from "./types/navigation.js";

/**
 * Switches the currently-bound mode: tears down `previousTeardown` (the
 * outgoing mode's bindings) before installing `table`'s entry for
 * `navigation.state.mode` (the incoming mode) — "unbinding the outgoing
 * mode's mappings and binding the incoming mode's," exactly the sequence
 * `docs/control-surface-architecture.md` already specified, as one
 * explicit, awaitable step built from pieces ECS-69 already has
 * (`bindActiveMode()`). Unbind always completes before bind starts, so a
 * physical control two modes both assign (to different roles) is never
 * briefly bound to both at once.
 *
 * Deliberately explicit, not a hidden reactive subscription to
 * `navigation.onChange()`: nothing yet owns the event loop a silent
 * "subscribe and rebind in the background" would run on — that's
 * `ControlSurface.attach()` (ECS-76, not built yet). Whatever calls
 * `navigation.setMode()` in response to a hardware mode button (or a
 * test, for now) is exactly what should also await this, the same way
 * `bindSurfaceMode()` itself is already called explicitly rather than
 * self-triggering. Call it only when the mode actually changed — `switchMode`
 * does not check `previousTeardown`'s mode against the new one itself,
 * since it has no way to know what mode `previousTeardown` was for; a
 * caller already holds both the old and new `SurfaceNavigationState`
 * from the `SurfaceNavigationChange` that prompted the switch and is the
 * one place that comparison belongs.
 */
export async function switchMode(
  table: SurfaceBindingTable,
  navigation: SurfaceNavigation,
  previousTeardown: SurfaceModeTeardown,
  deps: BindSurfaceModeDeps,
): Promise<SurfaceModeTeardown> {
  await previousTeardown();
  return bindActiveMode(table, navigation, deps);
}
