import { describe, expect, it } from "vitest";
import { createMidiInput } from "../../core/input/create-midi-input.js";
import { createMidiOutput } from "../../core/output/create-midi-output.js";
import type { ConnectionState } from "../../core/types/lifecycle.js";
import type { MidiTransportError } from "../../core/types/errors.js";
import { createMockDevice } from "./create-mock-device.js";
import { MockMidiDiscovery } from "./mock-discovery.js";
import { MockMidiInput } from "./mock-input.js";
import { MockMidiOutput } from "./mock-output.js";

const inputPort = (id = "mock-in-1") => new MockMidiInput({ id, type: "input" as const, name: "Mock In", manufacturer: null });
const outputPort = (id = "mock-out-1") => new MockMidiOutput({ id, type: "output" as const, name: "Mock Out", manufacturer: null });

describe("MockMidiDiscovery", () => {
  it("lists no ports until some are added", () => {
    const discovery = new MockMidiDiscovery();
    expect(discovery.listPorts()).toEqual([]);
  });

  it("emits an 'added' change and lists the port once added", () => {
    const discovery = new MockMidiDiscovery();
    const changes: string[] = [];
    discovery.onChange((change) => changes.push(`${change.type}:${change.port.id}`));

    const port = inputPort();
    discovery.addPort(port.port);

    expect(discovery.listPorts()).toEqual([port.port]);
    expect(changes).toEqual(["added:mock-in-1"]);
  });

  it("emits a 'removed' change and drops the port once removed", () => {
    const discovery = new MockMidiDiscovery();
    const port = inputPort();
    discovery.addPort(port.port);

    const changes: string[] = [];
    discovery.onChange((change) => changes.push(`${change.type}:${change.port.id}`));
    discovery.removePort(port.port.id);

    expect(discovery.listPorts()).toEqual([]);
    expect(changes).toEqual(["removed:mock-in-1"]);
  });

  it("is a no-op to add the same port id twice or remove an unknown port", () => {
    const discovery = new MockMidiDiscovery();
    const port = inputPort();
    const changes: string[] = [];
    discovery.onChange((change) => changes.push(change.type));

    discovery.addPort(port.port);
    discovery.addPort(port.port);
    discovery.removePort("nonexistent");

    expect(changes).toEqual(["added"]);
  });

  it("stops notifying a listener after it unsubscribes", () => {
    const discovery = new MockMidiDiscovery();
    const changes: string[] = [];
    const unsubscribe = discovery.onChange((change) => changes.push(change.type));

    unsubscribe();
    discovery.addPort(inputPort().port);

    expect(changes).toEqual([]);
  });
});

describe("createMockDevice", () => {
  it("creates a paired input and output port sharing name/manufacturer but distinct ids", () => {
    const device = createMockDevice({ id: "launchpad", name: "Launchpad Mini", manufacturer: "Novation" });

    expect(device.input.port).toEqual({ id: "launchpad-in", type: "input", name: "Launchpad Mini", manufacturer: "Novation" });
    expect(device.output.port).toEqual({ id: "launchpad-out", type: "output", name: "Launchpad Mini", manufacturer: "Novation" });
  });

  it("registers both ports with a given discovery", () => {
    const discovery = new MockMidiDiscovery();
    const device = createMockDevice({ id: "device-1", discovery });

    expect(discovery.listPorts()).toEqual([device.input.port, device.output.port]);
  });

  it("assigns distinct auto-generated ids across devices when none is given", () => {
    const a = createMockDevice();
    const b = createMockDevice();

    expect(a.input.port.id).not.toBe(b.input.port.id);
  });
});

