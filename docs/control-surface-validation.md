# Minimal Surface Validation Against a Generic Mock Device

Source of truth: [src/surface/validate-minimal-surface.test.ts](../src/surface/validate-minimal-surface.test.ts)

## Demonstrated behavior

One `ControlSurface`, one `DeviceProfile`, and one `SurfaceBindingTable` cover Mixer, Transport, and Step Grid modes in a single attach-to-detach lifecycle:

- Each of the mock device's eight knobs independently updates its corresponding track-volume `Control`.
- Three buttons trigger play, stop, and record actions, which update transport status.
- Eight pads independently update step controls. Application-driven step changes and playhead events produce pad feedback.
- Mode changes reuse the same profile while changing which control or action each physical control resolves to. Bindings inactive in the selected mode do not respond.
- Input and feedback directions work within the same session.
- `detach()` disconnects the mock input and removes active bindings; subsequent harness input does not reach controls.

## Boundaries confirmed

The mock sequencer imports only the Control API. MIDI messages, physical controls, ports, channels, and note/CC addresses stay outside application logic. The mock device profile contains no application `ControlId` or `Action` references.

Incoming values are not echoed straight back to the device. A pad press updates its step control, while hardware feedback is driven by application state changes or events such as the playhead. Action triggers and event feedback are installed and removed with the active mode through its lifecycle hooks.

## Validation limits

This test exercises the surface runtime and mock device, not a real sequencer or hardware. It demonstrates one playhead event; chase-light sequencing, pattern length, and loop wraparound are outside this validation.
