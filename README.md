# MIDI Core

A small, reusable contract between MIDI hardware and the clients that use it.
It is a control surface, not part of a sequencer: it discovers ports,
manages connection lifecycle, and carries MIDI messages in both directions
in a normalized, transport-independent shape. Everything device-specific
(profiles, control mapping, LED feedback) belongs in layers built on top of
Core, not in Core itself. See [`docs/architecture.md`](docs/architecture.md)
for the full boundary definition.

## What Core owns

- **Discovery** — enumerate ports and observe them appearing/disappearing.
- **Identity** — a port's id, type, name and manufacturer.
- **Lifecycle** — a device-agnostic connection state machine
  (`available → connecting → connected → disconnecting → disconnected`,
  plus `error`), the same for every transport.
- **Messages** — Note On/Off, Control Change, Pitch Bend, Program Change,
  aftertouch, real-time transport sync, and opaque SysEx, normalized to and
  from raw MIDI bytes.
- **Input/Output** — sending and receiving those messages on a connected
  port.
- **Transport errors** — permission/connection/send failures in one shape.

Full contracts, with the reasoning behind each design decision, live under
[`docs/contracts/`](docs/contracts).

## Public API

The public surface is [`src/core/index.ts`](src/core/index.ts). Within this
repo, import it directly; once built (`npm run build`), the same exports
are available from `dist/core/index.js` (see `demo/main.js` for a working
example against a real Web MIDI port).

### Discovery

```ts
import type { MidiDiscovery } from "./src/core/index.js";

function listInputs(discovery: MidiDiscovery) {
  return discovery.listPorts().filter((port) => port.type === "input");
}

discovery.onChange((change) => {
  console.log(change.type, change.port.name); // "added" | "removed"
});
```

`MidiDiscovery` only answers "what ports exist and when does that change" —
listing a port implies nothing about whether it's connected. A concrete
`MidiDiscovery` comes from a transport adapter, e.g.
[`requestWebMidiAccess()`](src/adapters/web-midi/index.ts) or a
[`MockMidiDiscovery`](src/adapters/mock/index.ts) for tests.

### Connecting and lifecycle state

`createMidiInput()`/`createMidiOutput()` wrap a transport's raw port into
the consumer-facing `MidiInput`/`MidiOutput`, both of which extend
`MidiConnection`:

```ts
import { createMidiInput, createMidiOutput } from "./src/core/index.js";

const input = createMidiInput(rawInput); // rawInput: RawMidiInput from a transport
const output = createMidiOutput(rawOutput);

input.onStateChange((state, previous) => console.log(previous, "->", state));
input.onError((error) => console.error(error.code, error.message));

await input.connect(); // available -> connecting -> connected
await input.disconnect(); // connected -> disconnecting -> disconnected
```

`state` always reflects the transport's current value. Valid transitions
are defined once, centrally, by `isValidTransition()` — see
[`docs/contracts/discovery-lifecycle.md`](docs/contracts/discovery-lifecycle.md).

### Receiving messages

```ts
input.onMessage((message) => {
  if (message.type === "note-on") {
    console.log(message.channel, message.note, message.velocity);
  }
});
```

`message` is a normalized `MidiMessage` (see
[`docs/contracts/message-model.md`](docs/contracts/message-model.md)) —
decoding never throws; anything Core doesn't model comes through as
`{ type: "unknown", raw }`.

### Sending messages

```ts
output.send({ type: "note-on", channel: 0, note: 60, velocity: 100 });
output.send({ type: "control-change", channel: 0, controller: 7, value: 100 });
```

