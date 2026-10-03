# Profile Validation and Diagnostics

Status: Draft
Linear: [ECS-42](https://linear.app/ecs3d/issue/ECS-42/define-profile-validation-and-diagnostics)
Depends on: [docs/contracts/device-profile.md](./device-profile.md) (ECS-39), [docs/contracts/protocol-composition.md](./protocol-composition.md) (ECS-40)
Source of truth: [`src/profile/validation/`](../../src/profile/validation)

## Scope

Every prior profile-layer contract deferred the same thing here: dangling
references, unknown enum values, unresolved protocol ids, and — the
ticket's own framing — "unsupported, unknown or unresolved behavior
rather than invented handshakes." This defines that validation: two pure
functions, each returning a list of actionable `ProfileDiagnostic`s
instead of throwing or silently accepting broken data.

## `ProfileDiagnostic`

```ts
type DiagnosticSeverity = "error" | "warning";

interface ProfileDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: ProfileDiagnosticCode; // closed union, one per check below
  readonly path: string; // e.g. "controls[2].portId"
  readonly message: string;
}
```

`"error"` means the document is structurally broken or asserts something
that can't be resolved (a dangling reference, an unknown enum value, an
unresolved protocol). `"warning"` means the document is valid but
under-specified in a way that would leave a consumer guessing (currently
only a handshake step with no description). Nothing here corrects or
infers a fix — every finding is reported, never papered over.

## `validateDeviceProfile(profile: unknown): readonly ProfileDiagnostic[]`

Takes `unknown`, not `DeviceProfile` — deliberately. A `DeviceProfile` is
meant to be serialized and produced by a separate tool
(`docs/contracts/device-profile.md`'s whole reason for `schemaVersion`
existing); validating something TypeScript has already checked would be
pointless, but validating what actually arrives — parsed JSON, with no
static guarantees at all — is the real job. Checks, each traceable to a
specific thing an earlier contract named as deferred:

- **`schemaVersion`** — missing/wrong type (`invalid-schema-version`), or
  present but not the version this build of midi-core understands
  (`unsupported-schema-version`). This is the mismatch
  `device-profile.md` said `schemaVersion` exists to let a producer and
  consumer detect; this is where that detection actually happens.
- **`identity`** — must be an object with string `id`/`manufacturer`/
  `model` (`invalid-identity`).
- **`ports`** — each port's `type` must be a real `PortType`
  (`unknown-port-type`), each `messageTypes` entry a real
  `MidiMessageType` (`unknown-message-type`), and no two ports share an
  `id` (`duplicate-port-id`).
- **`controls`** — `kind` must be a real `ControlKind`
  (`unknown-control-kind`), `valueMode` (if present) a real
  `ControlValueMode`, `feedback.kind` (if present) a real `FeedbackKind`;
  `portId` must resolve to a declared port (`dangling-port-reference`,
  named directly in `device-profile.md`), and so must `feedbackPortId`
  when present (same code, ECS-62 — the convention that `portId` names the
  input-direction port made it possible to name feedback's own port
  explicitly too); no two controls share an `id` (`duplicate-control-id` —
  this is also what catches a composition that produced colliding ids, per
  `protocol-composition.md`, since by the time controls reach this
  function their origin, protocol-composed or hand-authored, no longer
  matters).
- **`grids`** — every cell's `(row, column)` must fall inside the grid's
  declared `rows`/`columns` (`grid-cell-out-of-bounds`), no two cells in
  one grid share a position (`duplicate-grid-cell`), every cell's
  `controlId` must resolve to a declared control
  (`dangling-control-reference`, the other reference `device-profile.md`
  named), and no two grids share an `id` (`duplicate-grid-id`).
- **`sysex`** — `required: true` with an empty/missing `manufacturerId`
  is flagged (`sysex-required-no-manufacturer-id`): a profile claiming
  vendor SysEx is required but not saying which vendor is exactly the
  "unresolved... rather than invented" case from the ticket — silently
  treating it as "no SysEx needed" would be inventing an answer the data
  doesn't support.
- **`handshake`** — the same reasoning, by name: `required: true` with
  zero `steps` is flagged (`handshake-required-no-steps`) rather than a
  consumer silently skipping the handshake or synthesizing one. Each
  step's `direction` must be a real `HandshakeDirection`
  (`unknown-handshake-direction`); a step with no `description` is a
  `warning` (`handshake-step-missing-description`) — valid, but not
  actionable for whoever has to perform it.

## `validateProtocolBindings(bindings, protocols, ports): readonly ProfileDiagnostic[]`

The composition-side counterpart, validating a composition's own inputs
— already-typed `ProtocolBinding[]`/`ReadonlyMap<string, ProtocolFamily>`/
`DevicePortProfile[]`, not untrusted JSON, since these exist only inside a
caller's own TypeScript before `composeDeviceProfile()` runs. Catches
exactly the three cases `protocol-composition.md` named as deferred:

- a binding's `protocolId` not present in the supplied registry
  (`unresolved-protocol-reference`);
- a binding's `portId` not present in `ports` (`dangling-port-reference`);
- two bindings sharing the same `id` (`duplicate-binding-id` — the
  authoring mistake that would otherwise surface downstream as a
  `duplicate-control-id` once composed, caught here instead, before
  composing).

## What's deliberately not here

- **No fixing, coercion, or defaults** — both functions only report.
  Correcting a broken profile, or substituting a generic fallback for an
  unresolvable one, is a caller's decision, not this layer's.
- **No field-level type/range checking beyond what each listed check
  needs** — e.g. a CC controller number outside `0-127`, or a `label`
  that's an empty string, are not flagged. Only the specific structural
  and cross-reference problems named above (and, transitively, in
  `device-profile.md`/`protocol-composition.md`) are checked; adding
  exhaustive field-level validation with no named use case would be
  exactly the speculative work this layer has avoided throughout.
- **No semantic/plausibility checks** — e.g. whether a `kind: "fader"`
  control's `valueMode: "relative"` makes sense, or whether a device's
  declared controls are physically consistent with its grids. Nothing in
  `device-profile.md` specifies such a rule, so nothing here invents one.
- **No composed-profile convenience wrapper** — a caller validates
  `ProtocolBinding`s before composing and/or validates the resulting
  `DeviceProfile` after; there's no single function that does both, since
  the two inputs (typed bindings vs. untrusted JSON) are different enough
  in kind that combining them wouldn't simplify anything.
- **No schema migration** — an `unsupported-schema-version` finding is
  reported, not translated from an older version into the current shape.
  If `DeviceProfile` ever needs that, it's new, separate work.
