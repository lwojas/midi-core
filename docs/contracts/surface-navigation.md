# Control Surface — Modes and Navigation

Status: Draft
Linear: [ECS-67](https://linear.app/ecs3d/issue/ECS-67/define-modescontext-model)
Project: [MIDI Core and Control Architecture](https://linear.app/ecs3d/project/midi-core-and-control-architecture-f934a737de3b)
Depends on: [docs/control-surface-architecture.md](../control-surface-architecture.md) (ECS-64),
[docs/contracts/control-api.md](./control-api.md) (`Selection`/`SurfaceContext`, ECS-65),
[docs/contracts/surface-lifecycle.md](./surface-lifecycle.md) (ECS-66)
Source of truth: [`src/surface/types/navigation.ts`](../../src/surface/types/navigation.ts)

## Scope

`docs/control-surface-architecture.md` (ECS-64) already decided mode
switching is a batch unbind/rebind of `ControlMapping`s around a lifecycle
event, and that "navigation/mapping behaviour belongs in the surface, not
device profiles." It deliberately left open *how* a surface represents
which mode is active, who owns bank/page/grid-offset, and how application
context relates to any of it — this ticket is that decision. Like
ECS-65/66 before it, this produces **only the contract**
(`src/surface/types/navigation.ts`) — no mode-switching implementation,
no real unbind/rebind. That's ECS-75.

## Two kinds of state, two owners, never confused

The ticket asks explicitly to distinguish "application selection" from
"surface-local navigation." These were already on a collision course to
get conflated — both are "what's currently relevant" — so this contract
draws the line as two separate interfaces with opposite ownership,
instead of one state bag either side could write to:

| | Owner | Contract | Examples |
|---|---|---|---|
| **Application selection** | Application | `Selection` / `SurfaceContext` (`docs/contracts/control-api.md`, ECS-65) | selected track, selected pattern, selected parameter |
| **Surface-local navigation** | Surface | `SurfaceNavigationState` / `SurfaceNavigation` (this ticket) | active mode, bank/page, grid offset |

`SurfaceContext` already has no `setSelection()` — the application is its
only writer. `SurfaceNavigation` is the mirror image: a surface's
`setMode()`/`pageBy()` are called by the surface itself (typically from a
hardware mode or next/previous control), and nothing in the application
contract can reach them. Neither interface gained a method that would
let the other side write into it — that would silently undo the split the
ticket asked for.

## Why not a single string

The ticket asks for "a scalable context representation rather than
assuming a single string." Application selection already answered this
in ECS-65: `SurfaceContext` is keyed by `scope` (`listSelections()`/
`getSelection(scope)`) precisely so selected track, selected pattern and
selected parameter can all exist and change independently, instead of one
opaque context string a surface would have to parse. This ticket's
`SurfaceNavigationState` follows the same reasoning on the surface-owned
side: `mode` and `gridOffset` are separate fields, not one encoded string
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
(`TrackControls`, `TransportControls`). The ticket's four examples —
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

The ticket names "bank/page" and "grid offset" as if they might be
different mechanisms. They aren't, here: both describe the same thing —
the top-left corner of whatever window is currently bound onto a physical
control grid — so one `GridOffset` shape covers all of it rather than
three parallel fields that would always change together. This is
deliberately **unrelated** to a profile's `ControlGrid.rows`/`columns`
(`docs/contracts/device-profile.md`), which describes the physical grid's
own fixed size. `GridOffset` indexes into a larger *virtual* space an
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

The ticket asks how application-originated context "selects or
influences" a mode. The answer this contract gives: **it influences, by
being read, never by writing.** `setMode()` is still only ever called by
the surface's own navigation logic (ECS-75) — but that logic is free to
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
  arm. That's ECS-75, "using agreed surface-local navigation ownership"
  as its own description already says, built on the shape defined here.
- **No grid-offset bounds/clamping** — `GridOffset` isn't validated
  against a virtual space size, because this contract doesn't know one;
  nothing here has hit a concrete case needing it yet. A future binding
  layer (ECS-68/72) that does know its data's size is where clamping
  would belong, not here.
- **No per-mode `ControlMapping` set shape** — what controls a mode binds
  and how is ECS-68's declarative-mapping-vs-hooks decision, not this
  one's.
- **No multi-surface or multi-device navigation coordination** — one
  `SurfaceNavigation` is scoped to one `ControlSurface`; nothing here
  assumes or prevents several surfaces sharing navigation state, since no
  concrete case has needed it.
