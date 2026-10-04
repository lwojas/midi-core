import type { Selection, SurfaceContext } from "./types/context.js";

/**
 * `SurfaceContext` plus the one mutation method its own contract
 * deliberately doesn't name — "the application is the only writer" per
 * `docs/contracts/control-api.md`, but something concrete still has to be
 * that writer. `setSelection()` is this implementation's own, additive
 * surface, the same pattern `MutableControlRegistry.add()`/`remove()`
 * use for `ControlRegistry`.
 *
 * **No `clearSelection()`.** `SurfaceContext.onChange`'s own signature —
 * `(selection: Selection) => void` — has no way to report "scope X no
 * longer has a selection," only ever a new one. Adding a method that
 * can't be observed through the contract it's mutating would be exactly
 * the kind of invented behavior this project avoids; a scope with no
 * selection yet is already representable (`getSelection()` returning
 * `undefined`), it just can't be *returned to* once set. If a concrete
 * integration needs that, it's a gap in `docs/contracts/control-api.md`
 * (ECS-65) to revisit, not something to work around here.
 */
export interface MutableSurfaceContext extends SurfaceContext {
  setSelection(selection: Selection): void;
}

/** The generic, in-memory `SurfaceContext` implementation: a `Map` keyed by `Selection.scope`, notifying on every `setSelection()`. */
export function createSurfaceContext(initial: readonly Selection[] = []): MutableSurfaceContext {
  const selections = new Map<string, Selection>(initial.map((selection) => [selection.scope, selection]));
  const listeners = new Set<(selection: Selection) => void>();

  return {
    listSelections: () => Array.from(selections.values()),
    getSelection: (scope) => selections.get(scope),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSelection(selection) {
      selections.set(selection.scope, selection);
      for (const listener of listeners) listener(selection);
    },
  };
}
