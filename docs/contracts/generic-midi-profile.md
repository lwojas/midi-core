# Generic MIDI Device Profile

Status: Draft
Linear: [ECS-41](https://linear.app/ecs3d/issue/ECS-41/define-generic-midi-device-profile)
Depends on: [docs/contracts/device-profile.md](./device-profile.md) (ECS-39), [docs/contracts/protocol-composition.md](./protocol-composition.md) (ECS-40)
Source of truth: [`src/profile/generic/`](../../src/profile/generic)

## Scope

`docs/contracts/device-profile.md` and `protocol-composition.md` defined
the schema and the composition mechanism but shipped no actual profile —
everything proven against them so far was a fictional test fixture. This
ticket defines the first real, concrete artifact: `GENERIC_MIDI_PROTOCOL`
(a `ProtocolFamily`) and `GENERIC_MIDI_DEVICE_PROFILE` (a composed
`DeviceProfile`) describing nothing more than "a compliant MIDI device,"
with no manufacturer assumptions and no `ControlMapping`s — the Control
API and mapping layer are a separate concern a profile never reaches into.

This is also the first real proof that `composeDeviceProfile()` (ECS-40)
holds up end to end, not just against a fictional fixture: this profile
*is* that function's output.

## `GENERIC_MIDI_PROTOCOL`

```ts
const GENERIC_MIDI_CHANNEL_VOICE_MESSAGE_TYPES: readonly MidiMessageType[] = [
  "note-on", "note-off", "control-change", "program-change",
  "channel-pressure", "poly-pressure", "pitch-bend",
];

const GENERIC_MIDI_PROTOCOL: ProtocolFamily = {
  id: "generic-midi",
  name: "Generic MIDI",
  messageTypes: GENERIC_MIDI_CHANNEL_VOICE_MESSAGE_TYPES,
};
```

Every channel voice message MIDI 1.0 defines for any compliant device,
and nothing else. No `controls`: unlike MCU or a vendor protocol, generic
MIDI has no standard control layout to template — a CC or note number
means whatever a specific device's documentation says it means, which is
exactly the information a profile without manufacturer assumptions
doesn't have. This is the `messageTypes`-only case
`protocol-composition.md` already designed `ProtocolFamily` for.

Real-time transport (`clock`/`start`/`continue`/`stop`) and `sysex` are
deliberately **not** included — not every device uses clock sync, and
SysEx is inherently vendor-specific, so neither is safe to assume for
every device. A concrete profile that needs either composes its own
binding for them (e.g. a `midi-clock-transport` protocol, named as an
example in `protocol-composition.md`) alongside `GENERIC_MIDI_PROTOCOL`,
rather than this baseline assuming it universally.

## `GENERIC_MIDI_DEVICE_PROFILE`

```ts
const GENERIC_MIDI_DEVICE_PROFILE: DeviceProfile = composeDeviceProfile({
  identity: { id: "generic.midi-device", manufacturer: "Generic", model: "Generic MIDI Device" },
  ports: [
    { id: "main-in", type: "input", role: "main", required: true, messageTypes: [] },
    { id: "main-out", type: "output", role: "main", required: true, messageTypes: [] },
  ],
  protocols: new Map([[GENERIC_MIDI_PROTOCOL.id, GENERIC_MIDI_PROTOCOL]]),
  protocolBindings: [
    { id: "generic-in", protocolId: GENERIC_MIDI_PROTOCOL.id, portId: "main-in" },
    { id: "generic-out", protocolId: GENERIC_MIDI_PROTOCOL.id, portId: "main-out" },
  ],
});
```

- **`identity`** — `manufacturer: "Generic"`, `model: "Generic MIDI
  Device"`: a label for what this is, not a real vendor. Nothing about
  this profile should be read as describing an actual product.
- **`ports`** — one full-duplex pair, the most conservative generic
  shape (assume a device can both send and receive) rather than any
  vendor-specific port layout (e.g. a separate DAW-control port). Each
  port's baseline `messageTypes` is empty; composition fills both in from
  `GENERIC_MIDI_PROTOCOL`.
- **`controls`** — empty. No physical controls are modeled, because none
  can be assumed without knowing the actual device.
- **`grids`/`sysex`/`handshake`** — all absent, for the same reason.

## Using this as a baseline

Per the ticket, this exists to be used "before real device profiles" —
two ways:

1. **As a placeholder.** A connected device with no authored profile yet
   can be treated as `GENERIC_MIDI_DEVICE_PROFILE`: still enough to carry
   normalized channel-voice messages through Core, with no fabricated
   controls pretending to know the hardware.
2. **As a starting point.** A real device profile that *is* a fairly
   ordinary MIDI device, plus a few of its own controls, can bind
   `GENERIC_MIDI_PROTOCOL` the same way this profile does and add its own
   `extensions` for whatever's actually documented — rather than
   redeclaring the full channel-voice `messageTypes` list from scratch
   for every device. ECS-47 ("create first real device profile as
   profiler validation exercise") is the first case that will actually do
   this.

## What's deliberately not here

- **No manufacturer-specific anything** — no real vendor name, no vendor
  SysEx, no documented control layout. That starts with ECS-47.
- **No `ControlMapping`s** — a profile, generic or not, never references
  a `ControlId` or the Application Control API; assigning MIDI meaning to
  an application control is the mapping layer's job
  (`docs/contracts/mapping.md`), strictly above the profile layer.
- **No real-time transport or SysEx assumptions** — see above; these are
  additive, not part of the generic baseline.
- **No validation** — same standing exclusion as `device-profile.md` and
  `protocol-composition.md`; this profile is correct by construction
  (built from `composeDeviceProfile()`, type-checked), but nothing here
  validates a profile built by hand. Still ECS-42.
