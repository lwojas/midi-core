import type { SurfaceEvent, SurfaceEventSource } from "./types/event.js";

/** `SurfaceEventSource` plus `emit()`, the method its own contract deliberately doesn't name — reporting an occurrence is the owner's job (a sequencer firing a step, advancing the playhead), not this contract's. */
export interface EmittableSurfaceEventSource extends SurfaceEventSource {
  emit(event: SurfaceEvent<unknown>): void;
}

/** The generic, in-memory `SurfaceEventSource` implementation: every `emit()` call is pushed to every current listener, in order, nothing retained afterward — matching `docs/contracts/control-api.md`'s "reports each occurrence once instead of holding a value at all." */
export function createSurfaceEventSource(): EmittableSurfaceEventSource {
  const listeners = new Set<(event: SurfaceEvent<unknown>) => void>();

  return {
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
  };
}
