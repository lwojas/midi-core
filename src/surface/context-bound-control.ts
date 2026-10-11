import type { Control, ControlDef, ControlValue, Unsubscribe } from "../control-api/types/control.js";
import type { ControlRegistry } from "../control-api/types/registry.js";
import type { SurfaceContext } from "../control-api/types/context.js";
import { resolveControlId, type ControlIdResolution } from "./types/bindings.js";

/** A `Control` whose target can change, plus `dispose()` to release its subscriptions. */
export interface ContextBoundControl<D extends ControlDef> extends Control<D> {
  dispose(): void;
}

/**
 * A stable `Control` whose target is resolved from the application's current `Selection` (ECS-140) — the live
 * counterpart to `resolveControlId()`'s `"from-selection"` case, which only ever resolves once, at the moment it's
 * called. That's exactly the gap this fixes: nothing between that one-shot resolution and a full mode rebind
 * previously made a `"from-selection"` binding notice a *later* selection change (e.g. a different track becoming
 * selected while the same mode, and the same physical encoder, stay live) — the same "retarget on change, re-emit
 * only if the value actually moved" idiom `createWindowedControl` already uses for a grid's page turn, just keyed
 * on `SurfaceContext.onChange()` instead of `SurfaceNavigation.onChange()`. A binding's feedback (an LED, a display
 * line) repaints when the selection moves; the binding itself never has to be rebuilt.
 *
 * `fallbackDef` supplies this control's shape and resting value for the window where nothing is currently
 * selected (or the resolved id isn't in `registry`, or resolves to a control of a different `kind`) and so no
 * target resolves at all: `getValue()` reports `fallbackDef.default` and `setValue()` is a no-op, same as
 * `createWindowedControl` reporting `false` with no target. Every concrete target a given role can ever resolve to
 * is expected to share one `ControlDef` kind (every track's volume is a number, on the same range) — once any target resolves,
 * `def` reports *that* target's own def in place of the fallback, so range/step/unit always reflect live
 * application state rather than a guess baked in at bind time.
 */
export function createContextBoundControl<D extends ControlDef>(
  resolution: Extract<ControlIdResolution, { kind: "from-selection" }>,
  registry: ControlRegistry,
  context: SurfaceContext,
  fallbackDef: D,
): ContextBoundControl<D> {
  const listeners = new Set<(value: ControlValue<D>, previous: ControlValue<D>) => void>();
  let target: Control<D> | undefined;
  let unsubscribeTarget: Unsubscribe | undefined;
  let last: ControlValue<D>;

  const resolveTarget = (): Control<D> | undefined => {
    const controlId = resolveControlId(resolution, context);
    if (controlId === undefined) return undefined;
    const control = registry.getControl(controlId);
    // Any settable, relative-turnable kind (number, boolean, enum): `resolveIncomingValue()` reads the live target's
    // own `def`, so a toggle or an enum is stepped as one rather than being refused for not matching a numeric
    // fallback. A string has no relative meaning, so it is still not a target.
    return control !== undefined && control.def.kind !== "string" ? (control as unknown as Control<D>) : undefined;
  };

  const currentValue = (): ControlValue<D> => target?.getValue() ?? (fallbackDef.default as ControlValue<D>);

  function emitIfChanged(): void {
    const next = currentValue();
    if (next === last) return;
    const previous = last;
    last = next;
    for (const listener of listeners) listener(next, previous);
  }

  function retarget(): void {
    unsubscribeTarget?.();
    target = resolveTarget();
    unsubscribeTarget = target?.onChange(() => emitIfChanged());
  }

  retarget();
  last = currentValue();
  const unsubscribeContext = context.onChange(() => {
    retarget();
    emitIfChanged();
  });

  return {
    get def() {
      return target?.def ?? fallbackDef;
    },
    getValue: currentValue,
    setValue: (value) => target?.setValue(value),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      unsubscribeContext();
      unsubscribeTarget?.();
      listeners.clear();
    },
  };
}
