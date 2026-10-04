import type { Control, ControlId } from "./types/control.js";
import type { ControlRegistry, ControlRegistryChange } from "./types/registry.js";

/**
 * `ControlRegistry` plus the mutation methods its own contract
 * deliberately doesn't name — `docs/contracts/control-api.md` only
 * specifies the read side (`listControls`/`getControl`/`onChange`),
 * mirroring `MidiDiscovery`'s own read-only shape; something still has to
 * actually add/remove a control for a real owner (a track, an FX
 * instance) whose control set can change at runtime. `add`/`remove` are
 * this implementation's own, additive surface — the same pattern
 * `MockMidiOutput.simulateSendFailures()` already uses for a concrete
 * implementation needing more than its contract names.
 */
export interface MutableControlRegistry extends ControlRegistry {
  add(control: Control): void;
  remove(id: ControlId): void;
}

/** The generic, in-memory `ControlRegistry` implementation: a `Map` keyed by `ControlId`, notifying on every `add`/`remove`. */
export function createControlRegistry(initial: readonly Control[] = []): MutableControlRegistry {
  const controls = new Map<ControlId, Control>(initial.map((control) => [control.def.id, control]));
  const listeners = new Set<(change: ControlRegistryChange) => void>();

  function notify(change: ControlRegistryChange): void {
    for (const listener of listeners) listener(change);
  }

  return {
    listControls: () => Array.from(controls.values()),
    getControl: (id) => controls.get(id),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add(control) {
      controls.set(control.def.id, control);
      notify({ type: "added", control });
    },
    remove(id) {
      const control = controls.get(id);
      if (!control) return;
      controls.delete(id);
      notify({ type: "removed", control });
    },
  };
}
