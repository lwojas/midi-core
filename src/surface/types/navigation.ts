import type { Unsubscribe } from "../../core/types/discovery.js";

/**
 * Surface-local navigation: which mode/view is active, and where a
 * paged/scrollable window is currently positioned within it. This is the
 * exact counterpart to `Selection`/`SurfaceContext`
 * (`docs/contracts/control-api.md`, ECS-65): that contract is
 * application-owned and read-only to a surface (selected track/pattern/
 * parameter); this one is surface-owned and read-only to the application
 * — mode, bank/page and grid offset are never written by application
 * code, only by the surface itself, typically in response to a hardware
 * nav control (a "next page" button, a mode button). Mixing the two
 * (letting an application set a surface's page, or a surface overwrite
 * the application's selected track) is exactly what this split exists to
 * prevent.
 */

/**
 * Owner-defined, like `Selection.scope` — this contract doesn't close the
 * list of modes a surface can have. The ticket's four starting examples:
 * `"mixer"`, `"step-grid"`, `"transport"`, `"parameter-control"`.
 */
export type SurfaceModeId = string;

/**
 * The top-left corner of the window currently bound to a physical control
 * grid, within a larger virtual space an application owns (e.g. a 32-step
 * pattern windowed through an 8-pad physical row). Deliberately unrelated
 * to a profile's `ControlGrid.rows`/`columns`
 * (`docs/contracts/device-profile.md`), which describes the physical
 * grid's own fixed size, not the virtual space it's currently windowing —
 * that virtual size is whatever the application's data has, unknown to
 * this contract and not bounded by it.
 */
export interface GridOffset {
  readonly row: number;
  readonly column: number;
}

export interface SurfaceNavigationState {
  readonly mode: SurfaceModeId;
  /** Current window position, for a mode with a paged/scrollable grid. Omitted for a mode with none (e.g. Transport). */
  readonly gridOffset?: GridOffset;
}

export interface SurfaceNavigationChange {
  readonly from: SurfaceNavigationState;
  readonly to: SurfaceNavigationState;
}

/**
 * `setMode()`/`pageBy()` are surface-local actions — a hardware mode
 * button or next/previous control calls these directly; nothing here
 * routes through `Action`/`SurfaceEventSource`
 * (`docs/contracts/control-api.md`), because neither is this: an
 * application `Action` is a command *the application* exposes for a
 * surface (or anything else) to invoke, where navigation is the reverse —
 * something the surface owns and the application never invokes or reads
 * authoritatively.
 *
 * Application context (`SurfaceContext`) may still *influence* which mode
 * gets chosen — e.g. whatever drives `setMode()` is free to read the
 * application's current selection first — but that policy lives in
 * whatever calls `setMode()` (ECS-75), not in this contract: `pageBy`
 * takes a signed delta (bank/page/next/previous are all the same
 * operation at different step sizes) rather than separate `nextPage()`/
 * `previousPage()` methods, so one shape covers all of them without
 * assuming a single scroll axis.
 */
export interface SurfaceNavigation {
  readonly state: SurfaceNavigationState;
  setMode(mode: SurfaceModeId): void;
  pageBy(delta: GridOffset): void;
  onChange(listener: (change: SurfaceNavigationChange) => void): Unsubscribe;
}
