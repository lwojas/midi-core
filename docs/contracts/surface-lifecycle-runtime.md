# Control Surface — Lifecycle Runtime

Status: Draft
Source of truth: [`src/surface/runtime.ts`](../../src/surface/runtime.ts)

## Scope

`createControlSurface()` implements attach and detach for a profile
backed by live MIDI connections, including setup, mode binding, and
error reporting. The behavior follows `surface-lifecycle.md`.

## `attach()`

Connects every `profile.ports` marked `required` (resolved from the
caller-supplied `ports: SurfacePorts`, per the contract's own "port
resolution already happened" stance), runs `profile.setup`'s steps on those ports, then installs the mode
matching `navigation.state.mode` via `bindActiveMode()` and
starts following `navigation.onChange()` (see "Mode switching," below).
Fails loud at the first problem, exactly as specified:

| Failure                                                         | `SurfaceError.code`                               |
| --------------------------------------------------------------- | ------------------------------------------------- |
| A required port has nothing resolved for it in `ports`          | `"port-unavailable"`                              |
| A required port's `connect()` rejects                           | `"port-unavailable"` (`cause` set)                |
| A setup `send` cannot be made, or a setup step is malformed     | `"setup-failed"` (`cause` set where there is one) |
| A setup `expect` step gets no matching reply within `timeoutMs` | `"setup-timeout"`                                 |

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
`detaching`" as _the graceful path's_ cue to unbind, but the error-
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

## Mode switching

After the initial mode is bound, `attach()` subscribes to
`navigation.onChange()` and calls `switchMode()` for every change where
`from.mode !== to.mode`.

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
  attempt each; a caller wanting retries composes that itself.
- **No profile-to-port matching** — `ports: SurfacePorts` is supplied
  already resolved.
- **No forwarding of ordinary port `onError` events into surface state**
  — see "Spontaneous disconnect" above.
- **No navigation-driven mode-selection policy** — `attach()` follows
  whatever `navigation.setMode()` is called with; nothing here decides
  _which_ mode a selection should arm (`docs/contracts/surface-
navigation.md` already left that open).
