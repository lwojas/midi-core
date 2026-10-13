# Control Surface — Mode Switching

Status: Draft
Source of truth: [`src/surface/mode-switching.ts`](../../src/surface/mode-switching.ts)

## Scope

Mode switching tears down the outgoing mode's bindings before installing
the bindings for the active navigation mode. `switchMode()` exposes this
as one explicit, awaitable operation.

## `switchMode()`: unbind, then bind — nothing else

```ts
async function switchMode(
  table: SurfaceBindingTable,
  navigation: SurfaceNavigation,
  previousTeardown: SurfaceModeTeardown,
  deps: BindSurfaceModeDeps,
): Promise<SurfaceModeTeardown>;
```

Awaits `previousTeardown()` (the outgoing mode's `hooks.onExit` plus
every `bindControlMapping()` unsubscribe) before calling
`bindActiveMode(table, navigation, deps)` for whatever
`navigation.state.mode` now is. Unbind always completes before bind
starts, so a physical control assigned by both modes is never briefly
bound to both.

## Deliberately explicit, not a hidden subscription

`switchMode()` is called by whatever decides a mode should change; it
does not subscribe to `navigation.onChange()` itself:

- **The lifecycle owner controls the event loop.** A
  `ControlSurface.attach()` runtime may subscribe and invoke switching
  while attached; the switch operation itself remains explicitly callable.
- **Only the caller already has both halves of the comparison that
  matters.** A `SurfaceNavigationChange` carries `from`/`to`; deciding
  _whether_ to call `switchMode()` at all (a real mode change) versus
  doing nothing (a `pageBy()` that only moved `gridOffset`) needs that
  comparison, and the caller already has it from the same
  `onChange`/`setMode()` call that triggered this in the first place.
  `switchMode()` itself has no way to ask "what mode was
  `previousTeardown` even for," so it doesn't try to re-derive something
  the caller already knows.

This keeps switching composable with the explicit binding operations
used to install a mode.

## Demonstration: Mixer, Transport, Step Grid, one profile

`src/surface/mode-switching.test.ts` builds one `SurfaceBindingTable`
against `MOCK_SURFACE_DEVICE_PROFILE` with three modes —
`knob-1` → a volume `Control` (Mixer), `button-1` → a boolean `Control`
(Transport), `pad-1` → a step `Control` (Step Grid) — and cycles through
all three via `switchMode()`, confirming at every step that:

- Only the active mode's physical control actually drives anything;
  the other two modes' controls are inert until their mode is active.
  No MIDI protocol changed, no new message types, no device knowledge
  added anywhere — only which `ControlId` the same knob/button/pad
  currently resolves to.
- `hooks.onEnter`/`onExit` fire exactly once per switch, not per
  `pageBy()` or anything else.
- A `pageBy()` call (`navigation.state.mode` unchanged) needs no
  `switchMode()` call at all — nothing about which `ControlMapping` set
  is active changed, so nothing is torn down or rebuilt.
- Cycling back to a mode already visited (Mixer → Step Grid → Transport
  → Mixer) works the same as the first entry — this isn't a one-shot
  transition.

Transport's binding here is a boolean `Control` (`transport.recording`).
`ModeBinding` covers `ControlBinding` and `NavigationBinding`; action
triggers remain the standalone `bindActionTrigger()` primitive outside
the declarative mode table.

## Required ports

A mode may name the ports it needs (`requiredPortIds`). A switch to that mode is refused while any of them isn't
connected: the navigation keeps its state, nothing is unbound or bound, and a `port-unavailable` error is reported.
The check is at the moment of the switch, against the ports the surface actually connected at attach. A port the
application supplied but the device refused to connect therefore keeps its mode out of reach. Modes with no
`requiredPortIds` switch as before.

## What's deliberately not here

- **No internal reactive subscription to `navigation.onChange()`** — a
  lifecycle owner invokes switching when a mode change occurs.
- **No mode-selection policy** — nothing here reads `SurfaceContext` to
  decide _which_ mode a selection should arm (e.g. "a track being
  selected arms Parameter Control"). `docs/contracts/surface-
navigation.md` already named this as a later policy question;
  `switchMode()` only performs a switch once something else has decided
  one should happen.
- **No paging/scrolling behavior** — `pageBy()` changes navigation
  offset without changing the active mode, so it needs no rebind.
- **No concurrent/overlapping-switch handling beyond "await, then
  act"** — `switchMode()` is one `async` function a caller `await`s
  before calling it again; a caller invoking it twice without awaiting
  the first composes its own ordering (the same "caller composes
  retries/concurrency" stance `docs/contracts/discovery-lifecycle.md`
  already takes for `connect()`/`disconnect()`), not something this
  function queues or serializes on a caller's behalf.
