import { describe, expect, it } from "vitest";
import { createMockDevice, MockMidiDiscovery } from "../adapters/mock/index.js";
import { createMidiInput, createMidiOutput } from "./index.js";
import type { ConnectionState, MidiMessage, MidiTransportError } from "./index.js";

/**
 * Integration coverage for the public API described in the project
 * README: discovery, connect/disconnect + state, and incoming/outgoing
 * Note/CC messages, exercised end to end against the generic mock device
 * (ECS-32) rather than a one-off fake. Unlike
 * src/adapters/mock/mock-device.test.ts (which tests the mock itself),
 * this only imports from the public entry points a real consumer would
 * use -- ./index.js and ../adapters/mock/index.js -- to prove the
 * documented usage actually works.
 */
describe("MIDI Core public API (via the mock device)", () => {
  it("discovers a device's ports and reacts to them appearing/disappearing", () => {
    const discovery = new MockMidiDiscovery();
    const changes: string[] = [];
    discovery.onChange((change) => changes.push(`${change.type}:${change.port.type}`));

    const device = createMockDevice({ id: "controller", name: "Test Controller", discovery });

    expect(discovery.listPorts()).toEqual([device.input.port, device.output.port]);
    expect(changes).toEqual(["added:input", "added:output"]);

    discovery.removePort(device.input.port.id);
    expect(discovery.listPorts()).toEqual([device.output.port]);
  });

  it("connects and disconnects an input and output, observing state through the documented lifecycle", async () => {
    const device = createMockDevice();
    const input = createMidiInput(device.input);
    const output = createMidiOutput(device.output);

    const inputStates: ConnectionState[] = [];
    const outputStates: ConnectionState[] = [];
    input.onStateChange((state) => inputStates.push(state));
    output.onStateChange((state) => outputStates.push(state));

    expect(input.state).toBe("available");
    expect(output.state).toBe("available");

    await Promise.all([input.connect(), output.connect()]);
    expect(input.state).toBe("connected");
    expect(output.state).toBe("connected");
    expect(inputStates).toEqual(["connecting", "connected"]);
    expect(outputStates).toEqual(["connecting", "connected"]);

    await Promise.all([input.disconnect(), output.disconnect()]);
    expect(input.state).toBe("disconnected");
    expect(output.state).toBe("disconnected");
  });

  it("surfaces transport errors via onError without throwing", () => {
    const device = createMockDevice();
    const output = createMidiOutput(device.output);
    const errors: MidiTransportError[] = [];
    output.onError((error) => errors.push(error));

    device.output.simulateSendFailures(true);
    output.send({ type: "note-on", channel: 0, note: 60, velocity: 100 });

    expect(errors).toEqual([{ code: "send-failed", message: "Simulated send failure", portId: device.output.port.id }]);
    expect(device.output.sentMessages).toHaveLength(0);
  });

  it("receives incoming Note On/Off and Control Change as normalized messages", async () => {
    const device = createMockDevice();
    const input = createMidiInput(device.input);
    await input.connect();

    const received: MidiMessage[] = [];
    input.onMessage((message) => received.push(message));

    device.input.emitRawMessage(Uint8Array.of(0x90, 60, 100)); // Note On, ch 0
    device.input.emitRawMessage(Uint8Array.of(0x80, 60, 0)); // Note Off, ch 0
    device.input.emitRawMessage(Uint8Array.of(0xb5, 74, 20)); // CC, ch 5

    expect(received).toEqual([
      { type: "note-on", channel: 0, note: 60, velocity: 100, raw: Uint8Array.of(0x90, 60, 100) },
      { type: "note-off", channel: 0, note: 60, velocity: 0, raw: Uint8Array.of(0x80, 60, 0) },
      { type: "control-change", channel: 5, controller: 74, value: 20, raw: Uint8Array.of(0xb5, 74, 20) },
    ]);
  });

  it("sends outgoing Note On/Off and Control Change as the correct wire bytes", async () => {
    const device = createMockDevice();
    const output = createMidiOutput(device.output);
    await output.connect();

    output.send({ type: "note-on", channel: 1, note: 64, velocity: 127 });
    output.send({ type: "note-off", channel: 1, note: 64, velocity: 0 });
    output.send({ type: "control-change", channel: 1, controller: 1, value: 80 });

    expect(device.output.sentMessages.map((bytes) => Array.from(bytes))).toEqual([
      [0x91, 64, 127],
      [0x81, 64, 0],
      [0xb1, 1, 80],
    ]);
  });

  it("proves both directions on one device: a sent message can be looped back and received", async () => {
    const device = createMockDevice({ id: "loopback" });
    const input = createMidiInput(device.input);
    const output = createMidiOutput(device.output);
    await Promise.all([input.connect(), output.connect()]);

    const received: MidiMessage[] = [];
    input.onMessage((message) => received.push(message));

    // No device-specific echo behavior in Core -- wiring output back to
    // input here simulates a device that reflects what it's sent.
    device.output.sendRaw = ((original) => (bytes: Uint8Array) => {
      original(bytes);
      device.input.emitRawMessage(bytes);
    })(device.output.sendRaw.bind(device.output));

    output.send({ type: "note-on", channel: 0, note: 72, velocity: 90 });

    expect(received).toEqual([{ type: "note-on", channel: 0, note: 72, velocity: 90, raw: Uint8Array.of(0x90, 72, 90) }]);
  });
});
