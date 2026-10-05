import type { SurfaceContext } from "../control-api/types/context.js";
import type { Unsubscribe } from "../core/types/discovery.js";
import type { SurfaceBindingTable } from "./types/bindings.js";
import type { SurfaceNavigation } from "./types/navigation.js";

/**
 * Switches the surface's mode when the application's selection changes (ECS-89): a mode's `activateOn.scope`
 * names the selection scope that activates it. The surface owns this policy, not the application, so the
 * application only publishes what it selected.
 */
export function bindSelectionModePolicy(table: SurfaceBindingTable, context: SurfaceContext, navigation: SurfaceNavigation): Unsubscribe {
  return context.onChange((selection) => {
    const definition = table.find((candidate) => candidate.activateOn?.scope === selection.scope);
    if (definition && navigation.state.mode !== definition.mode) {
      navigation.setMode(definition.mode);
    }
  });
}
