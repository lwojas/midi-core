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
export interface SurfaceNavigationOptions {
  /** Applied to every `pageBy()` result before it's stored, so paging can't leave the sequence (ECS-89). */
  readonly clamp?: (offset: GridOffset) => GridOffset;
  /**
   * Asked before `setMode()` switches to a different mode. False refuses the switch: the state stays as it was and no
   * listener is told (ECS-104, a mode whose ports aren't connected).
   */
  readonly canSetMode?: (mode: SurfaceModeId) => boolean;
}

export function createSurfaceNavigation(initial: SurfaceNavigationState, options: SurfaceNavigationOptions = {}): SurfaceNavigation {
  let state = initial;
  const clamp = options.clamp ?? ((offset: GridOffset) => offset);
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
      if (mode !== state.mode && options.canSetMode && !options.canSetMode(mode)) return;
      applyState({ ...state, mode });
    },
    pageBy(delta: GridOffset) {
      // A mode with no gridOffset at all (e.g. Transport) has nothing to page --
      // this is a no-op, not a fabricated { row: 0, column: 0 } origin for a mode
      // that was never given one. See docs/contracts/surface-navigation.md.
      if (!state.gridOffset) return;
      applyState({
        ...state,
        gridOffset: clamp({ row: state.gridOffset.row + delta.row, column: state.gridOffset.column + delta.column }),
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
