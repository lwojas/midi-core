# Control Surface — Lifecycle and Runtime

Status: Draft
Source of truth: [`src/surface/`](../../src/surface)

## Scope

The Control Surface lifecycle defines attach/detach, availability,
initialisation, cleanup, connection changes, and error responsibility
for a runtime consuming a `DeviceProfile` and the Application Contract.
This document specifies the contract; runtime behavior is described in
`surface-lifecycle-runtime.md`.

## One aggregate state, not a per-port state repeated by hand

`SurfaceLifecycleState` (`src/surface/types/lifecycle.ts`) is `"detached" |
"attaching" | "attached" | "detaching" | "error"` — attach/detach, not
connect/disconnect, to keep this vocabulary distinct from the per-port
`ConnectionState` (`docs/contracts/discovery-lifecycle.md`) it's built on.
Nothing here is a port, and a surface can be `attaching` while every
composed port is already `connected` — device setup can still be
in flight.

```
detached -> attaching -> attached -> detaching -> detached
attaching -> detaching                (give up before fully attached)
attaching | attached | detaching -> error
error -> detached                      (after detach()'s cleanup runs)
```

`isValidSurfaceTransition()` mirrors Core's own `isValidTransition()` —
same shape, same "a state never transitions to itself" rule — so a future
implementation and its tests share one definition of "valid" instead of
each re-deriving it, exactly as Core's contract already reasons for its
own transition table.

## Availability without a fourth state

Availability does **not** add a
state: whether a surface's required ports are ready for `attach()` is
answered by inspecting those ports' own Core `ConnectionState` directly —
`isSurfaceAttachable(requiredPortStates)` is `true` when every one of them
is already `"available"` or `"connected"`. Introducing a parallel
surface-level "available" would duplicate a fact Core's own lifecycle
contract already states. A caller checks attachability by reading the
same `ConnectionState`s it already has from composing `MidiConnection`s;
this contract adds no new source of truth for it.

## `attach()` / `detach()`: initialisation and cleanup

`ControlSurface` (`src/surface/types/runtime.ts`) is deliberately as small
as `MidiConnection`:

```ts
interface ControlSurface {
  readonly profile: DeviceProfile;
  readonly state: SurfaceLifecycleState;
  attach(): Promise<void>;
  detach(): Promise<void>;
  onStateChange(
    listener: (change: SurfaceLifecycleChange) => void,
  ): Unsubscribe;
  onError(listener: (error: SurfaceError) => void): Unsubscribe;
}
```

`attach()`/`detach()` take no arguments: which ports a profile resolves to
is already decided by whoever constructs a `ControlSurface`. This
contract assumes that resolution already happened; it does not perform
it.

`attach()` is initialisation: connect every port `profile.ports` marks
`required`, then run `profile.setup`'s steps on those ports — see "Device setup" below. `detach()` is cleanup: the reverse, after
giving a caller the chance to unbind whatever it bound (next section).

## No binding here — only the moment it hooks in

`docs/control-surface-architecture.md` already describes mode switching as
_unbinding_ the outgoing mode's `ControlMapping`s and _binding_ the
incoming mode's around a lifecycle event, not as logic living inside
`bindControlMapping()` itself. This contract extends that reasoning one
level up: `attach()`/`detach()` do not call `bindControlMapping()` or know
what a `ControlMapping` is. They only name the moment a caller should:

- `onStateChange` reporting entry into `"attached"` is when bindings
  should be installed (every required port is connected and setup is complete).
- `onStateChange` reporting entry into `"detaching"` is when bindings
  should be torn down, before ports disconnect underneath them.

What a binding set _is_ — a declarative config or a resolved role table —
is outside this lifecycle contract. It names when bindings hook in, not
what they contain.

## Connection changes while attached

A composed port leaving `"connected"` on its own — hardware unplugged,
not a requested `detach()` — moves the surface straight to `"error"`, not
`"detaching"`. This is a spontaneously discovered failure, the same
distinction Core's own `ConnectionState` already draws between `error`
and the graceful `disconnecting` path. A caller still calls `detach()`
afterward to run cleanup (unbind, release remaining ports) from `error`'s
one valid transition — but the surface does not pretend an unrequested
disconnect was a graceful one.

## Device setup

Connection-time setup is declared by the profile and run by `attach()`; see
[device-setup.md](./device-setup.md). `attach()` runs the declared steps on the
required ports after connecting them, and before the initial mode is installed.
The profile carries the message bytes, so no device-specific executor is needed.

A setup failure fails the attach with `"setup-failed"` or `"setup-timeout"`
(`cause` set where there is one), and the surface moves to `"error"`. Setup
always runs when declared. There is no `required` gate, so a profile cannot skip
the setup its addressing depends on. Setup is the only place vendor SysEx bytes
are sent, and only the bytes the profile declares.

## Error responsibility

`SurfaceError` (`src/surface/types/errors.ts`) is reported in the
surface's own terms — `"port-unavailable"`, `"setup-failed"`, `"setup-timeout"`, `"unknown"` — rather than widening
`MidiTransportError` to cover them, the same boundary
`docs/contracts/discovery-lifecycle.md` already draws ("device- or
application-level failures are out of scope for Core... reported by
higher layers in their own terms"). A transport failure that caused a
surface failure (a required port's `connect()` rejecting) is carried as
`SurfaceError.cause`, not re-encoded into a new transport error vocabulary
— Core's errors stay Core's errors.

## What's deliberately not here

- **No profile-to-port matching** — someone else's job, by
  name/manufacturer heuristic or
  explicit configuration, before a `ControlSurface` is constructed.
- **No binding/mapping logic** — no `ControlMapping` generation, no mode
  switching. This contract names when bindings hook in; mode and binding
  contracts define the rest.
- **No general SysEx template language** — setup steps carry their own
  declared bytes (`device-setup.md`).
- **No retry/reconnection policy** — `attach()`/`detach()` are one
  attempt each; a caller wanting retries composes that itself, the same
  stance `docs/contracts/discovery-lifecycle.md` already takes for Core's
  own `connect()`/`disconnect()`.