`send()` throws `MidiEncodeError` synchronously for out-of-range fields
(the caller's own mistake); transport-level send failures surface later
through `onError`, not as a thrown exception — see
[`docs/contracts/output.md`](docs/contracts/output.md).

## Testing without hardware: the mock device

[`src/adapters/mock/`](src/adapters/mock) implements the same contracts
(`RawMidiInput`, `RawMidiOutput`, `MidiDiscovery`) with no real hardware
behind them, so anything built on Core can be tested without a MIDI
device or a browser:

```ts
import { createMidiInput, createMidiOutput } from "./src/core/index.js";
import { createMockDevice, MockMidiDiscovery } from "./src/adapters/mock/index.js";

const discovery = new MockMidiDiscovery();
const device = createMockDevice({ name: "Test Controller", discovery });

const input = createMidiInput(device.input);
const output = createMidiOutput(device.output);

await input.connect();
await output.connect();

input.onMessage((message) => console.log("received:", message));
device.input.emitRawMessage(Uint8Array.of(0x90, 60, 100)); // simulate an incoming Note On

output.send({ type: "control-change", channel: 0, controller: 1, value: 42 });
console.log(device.output.sentMessages); // bytes actually sent
```

`createMockDevice()` returns a paired input+output port, matching how a
real physical controller shows up to Core as two separate ports. See
[`docs/contracts/mock-device.md`](docs/contracts/mock-device.md) for the
full mock API, including lifecycle/error simulation
(`simulateError`, `simulateDisconnect`, `simulateSendFailures`).
[`src/core/index.test.ts`](src/core/index.test.ts) exercises the full
public API — discovery, connect/disconnect, state, and incoming/outgoing
Note and CC messages — end to end against the mock.

## Beyond MIDI Core: the Application Control API

[`src/control-api/`](src/control-api) defines a separate, independent
contract for reading, setting and observing abstract application
controls/state (track volume, filter cutoff, transport status, ...) —
deliberately with no dependency on `src/core/` or `src/adapters/`. It sits
above the Device/Profile/Mapping layer in the architecture (see
[`docs/architecture.md`](docs/architecture.md)): MIDI, UI and automation
are all just things that might call a control's `setValue()`, not
something this contract knows about. See
[`docs/contracts/control-api.md`](docs/contracts/control-api.md) for the
full shape and the reasoning behind it.

## Bridging the two: MIDI ↔ Control mapping

[`src/mapping/`](src/mapping) defines the bidirectional translation
between a `MidiMessage` and a `Control` — what MIDI event drives a control
(`MidiSource`), what control it drives (`ControlMapping.control`), and how
a message's native value range (`0-127` for a CC, `0-16383` for pitch
bend) maps onto a control's declared range (`resolveIncomingValue()`,
`buildFeedbackMessage()` for the reverse direction):

```ts
import { bindControlMapping, type ControlMapping } from "./src/mapping/index.js";

const mapping: ControlMapping = {
  id: "cc74-filter-cutoff",
  control: "fx.filter.cutoff",
  source: { address: { type: "control-change", controller: 74 }, channel: "any" },
  feedback: { address: { type: "control-change", controller: 74 }, channel: 0 }, // optional
};

// Turning the knob calls cutoffControl.setValue(); cutoffControl changing
// for any other reason (a UI, automation, ...) sends feedback back out
// `output` -- the echo back to the knob that just turned is suppressed.
bindControlMapping(mapping, input, output, cutoffControl);
```

This is the only layer allowed to depend on both Core and the Control API
(see [`docs/architecture.md`](docs/architecture.md)) — it's where MIDI
messages are assigned application meaning. See
[`docs/contracts/mapping.md`](docs/contracts/mapping.md) for the full
source/target/channel/value-range/feedback shape and what's deliberately
left as a future extension point (curves, conditions, device profiles), and
[`docs/contracts/mapping-runtime.md`](docs/contracts/mapping-runtime.md) for
`bindControlMapping()` itself — the runtime that wires the contract to a
live `MidiInput`/`MidiOutput`/`Control`.

## Describing a device: profiles

[`src/profile/`](src/profile) defines the schema for a **device profile** —
a plain, JSON-serializable description of one device model: its identity,
the ports it exposes, its physical controls (knobs, pads, faders,
encoders, wheels) and where each lives on the wire, how those controls are
laid out into grids, what output/LED or motorized feedback they support,
and what vendor SysEx or connection handshake it needs:

```ts
import type { DeviceProfile } from "./src/profile/index.js";

const profile: DeviceProfile = {
  schemaVersion: "1.0",
  identity: { id: "acme.example-grid", manufacturer: "Acme", model: "Example Grid" },
  ports: [
    { id: "main-in", type: "input", role: "main", required: true, messageTypes: ["note-on", "note-off"] },
    { id: "main-out", type: "output", role: "main", required: true, messageTypes: ["note-on", "note-off"] },
  ],
  controls: [
    {
      id: "pad-0-0",
      label: "Pad 1",
      kind: "pad",
      portId: "main-in",
      input: { address: { type: "note", note: 36 }, channel: 0 },
      feedback: { kind: "velocity-color-led", address: { address: { type: "note", note: 36 }, channel: 0 } },
    },
  ],
};
```

