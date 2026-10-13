# Control Surface — Modes and Navigation

Status: Draft
Source of truth: [`src/surface/types/navigation.ts`](../../src/surface/types/navigation.ts)

## Scope

Mode switching is a batch unbind/rebind of `ControlMapping`s around a
lifecycle event, and navigation/mapping behavior belongs in the surface,
not device profiles. This contract defines how a surface represents its
active mode and owns bank, page, and grid offset; it does not implement
mode switching or unbind/rebind.

## Two kinds of state, two owners, never confused

Application selection and surface-local navigation have separate
interfaces with opposite ownership:

|                              | Owner       | Contract                                                         | Examples                                             |
| ---------------------------- | ----------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| **Application selection**    | Application | `Selection` / `SurfaceContext` (`docs/contracts/control-api.md`) | selected track, selected pattern, selected parameter |
| **Surface-local navigation** | Surface     | `SurfaceNavigationState` / `SurfaceNavigation`                   | active mode, bank/page, grid offset                  |

`SurfaceContext` already has no `setSelection()` — the application is its
only writer. `SurfaceNavigation` is the mirror image: a surface's
`setMode()`/`pageBy()` are called by the surface itself (typically from a
hardware mode or next/previous control), and nothing in the application
contract can reach them. Neither interface gained a method that would
let the other side write into it.

## Why not a single string

`SurfaceContext` is keyed by `scope` (`listSelections()`/
`getSelection(scope)`) so selected track, selected pattern, and selected
parameter can all exist and change independently instead of being encoded
in one opaque context string. `SurfaceNavigationState` likewise stores
`mode` and `gridOffset` as separate fields, not one encoded string
(`"step-grid:page=2"`), so a future mode with more axes doesn't force a
new serialization format — it adds a field.

## Mode: owner-defined, not a closed enum

```ts
export type SurfaceModeId = string;
```

The same reasoning `Selection.scope` and `DevicePortProfile.role` already
apply: this contract doesn't close the list of modes a surface can have,
since that would be exactly the kind of fixed catalog
`docs/contracts/control-api.md` already refuses for controls
(`TrackControls`, `TransportControls`). The four examples —
**Mixer**, **Step Grid**, **Transport**, **Parameter Control** — are
documented conventions (`"mixer"`, `"step-grid"`, `"transport"`,
`"parameter-control"`), not an enforced union; a profile or integration
naming a fifth mode needs no change here.

## Bank/page/grid offset: one shape, not three

```ts
export interface GridOffset {
  readonly row: number;
  readonly column: number;
}
```

"Bank/page" and "grid offset" describe the same thing here:
the top-left corner of whatever window is currently bound onto a physical
control grid — so one `GridOffset` shape covers all of it rather than
three parallel fields that would always change together. This is
deliberately **unrelated** to a profile's `ControlGrid.rows`/`columns`
(`docs/contracts/device-profile.md`), which describes the physical grid's
own fixed size. `GridOffset` indexes into a larger _virtual_ space an
application's own data defines (a 32-step pattern windowed through an
8-pad physical row) — a size this contract doesn't know and doesn't
bound. `gridOffset` is optional on `SurfaceNavigationState` because not
every mode has a grid to page through (Transport doesn't).

## Next/previous: a signed delta, not two methods

```ts
pageBy(delta: GridOffset): void;
```

"Next"/"previous" are `pageBy({ row: 0, column: 1 })` and `pageBy({ row:
0, column: -1 })` — the same operation at a positive or negative step,
not two separate methods that would each have to be re-added for every
new axis a future grid scrolls on (row-paging a step sequencer vs.
column-paging a bank of tracks). Keeping one method also means a caller
never has to ask "does `nextPage()` move rows or columns for this
particular mode" — it says so explicitly every time.

## How application context influences a mode, without owning it

Application-originated context can influence a mode by being read, never
by writing. `setMode()` is called by the surface's own navigation logic,
which is free to
read `SurfaceContext`'s current selection first and choose a mode
accordingly (e.g. a track being selected arming Parameter Control for
that track's FX). That policy lives entirely in whatever calls
`setMode()`, not in either contract: `SurfaceContext` stays unaware mode
exists, and `SurfaceNavigation` stays unaware `Selection` exists. Neither
type references the other.

## What's deliberately not here

- **No mode-switching implementation** — no code that actually unbinds
  and rebinds a `ControlMapping` set when `setMode()`/`pageBy()` is
  called, and no policy deciding which mode a given selection should
  arm.
- **No grid-offset bounds/clamping** — `GridOffset` isn't validated
  against a virtual space size, because this contract doesn't know one;
  a binding layer that knows its data's size is responsible for clamping.
- **No per-mode `ControlMapping` set shape** — this contract does not
  define which controls a mode binds or how.
- **No multi-surface or multi-device navigation coordination** — one
  `SurfaceNavigation` is scoped to one `ControlSurface`; nothing here
  defines coordination between multiple surfaces.
