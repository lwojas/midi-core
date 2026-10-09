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
only a setup step with no description). Nothing here corrects or
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
  matters). `relativeEncoding` (if present) must be a real
  `RelativeEncoding` (`unknown-relative-encoding`, ECS-137), and is
  *required* when `valueMode` is `"relative"` and `input` is set
  (`relative-control-missing-encoding`) — the one cross-field requirement
  `device-profile.md` itself names, the same pattern `sysex.required`
  already establishes below, not a new kind of check.
- **`grids`** — every cell's `(row, column)` must fall inside the grid's
  declared `rows`/`columns` (`grid-cell-out-of-bounds`), no two cells in
  one grid share a position (`duplicate-grid-cell`), every cell's
  `controlId` must resolve to a declared control
  (`dangling-control-reference`, the other reference `device-profile.md`
  named), and no two grids share an `id` (`duplicate-grid-id`).
- **`layout`** (ECS-90) — when present, must be an object (`invalid-layout`),
  `modeButtons` must be an array of objects with a string `mode` and a `controlId`
  (`invalid-layout`), and every control id named by `modeButtons`, `pageLeft`,
  `pageRight`, `transport` or `modifier` (ECS-137) must be a declared control
  (`dangling-control-reference`). The validator doesn't check whether a mode name
  means anything: the surface decides that, and the configuration reports any role
  it cannot bind.
- **`displays`** (ECS-137) — when present, must be an array of objects with
  string `id`/`label`/`portId` (`invalid-display`); `portId` must resolve to a
  declared *output* port (`dangling-port-reference`, or `invalid-display` if it
  resolves to the wrong direction); `prefix` must start with 0xF0 and `textPrefix`
  must hold bytes 0-255 (`invalid-display`); `charCount` must be a positive integer
  (`invalid-display` — a line/char-count mismatch); `lines` must be a non-empty
  array of `{ id, label, lineId }` with `lineId` a byte 0-127 (`invalid-display`),
  no two displays sharing an `id` (`duplicate-display-id`), and no two lines of one
  display sharing a `lineId` (`duplicate-display-line-id`).
- **`sysex`** — `required: true` with an empty/missing `manufacturerId`
  is flagged (`sysex-required-no-manufacturer-id`): a profile claiming
  vendor SysEx is required but not saying which vendor is exactly the
  "unresolved... rather than invented" case from the ticket — silently
  treating it as "no SysEx needed" would be inventing an answer the data
  doesn't support.
- **`setup`** — the same reasoning. `inputPortId`/`outputPortId` must name a declared
  input and output port that is `required` (`dangling-port-reference`,
  `setup-port-wrong-type`, `setup-port-not-required`). Each step must have exactly
  one of `send` or `expect` (`setup-step-needs-send-or-expect`). Bytes must be
  integers 0-255, and `null` is allowed only in `expect` (`setup-byte-out-of-range`).
  A SysEx `send` must end in 0xF7 (`setup-sysex-unterminated`). A step with no
  `description` is a `warning` (`setup-step-missing-description`), valid but not
  actionable for whoever has to perform it.actionable for whoever has to perform it.

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

## `validateDeviceOverrides(profile, overrides): readonly ProfileDiagnostic[]` (ECS-137)

Validates a `DeviceOverrides` document (`docs/contracts/device-profile.md`'s
"Overrides, standalone" section) against the `DeviceProfile` it claims to
apply to — `overrides` is `unknown`, the same untrusted-data stance
`validateDeviceProfile()` takes. Scoped, per the ECS-136 architecture
gate's own split, to **version-check logic only**:

- `schemaVersion` must be a string (`invalid-overrides`) and match the
  version this build of midi-core understands
  (`unsupported-overrides-schema-version`).
- `profileId` must be a string (`invalid-overrides`) and match
  `profile.identity.id` (`overrides-profile-mismatch`).
- `profileSchemaVersion` must be a string (`invalid-overrides`); a
  mismatch against `profile.schemaVersion` is a `"warning"`
  (`overrides-stale-profile-schema`), not an error — the profile may have
  moved on since these overrides were authored, which is worth flagging
  but not necessarily fatal on its own.

It does not validate `layoutOverrides`/`bindingOverrides`' own contents
against the profile's actual controls/bindings — that's ECS-142's job,
once a schema for them exists.

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
