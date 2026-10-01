# Device Profile — Schema

Status: Draft
Linear: [ECS-39](https://linear.app/ecs3d/issue/ECS-39/define-device-profile-schema)
Depends on: [docs/architecture.md](../architecture.md) (ECS-26, Device profiles extension point)
Related: [docs/contracts/discovery-lifecycle.md](./discovery-lifecycle.md) (ECS-27, `PortType`/`MidiPortInfo`),
[docs/contracts/message-model.md](./message-model.md) (ECS-28, `MidiMessageType`),
[docs/contracts/mapping.md](./mapping.md) (ECS-36, the narrower `MidiAddress` this schema's `ControlSurfaceAddress` deliberately doesn't reuse)
Source of truth: [`src/profile/`](../../src/profile)

## Scope

This defines the schema for a **device profile**: a data shape describing
one device model's identity, ports, physical controls (and how they're
laid out), output/LED or motorized feedback, vendor SysEx needs, and
connection handshake. Per the ticket and `docs/architecture.md`'s Device
profiles extension point, a profile describes *the device*, not
application behavior — this ticket produces **only the schema**: types and
a handful of leaf-level type guards, no runtime loading/parsing, no
validation beyond what TypeScript's structural typing already gives, and
no concrete profiles (Launchpad/APC/Push or otherwise).

This is the first piece of the Device/Profile/Mapping layer named in
`docs/architecture.md` that doesn't yet exist as code — `src/mapping/`
already defines the bridge between Core and the Application Control API,
but nothing before this ticket described a device itself. `src/profile/`
depends only on `src/core/` (reusing `PortType`, `Channel`, and
`MidiMessageType` where the concept is identical), not on `src/mapping/`
or `src/control-api/` — a profile is not a mapping, and doesn't name a
`ControlId`.

## Why not reuse `mapping`'s `MidiAddress`

`src/mapping/types/address.ts` models exactly the message kinds that
function as *application* controller surfaces — control-change, note,
pitch-bend — and explicitly excludes program change and aftertouch as "not
controller surfaces in the same sense." That's the right call for a
mapping (which assigns MIDI meaning to an application control), but a
device profile is describing a real device's actual physical controls,
and real controllers do use program change (scene/preset buttons) and
aftertouch (pressure strips, pressure-sensitive pads) as physical controls.
`src/profile/types/control.ts` therefore defines its own
`ControlSurfaceAddress` — a superset covering `control-change`, `note`,
`pitch-bend`, `program-change`, `channel-pressure` and `poly-pressure` —
rather than reusing or widening the mapping layer's deliberately narrower
type. `ControlAddress.channel` is always a concrete `Channel`, the same
choice `mapping.md` makes for `MidiTarget`: a profile describes one real
device's actual wiring, not a channel-agnostic rule.

## Shape

```ts
interface DeviceProfile {
  readonly schemaVersion: string;
  readonly identity: DeviceIdentity;
  readonly ports: readonly DevicePortProfile[];
  readonly controls: readonly PhysicalControl[];
  readonly grids?: readonly ControlGrid[];
  readonly sysex?: DeviceSysExProfile;
  readonly handshake?: DeviceHandshake;
}
```

- **`identity`** — `{ id, manufacturer, model }`. Distinct from Core's
  `MidiPortInfo`: `MidiPortInfo` identifies a connected *port* at runtime;
  `DeviceIdentity` identifies the *device model* a profile document
  describes. Nothing here matches a profile against a connected port —
  per `docs/architecture.md`, name/manufacturer matching is a heuristic
  for a higher layer, not this schema.
- **`ports`** — `DevicePortProfile`: `{ id, type, role, required,
  messageTypes }`, reusing Core's `PortType` and `MidiMessageType`
  directly. `role` is free text (e.g. `"main"`, `"daw-control"`) because
  device port layouts vary too much to close that list; `required` says
  whether the device needs this port connected to function at all (some
  controllers expose an optional second port running a DAW-remote mode).
