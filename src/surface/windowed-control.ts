import type { BooleanControlDef, Control } from "../control-api/types/control.js";
import type { Unsubscribe } from "../core/types/discovery.js";
import type { SurfaceNavigation } from "./types/navigation.js";

/** A boolean `Control` whose target can change, plus `dispose()` to release its subscriptions. */
export interface WindowedControl extends Control<BooleanControlDef> {
  dispose(): void;
}

/**
 * A stable `Control` for one physical cell of a windowed grid (ECS-89). It reads and writes whichever
 * application control `resolveTarget()` currently returns. Its own `onChange` fires on every change to
 * the current target, and on every page turn that changes the value it reports, so a binding's
 * feedback (an LED) repaints when the window moves. The binding itself never has to be rebuilt.
 */
export function createWindowedControl(
  def: BooleanControlDef,
  resolveTarget: () => Control<BooleanControlDef> | undefined,
  navigation: SurfaceNavigation,
): WindowedControl {
  const listeners = new Set<(value: boolean, previous: boolean) => void>();
  let target: Control<BooleanControlDef> | undefined;
  let unsubscribeTarget: Unsubscribe | undefined;
  let last = false;

  const currentValue = (): boolean => target?.getValue() ?? false;

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
    def,
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
