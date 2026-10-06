# Control Surface — Mode Switching

Status: Draft
Linear: [ECS-75](https://linear.app/ecs3d/issue/ECS-75/implement-basic-mode-switching)
Project: [MIDI Core and Control Architecture](https://linear.app/ecs3d/project/midi-core-and-control-architecture-f934a737de3b)
Depends on: [docs/control-surface-architecture.md](../control-surface-architecture.md) (ECS-64),
[docs/contracts/surface-navigation.md](./surface-navigation.md) (ECS-67),
[docs/contracts/surface-runtime.md](./surface-runtime.md) (ECS-69),
[docs/contracts/surface-generation.md](./surface-generation.md) (ECS-72)
Source of truth: [`src/surface/mode-switching.ts`](../../src/surface/mode-switching.ts)

## Scope

Both `docs/control-surface-architecture.md` (ECS-64) and
`docs/contracts/surface-navigation.md` (ECS-67) specified mode switching
as "unbinding the outgoing mode's mappings and binding the incoming
mode's," then explicitly deferred actually doing it: "no code that
actually unbinds and rebinds a `ControlMapping` set when `setMode()` is
called... that's ECS-75." With `bindSurfaceMode()`/`bindActiveMode()`
(ECS-69) and `generateControlMappings()` (ECS-72) now real, this ticket
implements that sequence as one explicit, awaitable step, and
demonstrates it against the generic mock surface device (ECS-71) with
three real modes sharing one profile — "the same profile-defined
controls can serve Mixer, Transport and Step Grid mappings," per the
ticket.

## `switchMode()`: unbind, then bind — nothing else

```ts
async function switchMode(
  table: SurfaceBindingTable,
  navigation: SurfaceNavigation,
  previousTeardown: SurfaceModeTeardown,
  deps: BindSurfaceModeDeps,
): Promise<SurfaceModeTeardown>
```

Awaits `previousTeardown()` (the outgoing mode's `hooks.onExit` plus
every `bindControlMapping()` unsubscribe) before calling
`bindActiveMode(table, navigation, deps)` for whatever
`navigation.state.mode` now is. Unbind always completes before bind
starts — a physical control two modes both assign, to different roles,
is never briefly bound to both at once. Built entirely from pieces
ECS-69 already has; this adds no new binding mechanism, only the
sequencing contract already named one layer up.

## Deliberately explicit, not a hidden subscription

`switchMode()` is called by whatever decides a mode should change; it
does not subscribe to `navigation.onChange()` itself. Two reasons, both
load-bearing:

- **Nothing yet owns the event loop a silent background subscription
  would run on.** That's `ControlSurface.attach()` — ECS-76, not built
  yet. Building a self-subscribing reactive wrapper now would be
  speculating about an event-loop ownership model this project hasn't
  decided, exactly what the ticket's "do not implement speculative
  universal navigation" warns against.
- **Only the caller already has both halves of the comparison that
  matters.** A `SurfaceNavigationChange` carries `from`/`to`; deciding
  *whether* to call `switchMode()` at all (a real mode change) versus
  doing nothing (a `pageBy()` that only moved `gridOffset`) needs that
  comparison, and the caller already has it from the same
  `onChange`/`setMode()` call that triggered this in the first place.
  `switchMode()` itself has no way to ask "what mode was
  `previousTeardown` even for," so it doesn't try to re-derive something
  the caller already knows.

The same explicit-calling pattern `bindSurfaceMode()`/`bindActiveMode()`
already use (nothing in ECS-69 self-triggers either) — consistent with
this project's standing preference for pieces a caller composes over
pieces that compose themselves.

## Demonstration: Mixer, Transport, Step Grid, one profile

`src/surface/mode-switching.test.ts` builds one `SurfaceBindingTable`
against `MOCK_SURFACE_DEVICE_PROFILE` (ECS-71) with three modes —
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

Transport's binding here is a boolean `Control`
(`transport.recording`), not the `play`/`stop`/`record` `Action`s
ECS-74 demonstrated — deliberately: `ModeBinding` only covers
`ControlBinding`/`NavigationBinding` (`docs/contracts/surface-
bindings.md`), and ECS-74 already decided action-triggering stays a
standalone primitive (`bindActionTrigger()`) outside the declarative
mode table. This ticket demonstrates mode switching for
`ControlMapping`-based bindings; wiring `bindActionTrigger()` per-mode
too would be a new decision for whichever ticket needs it, not this
one's.

## Required ports (ECS-104)

A mode may name the ports it needs (`requiredPortIds`). A switch to that mode is refused while any of them isn't
connected: the navigation keeps its state, nothing is unbound or bound, and a `port-unavailable` error is reported.
The check is at the moment of the switch, against the ports the surface actually connected at attach. A port the
application supplied but the device refused to connect therefore keeps its mode out of reach. Modes with no
`requiredPortIds` switch as before.

## What's deliberately not here

- **No reactive subscription to `navigation.onChange()`** — see above;
  deferred to `ControlSurface.attach()` (ECS-76), which will have an
  actual lifecycle to hang it on.
- **No mode-selection policy** — nothing here reads `SurfaceContext` to
  decide *which* mode a selection should arm (e.g. "a track being
  selected arms Parameter Control"). `docs/contracts/surface-
  navigation.md` already named this as a later policy question;
  `switchMode()` only performs a switch once something else has decided
  one should happen.
- **No paging/scrolling beyond what `SurfaceNavigation` (ECS-67)
  already provides** — `pageBy()` already exists and already needs no
  rebind, per the demonstration above; nothing new was added for it.
- **No concurrent/overlapping-switch handling beyond "await, then
  act"** — `switchMode()` is one `async` function a caller `await`s
  before calling it again; a caller invoking it twice without awaiting
  the first composes its own ordering (the same "caller composes
  retries/concurrency" stance `docs/contracts/discovery-lifecycle.md`
  already takes for `connect()`/`disconnect()`), not something this
  function queues or serializes on a caller's behalf.
