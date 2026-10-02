# Protocol/Profile Composition Model

Status: Draft
Linear: [ECS-40](https://linear.app/ecs3d/issue/ECS-40/define-protocolprofile-composition-model)
Depends on: [docs/contracts/device-profile.md](./device-profile.md) (ECS-39), [docs/architecture.md](../architecture.md) (ECS-26)
Source of truth: [`src/profile/composition/`](../../src/profile/composition)

## Scope

`docs/contracts/device-profile.md` defined `DeviceProfile` as a flat
document: one `controls` list, authored whole. That's fine for a one-off
device, but many real controllers partly or wholly implement a **reusable
protocol** — Mackie Control (MCU), MIDI Clock/transport, MIDI Machine
Control (MMC), or a vendor protocol shared across a product line — and
hand-authoring the same fader/encoder/transport-button layout into every
device that speaks MCU duplicates it per device. This ticket defines how
a profile's controls and message-level behavior can instead be **composed**
from reusable protocol definitions plus whatever's actually
device-specific, investigating the question the ticket asks without
implementing any protocol: no MCU, MMC, or Clock `ProtocolFamily` ships
here. The first one (a generic MIDI baseline) is ECS-41, built *against*
this model; a real vendor protocol is further out still.

Like `docs/contracts/device-profile.md`, this produces **only the
composition machinery** — types and pure functions. `DeviceProfile` itself
(the shape ECS-39 defined) is unchanged; composition is an additive way to
*produce* one, not a new target shape consumers need to know about.

## Shape

- **`ProtocolControlTemplate`** — `Omit<PhysicalControl, "portId">`. A
  protocol's control is identical to a device's own `PhysicalControl` in
  every respect except which port it ends up bound to — that's a
  per-device decision, not something the protocol itself can know, so
  it's deferred to the binding rather than modeled on the template.
- **`ProtocolFamily`** — `{ id, name, messageTypes?, controls? }`. Both
  content fields are optional and independent, because not every protocol
  has addressable controls: MCU would declare a fixed `controls` layout;
  MIDI Clock/transport is purely message-level
  (`messageTypes: ["clock", "start", "continue", "stop"]`, no controls at
  all — there's no CC/note number to address a clock tick); MMC is
  command-based over SysEx, so, per the same boundary
  `device-profile.md`'s `sysex` field already draws, it's represented as
  `messageTypes: ["sysex"]` with the exact command encoding left
  unmodeled, not as a new structured command type.
- **`ProtocolBinding`** — `{ id, protocolId, portId }`. Binds one protocol
  (resolved by id against a registry the caller supplies — nothing here
  owns one, the same "no single global registry assumed" stance
  `ControlRegistry`/`MidiDiscovery` already take) onto one of the device's
  ports. The binding's `id` prefixes every control id the protocol
  contributes (`${binding.id}.${template.id}`), so binding the same
  protocol twice on one device (rare, but not ruled out) doesn't collide.

## Composition functions

```ts
function composeProtocolControls(binding: ProtocolBinding, protocol: ProtocolFamily): readonly PhysicalControl[];

function composeDeviceControls(
  bindings: readonly ProtocolBinding[],
  protocols: ReadonlyMap<string, ProtocolFamily>,
  extensions: readonly PhysicalControl[],
): readonly PhysicalControl[];

function composePortMessageTypes(
  port: DevicePortProfile,
  bindings: readonly ProtocolBinding[],
  protocols: ReadonlyMap<string, ProtocolFamily>,
): readonly MidiMessageType[];

function composeDeviceProfile(args: {
  identity: DeviceIdentity;
  ports: readonly DevicePortProfile[];
  protocols: ReadonlyMap<string, ProtocolFamily>;
  protocolBindings: readonly ProtocolBinding[];
  extensions?: readonly PhysicalControl[];
  grids?: readonly ControlGrid[];
  sysex?: DeviceSysExProfile;
  handshake?: DeviceHandshake;
}): DeviceProfile;
```

`composeDeviceControls` concatenates every bound protocol's controls
(via `composeProtocolControls`) with `extensions` — the device's own
controls not covered by any protocol, named directly after the ticket's
own phrase ("reusable protocol families... with device extensions").
`composePortMessageTypes` unions a port's own declared `messageTypes`
with whatever message types are contributed by protocols bound to that
port, deduplicated — the mechanism that lets a purely message-level
protocol (Clock, MMC) matter at all, since it has no `controls` for
`composeDeviceControls` to pick up. `composeDeviceProfile` ties both
together into a complete `DeviceProfile`, built from nothing but the
smaller functions above.

A `ProtocolBinding` whose `protocolId` isn't present in `protocols`
contributes nothing — `composeProtocolControls` is simply never called for
it — rather than throwing. That's the same "not this function's concern"
choice `resolveIncomingValue`/`buildFeedbackMessage` make for input they
can't resolve (`docs/contracts/mapping.md`): a profile authored with a
typo'd or not-yet-registered protocol id shouldn't crash composition.
Catching that case as an actionable diagnostic is exactly what ECS-42
("profile validation and diagnostics... depends on schema and composition
model") exists to add next.

## What's deliberately not here

- **No concrete protocols** — no `ProtocolFamily` for MCU, MIDI
  Clock/transport, MMC, or any vendor protocol. ECS-41 defines the first
  one (a generic MIDI baseline, "without manufacturer assumptions"); a
  real vendor protocol is further out still. This ticket only has to prove
  the composition shape works, which `src/profile/composition/compose.test.ts`
  does with fictional protocol fixtures.
- **No protocol registry/storage** — `protocols` is a `ReadonlyMap` the
  caller supplies to every composition function; nothing here loads,
  caches, or discovers protocol definitions from anywhere.
- **No validation** — an unresolved `protocolId`, a `portId` that doesn't
  name a declared port, or two bindings whose composed control ids
  collide are all left unchecked here, for the same reason
  `device-profile.md` leaves dangling references unchecked: that's
  ECS-42's job, which depends on this model existing first.
- **No parameterized/templated control addresses** — a protocol's
  `ProtocolControlTemplate.input`/`feedback` addresses are fixed, exactly
  as the real protocols they'd model define them (e.g. MCU's channel-strip
  CCs are fixed by the spec, not configurable per device). Nothing here
  offers a per-binding address offset/transform; if a concrete future
  protocol needs one, that's a new, named extension point for whichever
  ticket adds that protocol, not speculative scaffolding here.
- **No SysEx command modeling** — MMC and vendor protocols are
  represented only via `messageTypes: ["sysex"]`; the actual command
  bytes are out of scope here exactly as they are in
  `device-profile.md`'s own `sysex` field.
