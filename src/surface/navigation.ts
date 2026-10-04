import type {
  GridOffset,
  SurfaceModeId,
  SurfaceNavigation,
  SurfaceNavigationChange,
  SurfaceNavigationState,
} from "./types/navigation.js";

/**
 * Concrete `SurfaceNavigation` (`docs/contracts/surface-navigation.md`,
 * ECS-67): plain in-memory state plus change notification, nothing else —
 * no device, no profile, no mode-switching policy. `setMode()`/`pageBy()`
 * just apply the change and notify whoever's listening; *deciding* which
 * mode a selection should arm is ECS-75's job, built on top of this.
 */
export function createSurfaceNavigation(initial: SurfaceNavigationState): SurfaceNavigation {
  let state = initial;
  const listeners = new Set<(change: SurfaceNavigationChange) => void>();

  function applyState(next: SurfaceNavigationState): void {
    const from = state;
    if (isSameState(from, next)) return;
    state = next;
    const change: SurfaceNavigationChange = { from, to: next };
    for (const listener of listeners) listener(change);
  }

  return {
    get state() {
      return state;
    },
    setMode(mode: SurfaceModeId) {
      applyState({ ...state, mode });
    },
    pageBy(delta: GridOffset) {
      // A mode with no gridOffset at all (e.g. Transport) has nothing to page --
      // this is a no-op, not a fabricated { row: 0, column: 0 } origin for a mode
      // that was never given one. See docs/contracts/surface-navigation.md.
      if (!state.gridOffset) return;
      applyState({
        ...state,
        gridOffset: { row: state.gridOffset.row + delta.row, column: state.gridOffset.column + delta.column },
      });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function isSameState(a: SurfaceNavigationState, b: SurfaceNavigationState): boolean {
  return a.mode === b.mode && a.gridOffset?.row === b.gridOffset?.row && a.gridOffset?.column === b.gridOffset?.column;
}
