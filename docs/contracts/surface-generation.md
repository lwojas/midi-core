# Control Surface — Binding Generation

Status: Draft
Linear: [ECS-72](https://linear.app/ecs3d/issue/ECS-72/implement-basic-control-bindings)
Project: [MIDI Core and Control Architecture](https://linear.app/ecs3d/project/midi-core-and-control-architecture-f934a737de3b)
Depends on: [docs/control-surface-architecture.md](../control-surface-architecture.md) (ECS-64),
[docs/contracts/surface-bindings.md](./surface-bindings.md) (ECS-68),
[docs/contracts/surface-runtime.md](./surface-runtime.md) (ECS-69),
[docs/contracts/mapping.md](./mapping.md) (ECS-36)
Source of truth: [`src/surface/generate.ts`](../../src/surface/generate.ts)

## Scope

This is the last piece the generation step named throughout Phase 1 —
`(DeviceProfile, binding table) -> ControlMapping[]`
(`docs/control-surface-architecture.md`), the `GenerateControlMappings`
seam `src/surface/bindings.ts` left as an injected parameter
(`docs/contracts/surface-runtime.md`, ECS-69) — actually needed to run.
`generateControlMappings()` (`src/surface/generate.ts`) implements it:
for each `ControlBinding`, find the `PhysicalControl` it names, translate
that control's declared `input`/`feedback` into a `MidiSource`/
`MidiTarget`, resolve the `ControlId` its role means right now, and pair
the resulting `ControlMapping` with the port id(s) it binds against.

Per the ticket, this reuses `ControlMapping`/`MidiSource`/`MidiTarget`
exactly as `docs/contracts/mapping.md` already defines them — "evolve
existing bidirectional mapping functionality... rather than creating a
second competing mapping system" — and authors no note/CC numbers of its
own; every address comes from `PhysicalControl.input`/`feedback`.

## Address translation, and where it stops

`toMidiAddress()` narrows a profile's `ControlSurfaceAddress` (the
superset covering `control-change`/`note`/`pitch-bend`/`program-change`/
`channel-pressure`/`poly-pressure`) down to the mapping layer's
`MidiAddress` (`control-change`/`note`/`pitch-bend` only). This is
exactly the "known, accepted limitation" `docs/control-surface-
architecture.md` already named and declined to work around with "its
own parallel address translation": a `PhysicalControl` addressed with
`program-change`, `channel-pressure` or `poly-pressure` has no path into
a `ControlMapping`, so `toMidiAddress()` returns `undefined` for it and
`generateControlMappings()` produces no entry for that binding — not an
error, the same "report, don't guess" stance every resolution function
in this project already takes.

`toMidiSource()`/`toMidiTarget()` apply this per direction:

- **Source** (`MidiSource`): a control with no `input` at all (a pure
  indicator) can't produce one — `ControlMapping.source` is required,
  and there's no shape in `docs/contracts/mapping.md` for "feedback-only,
  no source." An unresolved `input.channel` (ECS-62's partially-known-
  evidence case) becomes `MidiSource`'s `"any"`, the mapping layer's own
  placeholder for "don't care which channel" — a reasonable reading of
  "not yet known" for a *source*, since `"any"` was already the common
  case for an authored-once mapping.
- **Target** (`MidiTarget`): `MidiTarget.channel` must be concrete — "no
  such thing as sending feedback to any channel" per `mapping.md`. An
  unresolved `feedback.address.channel` therefore can't produce a
  target at all; the resulting mapping is simply input-only, rather than
  guessing a channel to make feedback "work" for data that was never
  fully resolved in the first place.

## What's deliberately not here

- **No wiring to a live `Control`/`MidiInput`/`MidiOutput`** — this
  function returns data (`GeneratedBinding[]`); turning that into a
  bound, live mapping is `src/surface/bindings.ts`'s job (ECS-69),
  exercised together in `src/surface/generate.test.ts`'s integration
  test (`generateControlMappings` + `bindSurfaceMode` + the ECS-71 mock
  surface device).
- **No curves, transforms, or conditions** — unchanged from
  `docs/contracts/mapping.md`'s own deferral; nothing here adds a field
  a `ControlMapping` doesn't already have.
- **No widening of `MidiAddress`** — see "Address translation" above;
  that stays `docs/contracts/mapping.md`'s decision.
- **No diagnostics channel** — a binding this can't resolve is silently
  dropped, not reported as a `ProfileDiagnostic`
  (`docs/contracts/profile-validation.md`); that validator checks a
  profile document on its own terms, not a binding table's resolution
  against one. A future tool wanting "why didn't `pad-9` bind anything"
  would need its own reporting, not an addition to this function's
  return type.
- **No mode-switching or navigation-binding wiring** — unchanged from
  ECS-69's own deferral; this ticket only supplies the function that was
  missing.
