import { isValidControlValue, type Control, type ControlDef, type ControlValue } from "./types/control.js";

/**
 * The generic, in-memory `Control` implementation
 * `docs/contracts/control-api.md` (ECS-34/35/65) deliberately left
 * unbuilt ("no concrete `Control`... backed by real sequencer state" was
 * the contract's own scope line). This is that implementation: plain
 * state plus `setValue()`/`onChange()`, with no MIDI, UI or automation
 * knowledge — any of those can call `setValue()` or subscribe via
 * `onChange()` without this module knowing which.
 *
 * **Several independent listeners, not one.** A surface's `ControlMapping`
 * and a UI meter reading the same `Control` are two separate, direct
 * subscribers; neither is a feedback intermediary for the other (the
 * property `docs/architecture.md` and ECS-70's own ticket both require).
 *
 * **`setValue()` throws for an invalid value.** `isValidControlValue()`
 * validates, it doesn't clamp or coerce — this is the one place that
 * enforcement actually happens, the same stance `MidiOutput.send()`
 * already takes for an out-of-range `MidiMessage`: a caller's own bad
 * data is a programming error worth surfacing synchronously, not
 * silently dropping or reinterpreting.
 *
 * **`setValue()` with the value it already holds is a no-op — no
 * `onChange` fires.** Mirrors `isValidSurfaceTransition()`'s "a state
 * never transitions to itself" rule (`docs/contracts/surface-
 * lifecycle.md`) and `createSurfaceNavigation()`'s identical choice
 * (`docs/contracts/surface-runtime.md`): nothing actually changed, so
 * there's nothing for an observer to react to.
 */
export function createControl<D extends ControlDef>(def: D, initial: ControlValue<D> = def.default as ControlValue<D>): Control<D> {
  if (!isValidControlValue(def, initial)) {
    throw new Error(`createControl(${def.id}): initial value ${JSON.stringify(initial)} is not valid for this definition`);
  }

  let value = initial;
  const listeners = new Set<(value: ControlValue<D>, previous: ControlValue<D>) => void>();

  return {
    def,
    getValue: () => value,
    setValue: (next) => {
      if (!isValidControlValue(def, next)) {
        throw new Error(`Control ${def.id}: ${JSON.stringify(next)} is not a valid value for this definition`);
      }
      if (next === value) return;
      const previous = value;
      value = next;
      for (const listener of listeners) listener(value, previous);
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
