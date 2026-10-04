# Control Surface — Bindings

Status: Draft
Linear: [ECS-68](https://linear.app/ecs3d/issue/ECS-68/resolve-declarative-mapping-vs-scripthook-architecture)
Project: [MIDI Core and Control Architecture](https://linear.app/ecs3d/project/midi-core-and-control-architecture-f934a737de3b)
Depends on: [docs/control-surface-architecture.md](../control-surface-architecture.md) (ECS-64),
[docs/contracts/device-profile.md](./device-profile.md) (ECS-39, `PhysicalControl`),
[docs/contracts/control-api.md](./control-api.md) (ECS-65, `Selection`/`SurfaceContext`),
[docs/contracts/surface-navigation.md](./surface-navigation.md) (ECS-67, `SurfaceModeId`/`GridOffset`),
[docs/contracts/mapping.md](./mapping.md) (ECS-36, `ControlMapping` — the generation step's output)
Source of truth: [`src/surface/types/bindings.ts`](../../src/surface/types/bindings.ts)

## Scope

`docs/control-surface-architecture.md` (ECS-64) named the generation
step's shape — `(DeviceProfile, binding table) -> ControlMapping[]` — and
deliberately left "what 'binding table' means precisely" open, pointing
here. `docs/contracts/surface-navigation.md` (ECS-67) repeated the same
deferral ("what controls a mode binds and how is ECS-68's... decision").
This ticket is that decision: the shape of a mode's binding table, and
how far declarative data goes before a hook is needed. Like the contracts
it depends on, this produces **only the contract**
(`src/surface/types/bindings.ts`) plus one pure resolution function — no
implementation of the generation step itself (that's ECS-72), no wiring
into `ControlSurface`'s `attach()`/`detach()` (that's ECS-69), and no
runtime LLM dependency anywhere in this or any live control path.

## The decision: declarative bindings, two narrow hooks, nothing else

The ticket frames four options — declarative configurations, state
machines, scripts, or declarative bindings plus controlled lifecycle/
event hooks — and names a preference for the last. This contract adopts
it outright, for the same reason the rest of this project's contracts
stay data-first:

- **Rejected: state machines.** A mode's binding set has no transitions
  of its own to model — mode *switching* is already fully specified by
  `docs/control-surface-architecture.md` (batch unbind/rebind around a
  lifecycle event) and `docs/contracts/surface-navigation.md`
  (`setMode()`/`pageBy()`). Wrapping that in a second, generic state-machine
  abstraction here would duplicate a decision already made one layer up,
  for no behavior a plain `SurfaceModeId` lookup doesn't already give.
- **Rejected: scripts.** Letting a mode's bindings be authored as
  arbitrary code with access to `MidiInput`/`MidiOutput`/`DeviceProfile`
  internals is exactly what "without assuming arbitrary JavaScript is
  required" rules out — it would let every mode re-derive MIDI address
  translation the generation step already owns, the same duplication
  `docs/control-surface-architecture.md`'s boundary rules forbid.
- **Adopted: declarative bindings, data only.** `ModeBinding` (below)
  names a `PhysicalControl` and what it means — an application `ControlId`
  to resolve, or a navigation action to trigger — as plain, serializable
  data. This covers the two behaviors the ticket asks to prefer
  declaratively: device-control ↔ application-control (`ControlBinding`)
  and the "navigate" half of state → feedback (feedback itself needs no
  new declarative language at all — see "Feedback" below).
- **Adopted: two narrow hooks**, not a general escape hatch — see
  `SurfaceModeHooks` below. Each is a plain, narrowly-typed function
  (this is a TypeScript library; its consumers already write TypeScript),
  not a stringified expression or a sandboxed script — "no arbitrary
  JavaScript required" describes the *default* authoring path, not a ban
  on a hook ever being a function.

## No MIDI address data, ever

A binding names a `PhysicalControl.id` to look up — never a note number,
CC number, or channel. `docs/contracts/device-profile.md` already owns
that data on the `PhysicalControl` it belongs to; the generation step
(ECS-72) reads a binding's `physicalControlId`, looks up that
`PhysicalControl`, and translates its `input`/`feedback`
(`ControlAddress`) into a `MidiSource`/`MidiTarget` itself. Re-authoring
any of that here would be exactly the duplication webseq's
`src/midi/mappings.ts` hand-writing raw CC numbers already demonstrates
as a problem, and that `docs/control-surface-architecture.md`'s boundary
rules explicitly forbid for this layer.

## `ControlIdResolution`: role ↔ application control, declaratively

```ts
export type ControlIdResolution =
  | { kind: "static"; controlId: ControlId }
  | { kind: "from-selection"; scope: string; template: string };
```

`"static"` is the common case: a role that always means the same
`ControlId` regardless of selection (transport play is always
`"transport.play"`). `"from-selection"` is for a role whose target
depends on the application's current `Selection`
(`docs/contracts/control-api.md`) — the architecture doc's own example,
"track fader" meaning whichever track is selected, is exactly
`{ kind: "from-selection", scope: "track", template: "track.{id}.volume" }`:
`resolveControlId()` reads `SurfaceContext.getSelection("track")` and
substitutes its `id` for every `"{id}"` in `template`, producing
`"track.3.volume"`.

One placeholder, no further expression syntax. A role needing more than
one selection's id, or any actual computation (e.g. picking a `ControlId`
based on *two* selections at once), is exactly what
`SurfaceModeHooks.resolveBindings` is for — adding a second placeholder
or a mini-expression language here would be designing for a case no
concrete mode has yet, the project's standing rule against speculative
features.

`resolveControlId(resolution, context)` returns `undefined` — never
throws — when a `"from-selection"` binding names a scope with nothing
currently selected, mirroring `docs/contracts/mapping.md`'s own
resolution functions returning `undefined` for an unsupported pairing
rather than taking down a live caller.

## `NavigationAction`: the hook "navigation" turns out not to need

```ts
export type NavigationAction =
  | { kind: "set-mode"; mode: SurfaceModeId }
  | { kind: "page-by"; delta: GridOffset };
```

The ticket names "navigation" as one of the four cases a hook might be
needed for. It isn't, here: a hardware "next page" or mode button is
already fully describable as data — `pageBy()`/`setMode()`
(`docs/contracts/surface-navigation.md`) are the complete, fixed set of
surface-local navigation gestures, so a `NavigationBinding` just names
which one a `PhysicalControl` triggers. No resolution, no context lookup,
no hook — this is the one of the ticket's four categories a purely
declarative shape already covers.

## `ModeBinding`: one `PhysicalControl`'s assigned meaning

```ts
interface ModeBindingBase {
  physicalControlId: string; // PhysicalControl.id
  role: ControlRole;         // "pad grid", "transport play" — documentation only
}

interface ControlBinding extends ModeBindingBase {
  kind: "control";
  resolve: ControlIdResolution;
}

interface NavigationBinding extends ModeBindingBase {
  kind: "navigate";
  navigate: NavigationAction;
}

type ModeBinding = ControlBinding | NavigationBinding;
```

`role` carries no behavior — nothing reads it to make a decision, the
same way `ControlDef.label` is purely informational. It's kept because
`docs/control-surface-architecture.md` already frames the entire
generation step around "the binding table assigns a role to" each
`PhysicalControl"; dropping the field here would silently undo that
vocabulary one ticket later.

## `SurfaceModeDefinition` and `SurfaceBindingTable`

```ts
interface SurfaceModeDefinition {
  mode: SurfaceModeId;
  bindings?: readonly ModeBinding[];
  hooks?: SurfaceModeHooks;
}

type SurfaceBindingTable = readonly SurfaceModeDefinition[];
```

One `SurfaceModeDefinition` per mode a surface supports — the full
`SurfaceBindingTable` is what the generation step's "binding table"
parameter names. `bindings` is the common, fixed case; a mode supplying
`hooks.resolveBindings` instead (next section) uses that to produce the
same shape dynamically. Nothing here enforces that exactly one of the two
is present for a given mode — see "What's deliberately not here."

## `SurfaceModeHooks`: the two genuine escape valves

```ts
interface SurfaceModeHooks {
  onEnter?(): Promise<void> | void;
  onExit?(): Promise<void> | void;
  resolveBindings?(context: SurfaceContext): readonly ModeBinding[];
}
```

Both optional; most modes need neither. Each answers exactly one of the
ticket's remaining named categories:

- **Unusual initialization and protocol quirks collapse into one hook.**
  Both are, concretely, "something imperative has to happen around a mode
  transition that no declarative field covers" — a device-specific
  mode-select message sent on every switch into a mode (not a one-time
  connection handshake, so it doesn't belong in `DeviceHandshake`), or a
  quirky device needing a specific message sequence to arm a mode. One
  pair of hooks, `onEnter`/`onExit`, covers both without inventing a
  second, overlapping hook type for "quirks" specifically. Neither is
  passed a `MidiOutput` — the same device-specific-knowledge boundary
  `HandshakeExecutor` (`docs/contracts/surface-lifecycle.md`) already
  draws: whoever supplies a hook supplies its own access to the device,
  this contract doesn't hand it one.
- **Dynamic modes** get `resolveBindings(context)`, called in place of a
  fixed `bindings` array when a mode's control set can't be known at
  authoring time (e.g. one pad bound per currently-existing track). It
  still returns the same declarative `ModeBinding[]` shape `bindings`
  would have held — a dynamic mode produces data for the generation step
  to consume, not a second imperative code path through it.

## Feedback: still no new type

Per `docs/control-surface-architecture.md`'s bidirectional flow and
`docs/contracts/control-api.md`'s own conclusion, "state → feedback" is
already fully covered: a bound `ControlMapping`'s `feedback` target
(derived from the matched `PhysicalControl.feedback`, exactly as today)
drives `buildFeedbackMessage()` whenever the application `Control`'s
`onChange()` fires. A `ControlBinding` names *which* control a
`PhysicalControl` is paired with; once the generation step produces its
`ControlMapping`, feedback is the existing mechanism, unchanged. No
declarative "state → feedback" language is invented here because one
already exists and fully covers it.

## What's deliberately not here

- **No generation step implementation** — no code reading a
  `SurfaceBindingTable` and a `DeviceProfile` to actually produce
  `ControlMapping[]`. That's ECS-72, built against the shapes defined
  here.
- **No wiring into `ControlSurface`** — `attach()`/`detach()`
  (`docs/contracts/surface-lifecycle.md`) still don't know a
  `SurfaceBindingTable` exists; hooking mode binding into the lifecycle
  and into `SurfaceNavigation.onChange()` is ECS-69.
- **No validation** — a dangling `physicalControlId`, a
  `SurfaceModeDefinition` with neither `bindings` nor
  `hooks.resolveBindings`, a `ControlBinding.resolve` naming a `scope`
  nothing ever selects. TypeScript's structural typing catches shape
  mistakes, not these; a future diagnostics pass (the same role
  `docs/contracts/profile-validation.md` plays for device profiles) is
  where that belongs, not this schema.
- **No curves, transforms, or conditions** on a `ControlMapping` produced
  from a binding — unchanged from `docs/contracts/mapping.md`'s own
  deferral; a binding has no field to carry one.
- **No richer resolution expression language** — one `"{id}"` placeholder
  only; see `ControlIdResolution` above.
- **No runtime LLM dependency** — resolution and hook dispatch are
  deterministic lookups and plain function calls; nothing here infers a
  binding or a mode choice.
