# Control Surface — Runtime Foundation

Status: Draft
Linear: [ECS-69](https://linear.app/ecs3d/issue/ECS-69/implement-control-surface-runtime)
Project: [MIDI Core and Control Architecture](https://linear.app/ecs3d/project/midi-core-and-control-architecture-f934a737de3b)
Depends on: [docs/control-surface-architecture.md](../control-surface-architecture.md) (ECS-64),
[docs/contracts/surface-navigation.md](./surface-navigation.md) (ECS-67),
[docs/contracts/surface-bindings.md](./surface-bindings.md) (ECS-68),
[docs/contracts/mapping-runtime.md](./mapping-runtime.md) (ECS-37/57, `bindControlMapping()`)
Source of truth: [`src/surface/navigation.ts`](../../src/surface/navigation.ts),
[`src/surface/bindings.ts`](../../src/surface/bindings.ts)

## Scope

Phase 1 (ECS-63–68) produced contracts only — types and pure functions,
no code that resolves a profile against real ports, runs device setup, or binds a real `ControlMapping`. This is the first Phase 2
ticket: "the small runtime connecting application contracts to
profile-defined controls and MIDI Core." It deliberately does **not**
implement everything Phase 2 eventually needs — two pieces it explicitly
leaves to their own, already-scoped tickets (see "What's deliberately
not here"). What it does implement is the foundation both of those build
on: a concrete `SurfaceNavigation`, and the orchestration that installs/
tears down one mode's bindings against live MIDI ports.

## `createSurfaceNavigation()` — modes

`docs/contracts/surface-navigation.md` (ECS-67) defined `SurfaceNavigation`
as a contract with no reference implementation. `createSurfaceNavigation()`
(`src/surface/navigation.ts`) is that implementation: plain in-memory
state, `setMode()`/`pageBy()` applying a change and notifying listeners,
nothing else. Two deliberate choices, both already implied by the
contract rather than new here:

- **`pageBy()` on a mode with no `gridOffset` is a no-op**, not a
  fabricated `{ row: 0, column: 0 }` origin — a mode like Transport that
  was never given a grid offset doesn't gain one just because something
  called `pageBy()` on it.
- **A `setMode()`/`pageBy()` call that doesn't actually change the state
  doesn't notify** — the same "a state never transitions to itself"
  reasoning `isValidSurfaceTransition()`/`isValidTransition()` already
  apply elsewhere in this project.

No mode-switching *policy* — deciding which mode a selection should arm —
lives here; that's ECS-75, reading `SurfaceContext` and calling
`setMode()`/`pageBy()` on the object this function returns.

## `bindSurfaceMode()` / `bindActiveMode()` — bindings, and the lifecycle hook-in

`docs/contracts/surface-bindings.md` (ECS-68) named the generation
step's declarative input (`SurfaceModeDefinition`) but left two things
for whoever actually calls it: translating a `PhysicalControl`'s address
into a live `MidiSource`/`MidiTarget` (ECS-72's scope, not this one's —
see below), and the mechanical work of installing/tearing down whatever
that produces. `bindSurfaceMode()` (`src/surface/bindings.ts`) is the
second half:

1. Runs `modeDefinition.hooks?.onEnter?.()`.
2. Resolves this mode's bindings — `hooks.resolveBindings(context)` if
   present, else the static `bindings` array — and filters to only
   `ControlBinding`s. A `NavigationBinding` is not wired by this
   function; see "What's deliberately not here."
3. Calls the injected `generate` (typed as `GenerateControlMappings`,
   `src/surface/types/generation.ts`) with the profile, the filtered
   bindings, and the context, getting back `GeneratedBinding[]` — each a
   `ControlMapping` paired with the port id(s) it binds against (a
   `ControlMapping` itself carries no port id — see `GeneratedBinding`'s
   own doc comment for why one is needed here).
4. For each one, looks up the `Control` (`registry.getControl`) and the
   `MidiInput` (`ports.inputs[inputPortId]`); if either is missing, skips
   it silently. If `mapping.feedback` is set but no `MidiOutput` resolves
   for `outputPortId`, the whole mapping is skipped (not bound input-only)
   rather than silently dropping half of what was authored.
5. Binds each surviving one with the existing `bindControlMapping()`
   (`docs/contracts/mapping-runtime.md`) — no new binding mechanism, per
   the architecture doc's "one mapping stage" decision.
6. Returns a teardown that unbinds every one of them, then runs
   `modeDefinition.hooks?.onExit?.()`.

`bindActiveMode(table, navigation, deps)` is the thin wrapper that looks
up the `SurfaceModeDefinition` matching `navigation.state.mode` in a
`SurfaceBindingTable` and calls `bindSurfaceMode()` with it — the exact
function a `ControlSurface` implementation calls at the two moments
`docs/contracts/surface-lifecycle.md` already names: entering
`"attached"` to install, entering `"detaching"` to tear down (by
awaiting the returned teardown). A navigation mode with no matching
table entry binds nothing, the same "report, don't invent" stance a
misconfigured mapping already gets elsewhere in this project — not an
error, since a surface isn't required to have every possible mode
configured.

### Why a teardown, not the project's usual `Unsubscribe`

Every other binding in this project (`MidiInput.onMessage`,
`Control.onChange`, `bindControlMapping()` itself) returns a plain,
synchronous `() => void`. `bindSurfaceMode()` returns
`SurfaceModeTeardown = () => Promise<void>` instead, because its
teardown has to await `hooks.onExit`, which `docs/contracts/surface-
bindings.md` already types as `Promise<void> | void`. Widening every
`Unsubscribe` in the project to accommodate one async hook would be the
wrong direction; a new, narrowly-scoped type local to this one operation
is cheaper and doesn't touch anything already shipped.

## `GeneratedBinding` / `GenerateControlMappings`: the seam ECS-72 fills in

`src/surface/types/generation.ts` defines the one new type this ticket
needed in order to call a generation step that doesn't exist yet:

```ts
interface GeneratedBinding {
  mapping: ControlMapping;
  inputPortId: string;
  outputPortId?: string; // present only when mapping.feedback is set
}

type GenerateControlMappings = (
  profile: DeviceProfile,
  bindings: readonly ControlBinding[],
  context: SurfaceContext,
) => readonly GeneratedBinding[];
```

A `ControlMapping` (`docs/contracts/mapping.md`) is deliberately
transport-agnostic — a `MidiSource`/`MidiTarget` names an address and
channel, never a port. That's correct for the mapping contract itself,
but a `DeviceProfile` can expose more than one port
(`docs/contracts/device-profile.md`'s `DevicePortProfile`), so something
has to say which connected `MidiInput`/`MidiOutput` a given generated
mapping actually belongs to. `GeneratedBinding` is the minimum addition
that answers that, following the same `portId`/`feedbackPortId`
convention (ECS-62) `PhysicalControl` already uses.

**`generate` is injected, not implemented here.** Reading a
`PhysicalControl`'s `input`/`feedback` (`ControlSurfaceAddress`) and
translating it into a `MidiSource`/`MidiTarget` for the `ControlId`
each `ControlBinding` resolves to is exactly ECS-72's scope ("Implement
the agreed declarative relationships between profile-defined physical
controls and application controls... Express track volume, transport
and step bindings without hardcoded device note layouts"). `bindSurfaceMode()`
only needs to agree on `generate`'s *signature* to be built and tested
now, against a hand-written `generate` double (see
`src/surface/bindings.test.ts`); ECS-72 supplies the real one later
without this file changing.

## What's deliberately not here

- **No `ControlSurface` implementation** — no `attach()`/`detach()`
  connecting real ports or running device setup. That contract
  (`docs/contracts/surface-lifecycle.md`) is fully specified already;
  implementing it is ECS-76 ("Implement surface lifecycle/error
  handling... after runtime foundation exists"), built on
  `bindActiveMode()` as the function it calls at its two hook-in
  moments. This ticket provides that foundation; it does not also build
  what's meant to be built on top of it.
- **No generation step** — no code reading `PhysicalControl.input`/
  `feedback` or translating a `ControlSurfaceAddress` into a
  `MidiSource`/`MidiTarget`. That's ECS-72; `GenerateControlMappings`
  names the function signature it must satisfy, nothing more.
- **No `NavigationBinding` wiring** — a hardware "next page"/mode button
  needs the same profile-address-to-live-MIDI translation `generate()`
  does for `ControlBinding`s, just driving `SurfaceNavigation` instead
  of a `Control`. `bindSurfaceMode()` filters `NavigationBinding`s out
  rather than guessing at that translation itself; wiring them is left
  for whichever ticket first needs a navigation control that isn't
  exercised purely through test code (ECS-72 or ECS-75, not decided
  here).
- **No mode-switching policy or rebind-on-context-change** — `createSurfaceNavigation()`
  and `bindActiveMode()` are both pure mechanism; nothing here subscribes
  to `navigation.onChange()` and automatically unbinds/rebinds when the
  active mode changes mid-attach. That reactive behavior, and the policy
  deciding which mode a selection should arm, is ECS-75's scope.
- **No `ControlRegistry`/`SurfaceContext`/mock-device implementation** —
  `bindSurfaceMode()` takes a `ControlRegistry` and a `SurfaceContext` as
  given; building real ones is ECS-70 (application context/state) and
  ECS-71 (generic mock device), both independent of this ticket.
