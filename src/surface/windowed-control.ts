import type { Control, ControlDef, ControlValue } from "../control-api/types/control.js";
import type { Unsubscribe } from "../core/types/discovery.js";
/** Anything that says "re-resolve my target now": a page turn, a selection change, or both composed. */
export interface RetargetSignal {
  onChange(listener: () => void): Unsubscribe;
}

/** A `Control` whose target can change, plus `dispose()` to release its subscriptions. */
export interface WindowedControl<D extends ControlDef = ControlDef> extends Control<D> {
  dispose(): void;
}

/**
 * A stable `Control` for one physical cell of a windowed grid (ECS-89). It reads and writes whichever
 * application control `resolveTarget()` currently returns. Its own `onChange` fires on every change to
 * the current target, and on every page turn that changes the value it reports, so a binding's
 * feedback (an LED) repaints when the window moves. The binding itself never has to be rebuilt.
 *
 * Generic over `ControlDef` (originally boolean-only, for the step/mute/selection grids): `def` is only
 * the resting shape/value for the window where nothing has resolved yet, the same role
 * `createContextBoundControl()`'s `fallbackDef` plays for a selection-bound control. `.def` itself is a
 * getter that reports the *live* target's own def once one resolves, so a numeric window (a bank of
 * encoders onto per-track volumes, say) always reads the real control's range rather than a guessed one
 * baked in at bind time — the same reasoning `createContextBoundControl()`'s own doc comment gives.
 */
export function createWindowedControl<D extends ControlDef>(
  def: D,
  resolveTarget: () => Control<D> | undefined,
  navigation: RetargetSignal,
): WindowedControl<D> {
  const listeners = new Set<(value: ControlValue<D>, previous: ControlValue<D>) => void>();
  let target: Control<D> | undefined;
  let unsubscribeTarget: Unsubscribe | undefined;
  let last: ControlValue<D>;

  const currentValue = (): ControlValue<D> => target?.getValue() ?? (def.default as ControlValue<D>);

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
  const unsubscribeNavigation = navigation.onChange(() => {
    retarget();
    emitIfChanged();
  });

  return {
    get def() {
      return target?.def ?? def;
    },
    getValue: currentValue,
    setValue: (value) => target?.setValue(value),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      unsubscribeNavigation();
      unsubscribeTarget?.();
      listeners.clear();
    },
  };
}