- **`controls`** — `PhysicalControl`: `{ id, label, kind, portId, input?,
  feedback?, valueMode? }`. `kind` is one of `"button" | "pad" | "knob" |
  "encoder" | "fader" | "wheel"` — deliberately no `"key"`; keybed
  controllers are a different domain this schema doesn't target.
  `input`/`feedback` are both optional and independent (a button is
  usually input-only; a pure indicator LED could be feedback-only; a pad
  with its own LED is both). `valueMode` (`"absolute" | "relative"`,
  omitted meaning absolute) describes a real, common encoder behavior —
  each turn sending an increment/decrement rather than a position —
  purely as a fact about the device's wire behavior; interpreting a
  relative value is a mapping-layer concern, not this schema's.
- **`grids`** — `ControlGrid`: `{ id, label, rows, columns, cells }`, where
  each `GridCell` is `{ row, column, controlId }` referencing a
  `PhysicalControl` already declared in `controls`. A grid is purely a
  layout grouping, not a redefinition — it carries no address or feedback
  of its own.
- **`sysex`** — `DeviceSysExProfile`: `{ manufacturerId, required, notes?
  }`. Describes *that* a device needs vendor SysEx and whether normal
  operation depends on it; it does not model SysEx message
  templates/byte layouts — that's real protocol/codec work, left to
  ECS-40 once a composition model exists.
- **`handshake`** — `DeviceHandshake`: `{ required, steps }`, where each
  `HandshakeStep` is `{ id, description, direction }` and `direction` is
  `"send" | "expect"`. Each step is a documented fact about what the
  device expects at connection time (a mode-switch SysEx, an identity
  reply), not a runtime instruction — nothing here sends or waits for
  anything. Actually performing a handshake is application behavior built
  on top of a profile, the same boundary this schema draws everywhere
  else.

`schemaVersion` (currently `DEVICE_PROFILE_SCHEMA_VERSION = "1.0"`) is this
document shape's own version, not the device's firmware version. Profiles
are meant to be produced by a separate offline tool (a MIDI profiler) and
consumed here — keeping the producer and consumer able to evolve
independently and detect a mismatch is the whole reason this field exists.

## What's deliberately not here

- **No concrete profiles** — no Launchpad/APC/Push (or any other device)
  profile. Explicitly out of scope per the ticket; this is schema only.
- **No validation or diagnostics** — e.g. that every `GridCell.controlId`
  resolves to a declared control, that every `PhysicalControl.portId`
  resolves to a declared port, or that a grid's declared `rows`/`columns`
  match its `cells`. TypeScript's structural typing catches shape
  mistakes; it can't catch a dangling reference. That's ECS-42's job
  ("profile validation and diagnostics... depends on schema and
  composition model"), not this one's.
- **No protocol/composition model** — nothing here lets a profile extend
  or compose with a reusable protocol family (MCU, MIDI Clock/transport,
  MMC, a vendor protocol). That's ECS-40, which depends on this schema
  existing first.
- **No evidence/provenance model** — no field for where a profile's facts
  came from (a manufacturer's implementation chart, a captured-traffic
  session, a manual). Per `docs/architecture.md`'s design principles,
  research inputs are kept separate from runtime behavior; that offline
  evidence model is ECS-43's scope, not a field bolted onto the runtime
  schema here.
- **No loading, (de)serialization, or storage** — this ticket defines
  TypeScript types a JSON document can satisfy; it does not define how
  such a document is read, written, or cached. A future profiler or
  consumer can serialize a `DeviceProfile` directly, since every field is
  a plain, JSON-compatible value (no functions, no class instances).
- **No SysEx byte templates or handshake execution** — see `sysex` and
  `handshake` above; both describe, they don't implement.
- **No mapping generation** — nothing here turns a profile's
  `PhysicalControl`s into `ControlMapping`s (`docs/contracts/mapping.md`).
  That would be a later tool bridging this schema and the mapping layer,
  not part of either contract.
