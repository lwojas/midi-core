# Control Surface — Lifecycle and Runtime

Status: Draft
Linear: [ECS-66](https://linear.app/ecs3d/issue/ECS-66/define-surface-lifecycle-and-runtime-model)
Project: [MIDI Core and Control Architecture](https://linear.app/ecs3d/project/midi-core-and-control-architecture-f934a737de3b)
Depends on: [docs/control-surface-architecture.md](../control-surface-architecture.md) (ECS-64),
[docs/contracts/discovery-lifecycle.md](./discovery-lifecycle.md) (ECS-27),
[docs/contracts/device-profile.md](./device-profile.md) (ECS-39)
Related: [docs/contracts/control-api.md](./control-api.md) (ECS-34/35/65)
Source of truth: [`src/surface/`](../../src/surface)

## Scope

`docs/control-surface-architecture.md` (ECS-64) named Control Surface as
the layer between Device Profile and the Application Contract, and the
audit it's built on (ECS-63, Gap 4) found no lifecycle model above Core's
own per-port `ConnectionState` — webseq's `useMidiControls.ts` hand-rolls
exactly this for one hardcoded device, torn down as a bundle, with nothing
reusable. This ticket is that model: attach/detach, availability,
initialisation, cleanup, connection changes, and error responsibility for
a minimal surface runtime consuming a `DeviceProfile` and the Application
Contract.

Like `docs/contracts/mapping.md` before its own runtime ticket (ECS-37),
this produces **only the contract** — types and pure functions
(`src/surface/types/`), no code that resolves a profile against real
discovered ports, runs a real handshake, or binds a real `ControlMapping`.
That implementation is ECS-76 ("implement surface lifecycle/error
handling"), built against the shape defined here.

## One aggregate state, not a per-port state repeated by hand

`SurfaceLifecycleState` (`src/surface/types/lifecycle.ts`) is `"detached" |
"attaching" | "attached" | "detaching" | "error"` — attach/detach, not
connect/disconnect, to keep this vocabulary distinct from the per-port
`ConnectionState` (`docs/contracts/discovery-lifecycle.md`) it's built on.
Nothing here is a port, and a surface can be `attaching` while every
composed port is already `connected` — a required handshake can still be
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

The ticket asks for "availability" explicitly. This does **not** add a
state: whether a surface's required ports are ready for `attach()` is
answered by inspecting those ports' own Core `ConnectionState` directly —
`isSurfaceAttachable(requiredPortStates)` is `true` when every one of them
is already `"available"` or `"connected"`. Introducing a parallel
surface-level "available" would duplicate a fact Core's own lifecycle
contract already states, which the ticket explicitly warns against
("avoid duplicating MIDI Core functionality"). A caller checks
attachability by reading the same `ConnectionState`s it already has from
composing `MidiConnection`s — this contract adds no new source of truth
for it.

## `attach()` / `detach()`: initialisation and cleanup

`ControlSurface` (`src/surface/types/runtime.ts`) is deliberately as small
as `MidiConnection`:

```ts
interface ControlSurface {
  readonly profile: DeviceProfile;
  readonly state: SurfaceLifecycleState;
  attach(): Promise<void>;
  detach(): Promise<void>;
  onStateChange(listener: (change: SurfaceLifecycleChange) => void): Unsubscribe;
  onError(listener: (error: SurfaceError) => void): Unsubscribe;
}
```

`attach()`/`detach()` take no arguments: which ports a profile resolves to
is already decided by whoever constructs a `ControlSurface`, the same
"not this schema's job" stance `docs/contracts/device-profile.md` already
takes on profile-to-port matching (named explicitly as a deferred, no
concrete-need-yet non-gap in the ECS-63 audit). This contract assumes that
resolution already happened; it does not perform it.

`attach()` is initialisation: connect every port `profile.ports` marks
`required`, then run `profile.handshake`'s steps (if `required`) — see
"The handshake boundary" below. `detach()` is cleanup: the reverse, after
giving a caller the chance to unbind whatever it bound (next section).

## No binding here — only the moment it hooks in

`docs/control-surface-architecture.md` already describes mode switching as
*unbinding* the outgoing mode's `ControlMapping`s and *binding* the
incoming mode's around a lifecycle event, not as logic living inside
`bindControlMapping()` itself. This contract extends that reasoning one
level up: `attach()`/`detach()` do not call `bindControlMapping()` or know
what a `ControlMapping` is. They only name the moment a caller should:

- `onStateChange` reporting entry into `"attached"` is when bindings
  should be installed (every required port is connected and any required
  handshake is complete).
- `onStateChange` reporting entry into `"detaching"` is when bindings
  should be torn down, before ports disconnect underneath them.

What a binding set *is* — a declarative config, a resolved role table from
ECS-68's still-open decision — is unchanged and untouched by this ticket.
This is deliberately the same restraint `docs/control-surface-architecture.md`
itself applied to the generation step's "binding table": naming where it
hooks in, not what it contains.

## Connection changes while attached

A composed port leaving `"connected"` on its own — hardware unplugged,
not a requested `detach()` — moves the surface straight to `"error"`, not
`"detaching"`. This is a spontaneously discovered failure, the same
distinction Core's own `ConnectionState` already draws between `error`
and the graceful `disconnecting` path. A caller still calls `detach()`
afterward to run cleanup (unbind, release remaining ports) from `error`'s
one valid transition — but the surface does not pretend an unrequested
disconnect was a graceful one.

## The handshake boundary

`docs/contracts/device-profile.md`'s `DeviceHandshake`/`HandshakeStep`
describe *that* a device needs a connection-time exchange and each step's
intent (`send`/`expect` plus a description) — deliberately no message
bytes, since modeling those is real protocol work ECS-40's composition
model hasn't built yet. That leaves a genuine question this ticket has to
answer: who performs a handshake, and what happens when nothing can?

**Surface-owned, not profile-owned, and not synthesized.** Performing a
handshake is `attach()`'s job — the first layer above Core allowed to
know about both a profile and live ports. But since a `HandshakeStep`
carries no executable payload, a generic `ControlSurface` cannot derive
*how* to perform one from the profile alone; that requires device-specific
knowledge the schema deliberately excluded. `HandshakeExecutor`
(`performStep(step): Promise<void>`) names that knowledge as something
supplied by whoever constructs a `ControlSurface` for a specific device —
device-specific, outside this contract — rather than something `attach()`
invents.

**Failing loud, not silently, when there's nothing to perform it.** If
`profile.handshake?.required` is `true` and no `HandshakeExecutor` was
supplied, `attach()` fails with a `SurfaceError` (`"handshake-unsupported"`)
instead of silently proceeding as if the device were ready. This is the
same "report, never invented or guessed" stance
`docs/contracts/profile-validation.md` already takes for a profile
authored with a handshake marked required and nothing in it to perform —
applied here to the runtime that would otherwise skip it quietly.

`SysEx` (`DeviceSysExProfile`) draws the identical line for the same
reason: described, not executed, and genuinely not executable from
today's schema. No separate "SysEx executor" is added — a vendor SysEx
need that matters at connection time is exactly what `handshake` already
exists to describe; one that doesn't (an optional extra, per `required:
false`) has no lifecycle role at all, attach-time or otherwise.

## Error responsibility

`SurfaceError` (`src/surface/types/errors.ts`) is reported in the
surface's own terms — `"port-unavailable"`, `"handshake-unsupported"`,
`"handshake-failed"`, `"unknown"` — rather than widening
`MidiTransportError` to cover them, the same boundary
`docs/contracts/discovery-lifecycle.md` already draws ("device- or
application-level failures are out of scope for Core... reported by
higher layers in their own terms"). A transport failure that caused a
surface failure (a required port's `connect()` rejecting) is carried as
`SurfaceError.cause`, not re-encoded into a new transport error vocabulary
— Core's errors stay Core's errors.

## What's deliberately not here

- **No implementation** — no code resolving `profile.ports` against real
  discovered ports, no real `HandshakeExecutor`, no `ControlSurface`
  backed by live `MidiConnection`s. That's ECS-76.
- **No profile-to-port matching** — unchanged non-gap from the ECS-63
  audit; still someone else's job, by name/manufacturer heuristic or
  explicit configuration, before a `ControlSurface` is constructed.
- **No binding/mapping logic** — no `ControlMapping` generation, no mode
  switching. This ticket names the lifecycle moment bindings hook into
  (`onStateChange` into `"attached"`/`"detaching"`); ECS-67 (modes) and
  ECS-68 (binding language) decide the rest.
- **No SysEx or handshake byte templates** — unchanged from
  `docs/contracts/device-profile.md`; still ECS-40's scope, if ever
  needed.
- **No retry/reconnection policy** — `attach()`/`detach()` are one
  attempt each; a caller wanting retries composes that itself, the same
  stance `docs/contracts/discovery-lifecycle.md` already takes for Core's
  own `connect()`/`disconnect()`.
