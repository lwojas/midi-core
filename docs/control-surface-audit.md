# Audit: MIDI Core and Mapping Architecture vs. the Missing Control Surface

Status: Final (audit; no implementation)
Linear: [ECS-63](https://linear.app/ecs3d/issue/ECS-63/audit-existing-midi-core-and-mapping-architecture)
Project: [MIDI Core and Control Architecture](https://linear.app/ecs3d/project/midi-core-and-control-architecture-f934a737de3b)
Feeds: ECS-64 (Control Surface architecture), ECS-65 (application-facing surface
contract), ECS-66 (surface lifecycle/runtime), ECS-67 (modes/context model),
ECS-68 (declarative mapping vs. hooks)

## Purpose

Phase 1 of the Control Surface milestone starts from an assumption: a layer
is "missing." Before designing it (ECS-64–68), this audits what ECS-26–47
and ECS-57 actually built, across all three repos that implement it, and
states precisely where the existing contract ends. Completed issues are
treated as historical evidence of what was built and validated, not as
proof that every surface requirement (modes, lifecycle, bindings, feedback
routing for a *collection* of controls) is already met — several aren't.

## Scope and method

The audit, the Control API, and the mapping/profile layer do **not** live in
this repo (`midi-profiler`). They live in three sibling repos:

| Repo | Role | Depends on midi-core |
|---|---|---|
| `midi-core` | MIDI Core, Application Control API, MIDI↔Control mapping, Device Profile schema/composition/validation, Web MIDI + mock adapters | — (this is it) |
| `webseq` | Sequencer/DAW application; the only real consumer of the mapping layer today (`src/midi/`) | Yes — `package.json` dependency, imports `midi-core`, `midi-core/control-api`, `midi-core/mapping`, `midi-core/adapters/web-midi` |
| `midi-profiler` (this repo) | Offline tooling that generates `DeviceProfile` JSON documents from research evidence | **No** — deliberately no code dependency; mirrors midi-core's schema by convention and doc comments only (see `docs/evidence-model.md`, `src/generation/types/generated-profile.ts`) |

Findings below come from reading midi-core's `docs/architecture.md` and all
13 `docs/contracts/*.md` files against their `src/` implementations, webseq's
`src/midi/` (the one integration ECS-38 built), and the generated Launchpad
Mini MK3 profile in this repo (`profiles/novation-launchpad-mini-mk3/`).
Every one of midi-core's contract docs already carries a "What's
deliberately not here" section; this audit cites those directly rather than
re-deriving them, and adds what can only be seen by reading *across* the
three repos together — gaps no single repo's docs state because no single
repo owns the question.

## The layering as built

```
MIDI hardware
     |
MIDI Core               src/core/, src/adapters/{web-midi,mock}/   (midi-core)
     |
Device Profile           src/profile/                               (midi-core, schema+validation only —
     |                                                                no concrete profiles beyond the generic one)
Mapping                   src/mapping/                               (midi-core — ControlMapping + bindControlMapping)
     |
Application Control API  src/control-api/                           (midi-core — contract only)
     |
     |  (the one adapter boundary that knows about both: src/midi/)
     v
Sequencer / UI            src/midi/, src/components/MidiPanel.tsx    (webseq)
```

This matches `docs/architecture.md`'s layering exactly for the path that
was built. There is no "Control Surface" box in this diagram because
nothing by that name exists yet — what the project currently calls mapping
is doing double duty, covered below.

## Coverage map: what's reusable as-is

| Responsibility | Owner | Status | Reuse for Control Surface |
|---|---|---|---|
| Discovery, identity, lifecycle state machine | midi-core `src/core/types/{discovery,identity,lifecycle,connection}.ts` | Done (ECS-26/27), validated against real hardware (ECS-31) | Reuse unchanged. Surface lifecycle (ECS-66) sits *above* this, doesn't replace it. |
| Normalized message model + codec | midi-core `src/core/{types/message,message/codec}.ts` | Done (ECS-28) | Reuse unchanged. |
| Input/output wiring (`createMidiInput`/`createMidiOutput`) | midi-core `src/core/{input,output}/` | Done (ECS-29/30), proven bidirectionally (ECS-31) | Reuse unchanged. |
| Web MIDI + mock adapters | midi-core `src/adapters/` | Done (ECS-31/32) | Reuse unchanged; mock is already the generic test harness ECS-71 asks for, not device-specific. |
| `Control`/`ControlDef`/`isValidControlValue` | midi-core `src/control-api/types/control.ts` | Done (ECS-34/35) | Reuse unchanged. ECS-65 should extend this, not replace it — the ticket already says so. |
| `MidiAddress`/`MidiSource`/`MidiTarget`, value resolution (`resolveIncomingValue`/`buildFeedbackMessage`) | midi-core `src/mapping/{types/address,value}.ts` | Done (ECS-36) | Reuse unchanged for single-control bindings. |
| `ControlMapping` shape | midi-core `src/mapping/types/mapping.ts` | Done (ECS-36) | Reuse as the leaf unit a Control Surface composes, not as the surface's own binding language (see Gap 1). |
| `bindControlMapping()` + echo suppression | midi-core `src/mapping/bind.ts` | Done (ECS-37, hardened twice post-ECS-57 against real hardware: lagging-control and burst-coalescing leaks) | Reuse unchanged. This is the most battle-tested piece in the stack — keep it as the primitive a surface runtime calls once per binding. |
| Device Profile schema, composition, validation | midi-core `src/profile/` | Done (ECS-39/40/41/42), hardened once against a real profile's authoring gaps (ECS-62) | Reuse schema unchanged. Composition/validation reusable, but nothing consumes a `DeviceProfile` at runtime yet (Gap 2). |
| Generic MIDI profile | midi-core `src/profile/generic/` | Done (ECS-41) | Reuse as the pre-profile fallback the proposal (ECS-71) already plans to build a mock device from. |
| Real device profile (Launchpad Mini MK3) | `midi-profiler/profiles/novation-launchpad-mini-mk3/` | Done (ECS-47), hardened (ECS-62) | Data, not code — reusable as the first real profile a surface could bind to, once something bridges profile → mapping (Gap 2). |
| Sequencer integration pattern (one adapter module, rest of app unaware) | webseq `src/midi/` | Done (ECS-38), the only real end-to-end proof that exists | Reuse the *shape* (adapter boundary, `ProjectControl` wrapping immutable state), not the specific bindings — see Gap 4. |

## Where the mapping contract ends

`ControlMapping` (midi-core's `docs/contracts/mapping.md`) is, by its own
"what's deliberately not here" list, scoped to **exactly one MIDI source
driving exactly one application control, optionally with one feedback
target** — no curves, no conditions, no many-to-one/one-to-many, no device
profile awareness, no notion of a collection. `bindControlMapping()`
(`docs/contracts/mapping-runtime.md`) wires exactly one `ControlMapping` to
exactly one live `Control`.

That is the full extent of what exists. Everything a Control Surface needs
beyond binding one wire address to one control — modes/views switching
which bindings are active, lifecycle (attach/detach/cleanup) for a whole
device's worth of bindings at once, turning a `DeviceProfile`'s
`PhysicalControl[]` into a set of `ControlMapping`s, and application
context (selected track/pattern/parameter) driving any of that — has no
owner today. ECS-64–68 are deciding how to build that layer; this audit's
job is only to confirm the boundary is real and not already covered by
something that just hasn't been named "Control Surface" yet. It isn't:
webseq's `src/midi/mappings.ts` hand-writes two `ControlMapping`s for one
hardcoded track with a code comment explicitly noting its own scope
("architectural validation, not a complete MIDI feature set" — ECS-38).
There is no generalized version of what that file does by hand.

## Gaps (what the Control Surface layer must own)

**Gap 1 — No collection/runtime concept above one mapping.** `bindControlMapping()`
takes one mapping, one input, one output, one control, and returns one
`Unsubscribe`. There is no registry-driven "bind this device's whole
control layout" API — `docs/contracts/mapping-runtime.md` says so directly
("nothing here assumes a single input/output pair or forces mappings to be
bound together"). Binding N controls today means calling it N times by
hand, exactly as webseq does for its 2 controls. ECS-69 (Control Surface
runtime) is this gap's owner.

**Gap 2 — Nothing turns a `DeviceProfile` into `ControlMapping`s.** This is
named explicitly in `docs/contracts/device-profile.md` ("No mapping
generation — nothing here turns a profile's `PhysicalControl`s into
`ControlMapping`s... That would be a later tool bridging this schema and
the mapping layer, not part of either contract") and is visible end to end:
the real Launchpad Mini MK3 profile this project generated
(`midi-profiler/profiles/novation-launchpad-mini-mk3/`) is never read by
webseq. webseq's mappings are hand-authored from scratch, duplicating facts
(note/CC numbers, channel) the profile already recorded. ECS-72 (basic
control bindings) is this gap's owner; it should consume the existing
schema, not re-derive control addresses by hand a second time.

**Gap 3 — No mode/context model.** Nothing in midi-core or webseq
represents "the same physical control means something different in Mixer
vs. Step Grid vs. Transport mode," or who owns navigation (bank/page,
next/previous) versus application selection. `ControlMapping` is static:
one source, one control, permanently bound. ECS-67/75 own this; there is
nothing today to evolve, only a static primitive to compose underneath it.

**Gap 4 — No lifecycle model above Core's own connection lifecycle.**
Core's `ConnectionState` machine (available/connecting/connected/...)
governs one port. Nothing governs "a surface's overall attach/detach,"
multi-binding cleanup, or device availability in profile/application terms.
webseq's `useMidiControls.ts` hand-rolls exactly this for its one hardcoded
device (a `connectionRef` bundling input/output/unbinds/controls, torn down
together) — a real, working pattern, but local to one React hook, not a
reusable contract. ECS-66/76 own generalizing it.

**Gap 5 — `ControlRegistry` is defined but never implemented or consumed.**
`docs/contracts/control-api.md` defines `ControlRegistry` (list/get/observe
controls from an owner) explicitly so "enumerating controls is a separate
concern from reading or changing any one of them." No code in midi-core or
webseq implements it; webseq's `src/midi/mappings.ts` wires its two
`Control`s directly instead, name-checked by hand (`BOUND_TRACK_ID =
"track-1"`). `bindControlMapping()` itself was deliberately scoped to take
a `Control` directly rather than a `ControlId` resolved through a registry
(`docs/contracts/mapping-runtime.md`: "a caller that wants to resolve
`mapping.control` dynamically... composes that itself"). A Control Surface
binding a profile's N controls to an application's controls dynamically
needs this; right now nothing provides it.

**Gap 6 — No curves, conditions, or many-to-one/one-to-many mappings.**
Named as deliberately deferred in `docs/contracts/mapping.md` and
re-affirmed in `mapping-runtime.md`. Not yet a proven need (no real device
integration has hit this), but relevant to ECS-64's "do not build a
universal framework" instruction — worth not over-designing for in the
Control Surface contract until a concrete profile needs it, the same
restraint midi-core's own docs apply throughout.

**Gap 7 — Cross-repo schema coupling is by convention, not by type.**
`midi-profiler` has *no* code dependency on `midi-core` — a deliberate
choice (`docs/evidence-model.md`) to keep the offline profiler
dependency-free — so a generated `DeviceProfile` JSON matches midi-core's
schema only by hand-maintained structural convention and comments
(`src/generation/types/generated-profile.ts`: "by convention, not an
imported type"). `schemaVersion` plus midi-core's own
`validateDeviceProfile()` (ECS-42) catches a *runtime* mismatch once
someone actually loads a generated profile into midi-core — but nothing
caught the type drifting at authoring time, and as of this audit nothing
in webseq or midi-core actually loads a generated profile at all (see Gap
2), so that runtime check has never fired against real output. Not a code
change this audit is asking for — the decoupling is intentional and
documented — but ECS-64 should state explicitly that this is the integration
point's only current safety net, since a Control Surface that consumes
profiler output makes this coupling load-bearing for the first time.

## Non-gaps: deliberately out of scope, don't rebuild

These are named "deliberately not here" in midi-core's own docs and should
stay that way — the audit found no evidence any of them are blocking the
Control Surface work:

- SysEx byte-level templates/handshake execution (`device-profile.md`,
  `protocol-composition.md`) — profiles describe *that* a handshake is
  needed, never execute one. Still correct; a surface's lifecycle (ECS-66)
  is the first thing that would need to *perform* a documented handshake,
  which is new scope for ECS-66, not a gap in what exists.
- Concrete protocol families (MCU, MMC, Clock) beyond the generic MIDI
  baseline (`protocol-composition.md`) — no real device profile built so
  far has needed one.
- Multi-device/session-level echo suppression beyond one
  `bindControlMapping()` call's own change (`mapping-runtime.md`) — no
  concrete case has needed "soft takeover" semantics yet.

## Recommendation for ECS-64

Formalize the split the architecture doc already draws conceptually but no
code yet implements: keep `ControlMapping`/`bindControlMapping()` as the
*leaf* primitive (Gap 1–6 all describe things built **on top of** it, not
replacements for it), and define Control Surface as the layer that (a)
turns a `DeviceProfile` into a set of `ControlMapping`s (Gap 2), (b) manages
their lifecycle as a group (Gap 4), (c) switches which are active based on
application-owned context (Gap 3), and (d) resolves `ControlId`s dynamically
through something `ControlRegistry`-shaped (Gap 5) instead of each
integration hand-wiring `Control`s the way webseq's `src/midi/mappings.ts`
does today. This reuses 100% of midi-core's existing mapping/runtime
contract and webseq's adapter-boundary pattern; nothing here requires
touching `src/mapping/`, `src/control-api/`, or `src/core/`.