A profile describes the device, not application behavior: it has no
`ControlId`, no `ControlMapping`, and nothing wired to a live
`MidiInput`/`MidiOutput` — see
[`docs/contracts/device-profile.md`](docs/contracts/device-profile.md) for
the full shape and what's deliberately left to later tickets (validation,
protocol composition, concrete device profiles).

### Composing profiles from reusable protocols

Many controllers partly implement a reusable protocol (Mackie Control,
MIDI Clock/transport, MIDI Machine Control, a vendor protocol) rather than
having a fully bespoke control layout. [`src/profile/composition/`](src/profile/composition)
lets a profile's `controls`/`messageTypes` be composed from a
`ProtocolFamily` (a named, reusable control/message-type definition) bound
to one of the device's ports, plus whatever's actually device-specific:

```ts
import { composeDeviceProfile, type ProtocolFamily } from "./src/profile/index.js";

const faderBank: ProtocolFamily = {
  id: "example-fader-bank",
  name: "Example Fader Bank",
  controls: [
    { id: "fader-1", label: "Fader 1", kind: "fader", input: { address: { type: "control-change", controller: 7 }, channel: 0 } },
  ],
};

const profile = composeDeviceProfile({
  identity: { id: "acme.example-grid", manufacturer: "Acme", model: "Example Grid" },
  ports: [{ id: "main-in", type: "input", role: "main", required: true, messageTypes: [] }],
  protocols: new Map([[faderBank.id, faderBank]]),
  protocolBindings: [{ id: "strip", protocolId: faderBank.id, portId: "main-in" }],
  extensions: [/* device-specific controls not covered by any protocol */],
});
```

`composeDeviceProfile()` is built from smaller pure pieces
(`composeProtocolControls()`, `composeDeviceControls()`,
`composePortMessageTypes()`) a caller can use directly instead. No real
protocol (MCU, Clock, MMC, or otherwise) ships here — this is the
composition mechanism only; see
[`docs/contracts/protocol-composition.md`](docs/contracts/protocol-composition.md).

## Using this as a package

Consumers (e.g. [webseq](https://github.com/lwojas/webseq)) depend on this repo directly —
`"midi-core": "github:lwojas/midi-core"` — and import from its subpaths, each mapping to one
of the module boundaries above:

```ts
import { createMidiInput, createMidiOutput } from "midi-core";           // same as "midi-core/core"
import type { Control, ControlRegistry } from "midi-core/control-api";
import { bindControlMapping, type ControlMapping } from "midi-core/mapping";
import type { DeviceProfile } from "midi-core/profile";
import { requestWebMidiAccess } from "midi-core/adapters/web-midi";
import { createMockDevice } from "midi-core/adapters/mock";              // for tests
```

`npm install` on a git dependency runs this repo's own `prepare` script (`npm run build`),
so `dist/` — gitignored here, like any build output — is produced automatically on install
rather than committed. A consumer never needs to run `npm run build` in this repo itself.

## Development

```
npm install
npm test        # run the test suite (vitest)
npm run typecheck
npm run build    # emit dist/
npm run demo     # build, then serve demo/ for real Web MIDI hardware
```

## Where to look next

| Topic | Doc |
| --- | --- |
| Architecture and layer boundaries | [`docs/architecture.md`](docs/architecture.md) |
| Discovery, identity, lifecycle, errors | [`docs/contracts/discovery-lifecycle.md`](docs/contracts/discovery-lifecycle.md) |
| Normalized message model | [`docs/contracts/message-model.md`](docs/contracts/message-model.md) |
| Input implementation | [`docs/contracts/input.md`](docs/contracts/input.md) |
| Output implementation | [`docs/contracts/output.md`](docs/contracts/output.md) |
| Web MIDI adapter and demo | [`docs/contracts/bidirectional.md`](docs/contracts/bidirectional.md) |
| Mock/test device | [`docs/contracts/mock-device.md`](docs/contracts/mock-device.md) |
| Application Control API and control/value model (separate from Core) | [`docs/contracts/control-api.md`](docs/contracts/control-api.md) |
| MIDI ↔ Control mapping (bridges Core and the Control API) | [`docs/contracts/mapping.md`](docs/contracts/mapping.md) |
| MIDI ↔ Control mapping runtime (`bindControlMapping()`) | [`docs/contracts/mapping-runtime.md`](docs/contracts/mapping-runtime.md) |
| Device profile schema | [`docs/contracts/device-profile.md`](docs/contracts/device-profile.md) |
| Protocol/profile composition model | [`docs/contracts/protocol-composition.md`](docs/contracts/protocol-composition.md) |
