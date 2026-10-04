# Control Surface — Lifecycle Runtime

Status: Draft
Linear: [ECS-76](https://linear.app/ecs3d/issue/ECS-76/implement-surface-lifecycleerror-handling)
Project: [MIDI Core and Control Architecture](https://linear.app/ecs3d/project/midi-core-and-control-architecture-f934a737de3b)
Depends on: [docs/contracts/surface-lifecycle.md](./surface-lifecycle.md) (ECS-66),
[docs/contracts/surface-runtime.md](./surface-runtime.md) (ECS-69),
[docs/contracts/mode-switching.md](./mode-switching.md) (ECS-75)
Source of truth: [`src/surface/runtime.ts`](../../src/surface/runtime.ts)

## Scope

`docs/contracts/surface-lifecycle.md` (ECS-66) fully specified
`ControlSurface`'s `attach()`/`detach()` contract and said so
explicitly: "no `ControlSurface` backed by live `MidiConnection`s. That's
ECS-76." With the runtime foundation (ECS-69), generation (ECS-72), and
mode switching (ECS-75) all real, this ticket is that implementation —
`createControlSurface()` — plus the one piece of reactive wiring ECS-75's
own doc named and deferred here: "nothing yet owns the event loop a
silent background rebind would run on — that's `ControlSurface.attach()`."
It does now.

Nothing here invents new lifecycle rules; every behavior below
implements something `surface-lifecycle.md` already specified. Where
this ticket had to make a call the contract left open, it's called out
explicitly.

## `attach()`

Connects every `profile.ports` marked `required` (resolved from the
caller-supplied `ports: SurfacePorts`, per the contract's own "port
resolution already happened" stance), runs `profile.handshake`'s steps
through the supplied `executor` if required, then installs the mode
matching `navigation.state.mode` via `bindActiveMode()` (ECS-69) and
starts following `navigation.onChange()` (see "Mode switching," below).
Fails loud at the first problem, exactly as specified:

| Failure | `SurfaceError.code` |
|---|---|
| A required port has nothing resolved for it in `ports` | `"port-unavailable"` |
| A required port's `connect()` rejects | `"port-unavailable"` (`cause` set) |
| `handshake.required` but no `executor` supplied | `"handshake-unsupported"` |
| A handshake step's `performStep()` rejects | `"handshake-failed"` (`cause` set) |

Every failure reports the `SurfaceError` to `onError` listeners, moves
`state` to `"error"`, and **rejects `attach()`'s own promise with that
same `SurfaceError` object** — "attach() fails with a SurfaceError"
read literally: the error is both the observable event and the
rejection reason, not two differently-shaped things.

**Partial connection on failure is left for `detach()` to clean up**,
not unwound by `attach()` itself. If port 2 of 3 fails to connect, port
1 stays connected and watched; calling `detach()` afterward (the
documented recovery path from `"error"`, below) disconnects it. This
avoids `attach()` needing its own separate unwind logic distinct from
`detach()`'s already-correct one.

## `detach()`

Idempotent when already `"detached"` or `"detaching"` (returns
immediately — the same "repeated identical states are a no-op" stance
`isValidTransition()`/`isValidSurfaceTransition()` already take).
Otherwise: stops following `navigation.onChange()`, tears down the
active mode's bindings (`SurfaceModeTeardown`, including
`hooks.onExit`), disconnects every port it connected, and transitions to
`"detached"`.

**From `"error"`, this goes directly to `"detached"` — never through
`"detaching"`.** `isValidSurfaceTransition()`'s table only allows
`error -> detached`; there is no `error -> detaching` to pass through.
Cleanup itself (unbind, disconnect) is identical either way — this
ticket's one interpretation of a contract line that didn't fully spell
it out: `docs/contracts/surface-lifecycle.md` names "entering
`detaching`" as *the graceful path's* cue to unbind, but the error-
recovery path has no such state to enter at all. `detach()` performs the
same unbind/disconnect steps as plain sequential code either way,
rather than gating them behind a state announcement that doesn't exist
on this path.

A disconnect failure during cleanup reports `SurfaceError` (`code:
"unknown"` — none of the four named codes fit "a port failed to
disconnect," and `"unknown"` is the contract's own escape hatch for
exactly this) and, on the graceful path, moves to `"error"` (a valid
`detaching -> error` transition); on the error-recovery path, there is
nowhere valid left to go, so `state` simply stays `"error"` and the
failure surfaces only through the rejection and `onError`.

## Spontaneous disconnect

While attached, each connected required port is watched for leaving
`"connected"` on its own. A transition caused by `detach()` itself is
distinguished by a flag set before `detach()` touches any port — not by
guessing from the transition shape — so an intentional, graceful
disconnect is never misreported as spontaneous. An unrequested one
reports `SurfaceError` (`"port-unavailable"`) and moves straight to
`"error"`, exactly the distinction `surface-lifecycle.md` draws between
`error` and the graceful `disconnecting` path.

**Scoped to exactly this one case.** A port's `onError` (e.g. a
mid-operation `send-failed`) during normal `"attached"` operation is not
separately forwarded into a surface state change — nothing in
`surface-lifecycle.md` names that as a surface-level failure, and
`SurfaceErrorCode`'s four values don't include one for it either.
Inventing a forwarding path for every possible transport error would be
exactly the speculative error handling "minimal error handling" warns
against; left as a gap for a future ticket if a concrete case ever needs
it.

## Mode switching: the event-loop owner ECS-75 was waiting for

`docs/contracts/mode-switching.md` (ECS-75) built `switchMode()` as an
explicit, caller-driven step rather than a self-subscribing reactive
wrapper, reasoning that "nothing yet owns the event loop... that's
`ControlSurface.attach()`." `attach()` now is that owner: after the
initial mode is bound, it subscribes to `navigation.onChange()` and, for
every change where `from.mode !== to.mode`, calls `switchMode()`.

**Serialized through one queue, not run concurrently.** `setMode()`
can be called again before a prior switch's `await` chain (hooks,
`generate()`, `bindControlMapping()` calls) finishes. Each switch is
chained onto a single `Promise` so a second `setMode()` call's rebind
only starts once the first one's unbind/bind has fully settled — control
never overlaps, and a mode is never torn down by one switch while
another is still installing it. `detach()` awaits this same queue before
tearing down the active mode, so a detach can't race an in-flight
switch either.

## What's deliberately not here

- **No retry/reconnection policy** — `attach()`/`detach()` are one
  attempt each, unchanged from `docs/contracts/discovery-lifecycle.md`'s
  own stance for Core's `connect()`/`disconnect()`; a caller wanting
  retries composes that itself.
- **No profile-to-port matching** — `ports: SurfacePorts` is supplied
  already resolved, the unchanged non-gap named since the ECS-63 audit.
- **No forwarding of ordinary port `onError` events into surface state**
  — see "Spontaneous disconnect" above.
- **No navigation-driven mode-selection policy** — `attach()` follows
  whatever `navigation.setMode()` is called with; nothing here decides
  *which* mode a selection should arm (`docs/contracts/surface-
  navigation.md` already left that open).
