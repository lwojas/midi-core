# MIDI Core — Bidirectional Device Communication

Status: Draft
Linear: [ECS-31](https://linear.app/ecs3d/issue/ECS-31/implement-bidirectional-device-communication)
Depends on: [ECS-29](https://linear.app/ecs3d/issue/ECS-29/implement-midi-input) ([docs/contracts/input.md](./input.md)), [ECS-30](https://linear.app/ecs3d/issue/ECS-30/implement-midi-output) ([docs/contracts/output.md](./output.md))
Source of truth: [`src/adapters/web-midi/`](../../src/adapters/web-midi/), [`demo/`](../../demo/)

## What this proves

ECS-29/30 built `RawMidiInput`/`RawMidiOutput`/`createMidiInput`/`createMidiOutput`
but deliberately deferred a real transport, since the Web MIDI API needs a
browser and our toolchain is Node/Vitest. This ticket is the first thing in
the repo that actually needs a browser: it implements a Web MIDI adapter
against those contracts and a small demo page to prove the full path —
Device → Core → Client and Client → Core → Device — against real hardware
(a Launchpad Mini), with observable connection state.

## The adapter (`src/adapters/web-midi/`)

Four pieces, each implementing an existing Core contract against the real
`navigator.requestMIDIAccess()` API — no new contracts introduced:

- **`WebMidiPortBase`** — shared `MidiConnection` lifecycle for both
  directions. `connect()`/`disconnect()` delegate straight to
  `MIDIPort.open()`/`close()` and let rejection propagate as normal Promise
  semantics. Hardware-driven state changes (the port's own `onstatechange` —
  e.g. a physical unplug) are mapped via `derivePortState()` and forwarded
  through `onStateChange` directly; they are **not** validated against
  Core's `isValidTransition` table, since real hardware doesn't necessarily
  respect it.
- **`derivePortState()`** (`port-info.ts`) — maps Web MIDI's two-axis state
  (`state`: connected/disconnected = physical presence; `connection`:
  closed/pending/open = whether we've opened it) onto Core's single
  `ConnectionState`. Physical presence wins: a disconnected port is
  `disconnected` regardless of its last `connection` value.
- **`WebMidiInputTransport`** / **`WebMidiOutputTransport`** — implement
  `RawMidiInput`/`RawMidiOutput`. Input forwards `onmidimessage` bytes
  directly (Web MIDI already delivers one complete message per event, which
  is exactly what `decodeMidiMessage` expects). Output's `sendRaw` converts
  `Uint8Array` to `number[]` (what `MIDIOutput.send()` actually takes) and
  catches any throw, reporting it through `onError` with code `send-failed`
  — per the ECS-30 decision, `sendRaw` never throws.
- **`WebMidiDiscovery`** — Per spec, a disconnected port's entry stays in
  `MIDIAccess.inputs`/`outputs` (state flipped to `disconnected`) rather
  than being removed, so a reconnect can reuse the same port id. Discovery
  tracks presence explicitly (a `known` id set) instead of map membership,
  and both `listPorts()` and the `added`/`removed` events filter to
  currently-present ports — "removed" means gone from discovery, not merely
  disconnected-but-still-listed.
- **`createWebMidiAccess(access)`** / **`requestWebMidiAccess(options)`** —
  split so the wiring (discovery, port lookup and caching by id) can be unit
  tested against a fake `MIDIAccess`, while `requestWebMidiAccess` is the
  thin, real entry point that only a browser can exercise.

TypeScript's bundled `lib.dom.d.ts` already includes full Web MIDI types
(`MIDIAccess`, `MIDIPort`, etc.), so `tsconfig.json` just needed `"DOM"`
added to `lib` — no `@types` package required.

## What's tested automatically vs. what needs your hardware

13 new tests (74 total) exercise the adapter's logic — state derivation,
discovery add/remove, message decoding/forwarding, send-failure handling,
port lookup/caching — against fakes of `MIDIAccess`/`MIDIInput`/`MIDIOutput`
(built by extending Node's global `EventTarget`, which satisfies
`MIDIPort`'s structural type for free). That proves the adapter's own logic
is correct, but it **cannot** prove the actual round trip against real
hardware — Node has no `navigator.requestMIDIAccess`.

That's what `demo/` is for: a plain HTML page (`demo/index.html` +
`demo/main.js`, native ES modules importing straight from the built
`dist/`, no bundler) and a zero-dependency static server
(`demo/serve.mjs`, `npm run demo`) to serve it over `localhost` (Web MIDI
needs a secure context; `localhost` qualifies without HTTPS). It requests
MIDI access, lists discovered ports, connects a chosen input+output,
logs every incoming message, and has buttons to send Note On / Note Off /
CC — enough to prove both directions plus observable state, without any
Launchpad-specific code. A plain Note On happening to light a Launchpad pad
is the device's own stock behavior, not something Core encodes.

## No Launchpad feedback

Nothing here knows the Launchpad's LED/SysEx feedback protocol, its pad
grid, or its layout. The demo's "light a pad" button sends a generic Note
On — the same message it would send to any device that lights pads that
way. If lighting behavior ever needs to be driven deliberately, that's a
device profile's job (future ECS-39 work), not Core's or this adapter's.

## What's deliberately not here

- No device-specific profiles or feedback protocols.
- No reconnection/retry policy beyond what `connect()`/`disconnect()` do.
- No UI polish on the demo page — it exists to prove the contract works
  against real hardware, not as a product surface.
