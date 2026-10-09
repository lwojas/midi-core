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
connection setup. Per the ticket and `docs/architecture.md`'s Device
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
type. `ControlAddress.channel`, when present, is always a concrete `Channel`,
the same choice `mapping.md` makes for `MidiTarget`: a profile describes
one real device's actual wiring, not a channel-agnostic rule. It's
optional (ECS-62) only to let a profile record a partially resolved fact
— evidence sometimes documents a control's address without ever stating
which channel it's reported/driven on — never as a `mapping`-style "any
channel."

## Shape

```ts
interface DeviceProfile {
  readonly schemaVersion: string;
  readonly identity: DeviceIdentity;
  readonly ports: readonly DevicePortProfile[];
  readonly controls: readonly PhysicalControl[]; // { id, label, kind, portId, feedbackPortId?, input?, feedback?, valueMode? }
  readonly grids?: readonly ControlGrid[];
  readonly sysex?: DeviceSysExProfile;
  readonly setup?: DeviceSetup;
  readonly layout?: DeviceLayout;
  readonly displays?: readonly DeviceDisplayDefinition[]; // ECS-137
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
- **`controls`** — `PhysicalControl`: `{ id, label, kind, portId,
  feedbackPortId?, input?, feedback?, valueMode? }`. `kind` is one of
  `"button" | "pad" | "knob" | "encoder" | "fader" | "wheel"` —
  deliberately no `"key"`; keybed controllers are a different domain this
  schema doesn't target. `input`/`feedback` are both optional and
  independent (a button is usually input-only; a pure indicator LED could
  be feedback-only; a pad with its own LED is both). `valueMode`
  (`"absolute" | "relative"`, omitted meaning absolute) describes a real,
  common encoder behavior — each turn sending an increment/decrement
  rather than a position — purely as a fact about the device's wire
  behavior; interpreting a relative value is a mapping-layer concern, not
  this schema's.
  - **`relativeEncoding` (ECS-137)** — required whenever `valueMode` is
    `"relative"` and `input` is set: names *which* relative scheme the
    control actually uses, since a relative control's raw byte is
    meaningless to decode without it. Currently only
    `"twos-complement-7bit"` is modeled (the Ableton Push mk1's encoders,
    hardware-confirmed at the ECS-136 gate). A separate type from
    `src/mapping/types/address.ts`'s own `RelativeEncoding` of the same
    name, for the same "only dependency pointed at Core" reason given
    below for `ControlSurfaceAddress`/`MidiAddress` — `src/surface/
    generate.ts` translates one into the other.
  - **`portId`/`feedbackPortId` convention (ECS-62)** — ports are split by
    direction (`DevicePortProfile`/`PortType`), so one physical
    bidirectional control can span two port entries even though it's one
    physical interface. By convention, `portId` always names the
    control's *input*-direction port. `feedbackPortId` optionally names
    `feedback`'s own port, when it's worth stating explicitly and differs
    from `portId`; omit it when the control has no `feedback`, or when
    which port backs it hasn't been pinned down by evidence.
  - **`ControlAddress.channel` is optional (ECS-62)** — see "Why not reuse
    `mapping`'s `MidiAddress`" above. Omitted means the control's address
    (a note or CC number) is documented but which channel it's reported on
    isn't — a partially resolved fact, recorded alongside the rest of
    `unresolved`, not an all-or-nothing choice between inventing a channel
    or dropping the whole `input`/`feedback` object.
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
- **`setup`** — `DeviceSetup`: `{ inputPortId, outputPortId, timeoutMs?, steps }`. Each step is
  `{ id, description, send?, expect? }`, where `send` is bytes to transmit and
  `expect` is a reply pattern (`null` matches any byte). Declared setup is run
  by the surface on connect; see [device-setup.md](./device-setup.md). Replaces
  the earlier `DeviceHandshake`, which described steps without bytes.
- **`modes`** — `DeviceModeProfile[]` (ECS-96), optional. A mode that needs its own
  messages and ports on top of the main surface. Each has `id`, `description`,
  `sendPortId` (the output its messages go to), `requiredPortIds` (the mode exists only
  when all of them are present on the device), `activate` (SysEx sent before the fader
  bank), `showLayout` (SysEx sent after the bank), `deactivate` (SysEx to leave), and
  `faders` (`inputPortId`/`inputChannel` for fader moves, `feedbackPortId`/`feedbackChannel`
  for fader colour, and `banks`). Each bank has `id`, `bipolar`, `colour` (1-127),
  `controllers` (one fixed CC per fader, 1 to 8), `modeId` (the fader mode that shows it,
  unique across the profile) and `controlIds` (each fader's control, one per fader, unique
  across the profile). The CCs are in the profile so it can name the fader controls; the
  sequencer sends the bank to make them live. The bank message is
  `bankPrefix` (from F0), then one entry per fader in the order `bankEntry` lists (each of
  `index`, `type`, `controller`, `colour` once), then F7. `bankTypes` gives the `type` byte
  for unipolar and bipolar banks. Optional: `modeButtons` (read on the mode's own ports) and
  `pageButtons` (the page arrows, as actions for the application). `resendBankOnPageTurn`
  (required) is true when the device forgets its fader setup on a page turn, so the sequencer
  resends the bank before the application moves its tracks.
  A fader port must be listed in `requiredPortIds`. A device without the ports has the
  mode unavailable, not an invalid profile.
- **`layout`** — `DeviceLayout` (ECS-90): which controls play which
  sequencer roles, as the profile's default. `modeButtons` is an ordered list of
  `{ controlId, mode }`; `pageUp`/`pageDown`, `pageLeft`/`pageRight` and `transport`
  (`{ play?, stop?, record?, clear? }`) are control ids. Every id names a
  `PhysicalControl` on this profile. The step grid is not named here: it is the
  grid with `paging`. Rows are tracks, so up and down page tracks, and the mixer
  mutes one track per row from the grid's first column (ECS-95). A profile with no layout
  is valid; the sequencer configuration reports that and builds what it can.
  The layout is a usage default, not a fact about the hardware, so an app may
  override it, but overrides belong outside the profile document: a profile is
  generated offline, and regenerating it would discard them. `modifier` (ECS-137)
  optionally names the control id of a shift-style button: a `ModeBinding.when`
  (`docs/contracts/surface-bindings.md`) is only satisfied while this button is
  held/released. Omitted, no binding's `when` on this profile is ever satisfied.
- **`displays`** — `DeviceDisplayDefinition[]` (ECS-137), optional. A text
  display's declarative SysEx template, the same "describe the byte
  layout, don't invent a second codec" move `modes`' `bankPrefix`/
  `bankEntry` already makes for a fader bank message: `portId` (an output
  port), `lines` (`{ id, label, lineId }[]`, each line's own byte within
  the template), `prefix` (bytes before the line id byte, from F0),
  `textPrefix` (fixed bytes between the line id and the text) and
  `charCount` (the fixed-width ASCII payload). Deliberately not a
  `PhysicalControl`: a display has nothing to press, so it has no input
  address — only a `DisplayBinding` (`docs/contracts/surface-bindings.md`)
  ever drives it, from a new `StringControlDef` application control.
  `src/surface/display-binding.ts`'s `buildDisplayMessage()` is the one
  place that turns a display's template plus a line plus a string into
  actual bytes; nothing upstream of it ever sees an ASCII byte.

## Overrides, standalone (ECS-137)

`DeviceOverrides` (`src/profile/types/overrides.ts`) is the "editable
mapping-data" document `layout`'s own disclaimer above points to:
`{ schemaVersion, profileId, profileSchemaVersion, layoutOverrides?,
bindingOverrides? }`, deliberately **not** part of `DeviceProfile` —
exactly because this document already says a profile is generated
offline and regenerating it would discard anything stored inside it.
`validateDeviceOverrides(profile, overrides)`
(`docs/contracts/profile-validation.md`) checks only that the document is
well-formed and that `profileId`/`profileSchemaVersion` actually match
the supplied profile, flagging staleness rather than silently applying
overrides authored against a profile that's since changed.
`layoutOverrides`/`bindingOverrides` are left untyped (`unknown`) here:
defining what's actually safe to override is ECS-142's job, once a
validated schema exists — not invented speculatively ahead of it.

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
- **No SysEx byte templates beyond setup, modes and displays** — `sysex` itself still only describes, never implements; byte templates that do exist (`setup`'s steps, `modes`' fader-bank fields, `displays`' line template, ECS-137) each carry their own bytes rather than reusing `sysex` for them. See `device-setup.md`.
- **No mapping generation** — nothing here turns a profile's
  `PhysicalControl`s into `ControlMapping`s (`docs/contracts/mapping.md`).
  That would be a later tool bridging this schema and the mapping layer,
  not part of either contract.