describe("MockPort lifecycle", () => {
  it("starts 'available' and moves through connecting/connected on connect()", async () => {
    const port = inputPort();
    const seen: ConnectionState[] = [];
    port.onStateChange((state) => seen.push(state));

    expect(port.state).toBe("available");
    await port.connect();

    expect(seen).toEqual(["connecting", "connected"]);
    expect(port.state).toBe("connected");
  });

  it("moves through disconnecting/disconnected on disconnect()", async () => {
    const port = inputPort();
    await port.connect();

    const seen: ConnectionState[] = [];
    port.onStateChange((state) => seen.push(state));
    await port.disconnect();

    expect(seen).toEqual(["disconnecting", "disconnected"]);
    expect(port.state).toBe("disconnected");
  });

  it("is idempotent: connect() while already connected does not re-fire transitions", async () => {
    const port = inputPort();
    await port.connect();

    const seen: ConnectionState[] = [];
    port.onStateChange((state) => seen.push(state));
    await port.connect();

    expect(seen).toEqual([]);
    expect(port.state).toBe("connected");
  });

  it("rejects connect() from 'disconnected' -- the port must re-appear via simulateAvailable() first", async () => {
    const port = inputPort();
    await port.connect();
    await port.disconnect();

    await expect(port.connect()).rejects.toThrow(/Invalid MIDI connection state transition/);

    port.simulateAvailable();
    expect(port.state).toBe("available");
    await port.connect();
    expect(port.state).toBe("connected");
  });

  it("simulateError() moves to 'error' and rejects a subsequent connect() until reset", async () => {
    const port = inputPort();
    const errors: MidiTransportError[] = [];
    port.onError((error) => errors.push(error));

    const error: MidiTransportError = { code: "permission-denied", message: "denied", portId: port.port.id };
    port.simulateError(error);

    expect(port.state).toBe("error");
    expect(errors).toEqual([error]);
    await expect(port.connect()).rejects.toThrow(/Invalid MIDI connection state transition/);

    port.simulateAvailable();
    await port.connect();
    expect(port.state).toBe("connected");
  });

  it("simulateDisconnect() jumps straight from 'connected' to 'disconnected', skipping 'disconnecting'", async () => {
    const port = inputPort();
    await port.connect();

    const seen: ConnectionState[] = [];
    port.onStateChange((state) => seen.push(state));
    port.simulateDisconnect();

    expect(seen).toEqual(["disconnected"]);
  });

  it("rejects an invalid simulate*() transition, e.g. simulateAvailable() from 'connected'", async () => {
    const port = inputPort();
    await port.connect();
    expect(() => port.simulateAvailable()).toThrow(/Invalid MIDI connection state transition/);
  });

  it("treats repeated identical states as a no-op, not an event", () => {
    const port = inputPort();
    const seen: ConnectionState[] = [];
    port.onStateChange((state) => seen.push(state));

    port.simulateAvailable(); // already "available"

    expect(seen).toEqual([]);
  });
});

describe("mock device message flow", () => {
  it("delivers a normalized message through createMidiInput when the mock emits raw bytes", () => {
    const mock = inputPort();
    const input = createMidiInput(mock);
    const received: unknown[] = [];
    input.onMessage((message) => received.push(message));

    mock.emitRawMessage(Uint8Array.of(0x90, 60, 100)); // Note On, channel 0

    expect(received).toEqual([{ type: "note-on", channel: 0, note: 60, velocity: 100, raw: Uint8Array.of(0x90, 60, 100) }]);
  });

  it("delivers a Control Change message end to end", () => {
    const mock = inputPort();
    const input = createMidiInput(mock);
    const received: unknown[] = [];
    input.onMessage((message) => received.push(message));

    mock.emitRawMessage(Uint8Array.of(0xb2, 7, 127)); // CC, channel 2, controller 7

    expect(received).toEqual([{ type: "control-change", channel: 2, controller: 7, value: 127, raw: Uint8Array.of(0xb2, 7, 127) }]);
  });

  it("records bytes sent through createMidiOutput for a Note On/Off pair", () => {
    const mock = outputPort();
    const output = createMidiOutput(mock);

    output.send({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    output.send({ type: "note-off", channel: 0, note: 60, velocity: 0 });

    expect(mock.sentMessages.map((bytes) => Array.from(bytes))).toEqual([
      [0x90, 60, 100],
      [0x80, 60, 0],
    ]);
  });

  it("records bytes sent for a Control Change message", () => {
    const mock = outputPort();
    const output = createMidiOutput(mock);

    output.send({ type: "control-change", channel: 3, controller: 74, value: 64 });

    expect(Array.from(mock.sentMessages[0]!)).toEqual([0xb3, 74, 64]);
  });

  it("reports send-failed via onError instead of recording bytes once simulateSendFailures(true) is set", () => {
    const mock = outputPort();
    const output = createMidiOutput(mock);
    const errors: MidiTransportError[] = [];
    output.onError((error) => errors.push(error));

    mock.simulateSendFailures(true);
    output.send({ type: "note-on", channel: 0, note: 60, velocity: 100 });

    expect(mock.sentMessages).toHaveLength(0);
    expect(errors).toEqual([{ code: "send-failed", message: "Simulated send failure", portId: mock.port.id }]);
  });

  it("proves both directions on one createMockDevice: send on the output loops back through the input", () => {
    const device = createMockDevice({ id: "loopback" });
    const input = createMidiInput(device.input);
    const output = createMidiOutput(device.output);
    const received: unknown[] = [];
    input.onMessage((message) => received.push(message));

    // Wire the mock device's own output bytes back into its input, simulating a device that echoes what it's sent.
    const originalSendRaw = device.output.sendRaw.bind(device.output);
    device.output.sendRaw = (bytes) => {
      originalSendRaw(bytes);
      device.input.emitRawMessage(bytes);
    };

    output.send({ type: "control-change", channel: 0, controller: 1, value: 42 });

    expect(received).toEqual([{ type: "control-change", channel: 0, controller: 1, value: 42, raw: Uint8Array.of(0xb0, 1, 42) }]);
  });
});
