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
  when?: ModifierCondition;  // ECS-137, see below
}

interface ControlBinding extends ModeBindingBase {
  kind: "control";
  resolve: ControlIdResolution;
}

interface NavigationBinding extends ModeBindingBase {
  kind: "navigate";
  navigate: NavigationAction;
}

type ModeBinding = ControlBinding | NavigationBinding | WindowedControlBinding | IndicatorBinding | DisplayBinding;
```

(`WindowedControlBinding` and `IndicatorBinding` — a grid window onto an
application control, and a feedback-only lit-while-equal indicator — were
added after this ticket by ECS-89/ECS-95/ECS-114; both still extend
`ModeBindingBase` exactly as above. `DisplayBinding` is new in ECS-137,
below.)

## Conditional (modifier) bindings (ECS-137)

```ts
type ModifierCondition = "modifier-held" | "modifier-released";
```

`when`, on every `ModeBindingBase`, gates a binding on the mode's
`DeviceLayout.modifier` button (`docs/contracts/device-profile.md`).
Omitted — the case for every binding before this field existed —
reproduces the exact previous behavior, unconditionally; this is the hard
compatibility requirement. Present, two bindings may target the same
`physicalControlId` within one mode, each with a different `when`:
`src/surface/bindings.ts`'s `bindSurfaceMode()` tracks the modifier
button's live held/released state once per mode-bind and dispatches each
incoming message to whichever binding currently applies. A profile with
no `layout.modifier` declared never satisfies either `when` value — a
conditional binding on such a device is simply never live, not an error.

Ownership split: which button is the modifier is a device fact
(`DeviceLayout.modifier`, profile-owned); the held/released resolution
rule is generic, `src/surface/bindings.ts`-owned mechanics, reusable by
any device with a shift-style button. The MIDI-mapping runtime itself
(`docs/contracts/mapping-runtime.md`) knows nothing about "modifier" —
`bindSurfaceMode()` supplies it a bare `shouldApply()` predicate through
`bindControlMapping()`'s own generic gate.

## Display bindings (ECS-137)

```ts
interface DisplayBinding {
  kind: "display";
  displayId: string; // DeviceDisplayDefinition.id
  lineId: string;     // DisplayLineTemplate.id within that display
  resolve: ControlIdResolution;
}
```

Not a `ModeBindingBase`: a display has no input semantics, so there's no
physical-control press to assign a role to — only a resolved string
`Control` to paint out, through `DeviceDisplayDefinition`'s declarative
SysEx template (`docs/contracts/device-profile.md`), whenever it changes.
The same "state → feedback" mechanism every other binding kind already
uses (see "Feedback: still no new type" below), just for text instead of
a note/CC value; `src/surface/display-binding.ts`'s `buildDisplayMessage()`
is the one place that turns a display line plus a string into actual
bytes.

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
  connection setup, so it doesn't belong in `DeviceSetup`), or a
  quirky device needing a specific message sequence to arm a mode. One
  pair of hooks, `onEnter`/`onExit`, covers both without inventing a
  second, overlapping hook type for "quirks" specifically. Neither is
  passed a `MidiOutput`: a hook that needs the device supplies its own access
  to it, and this contract doesn't hand one over.
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
- **No curves or transforms** on a `ControlMapping` produced from a
  binding — unchanged from `docs/contracts/mapping.md`'s own deferral.
- **Conditions**, unlike curves/transforms, are no longer undesigned —
  see "Conditional (modifier) bindings" above (ECS-137). `ControlMapping`
  itself still carries no condition field; the condition lives on the
  binding (`when`) and is applied as a generic runtime predicate, not as
  new data on the mapping shape `mapping.md` defines.
- **No richer resolution expression language** — one `"{id}"` placeholder
  only; see `ControlIdResolution` above.
- **No runtime LLM dependency** — resolution and hook dispatch are
  deterministic lookups and plain function calls; nothing here infers a
  binding or a mode choice.
