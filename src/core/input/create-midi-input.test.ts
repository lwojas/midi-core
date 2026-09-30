import { describe, expect, it, vi } from "vitest";
import { createMidiInput } from "./create-midi-input.js";
import type { RawMidiInput } from "../types/input.js";
import type { ConnectionState } from "../types/lifecycle.js";
import type { MidiPortInfo } from "../types/identity.js";
import type { MidiTransportError } from "../types/errors.js";

/**
 * Minimal in-memory RawMidiInput test double -- just enough to exercise
 * createMidiInput's wiring. Not the project's mock/test device (ECS-32),
 * which is a separate, more complete deliverable for use across the repo.
 */
class FakeRawInput implements RawMidiInput {
  readonly port: MidiPortInfo;
  state: ConnectionState = "available";

  private readonly stateListeners = new Set<(state: ConnectionState, previous: ConnectionState) => void>();
  private readonly errorListeners = new Set<(error: MidiTransportError) => void>();
  private readonly rawListeners = new Set<(bytes: Uint8Array) => void>();

  constructor(port: MidiPortInfo) {
    this.port = port;
  }

  async connect(): Promise<void> {
    this.setState("connecting");
    this.setState("connected");
  }

  async disconnect(): Promise<void> {
    this.setState("disconnecting");
    this.setState("disconnected");
  }

  onStateChange(listener: (state: ConnectionState, previous: ConnectionState) => void) {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onError(listener: (error: MidiTransportError) => void) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onRawMessage(listener: (bytes: Uint8Array) => void) {
    this.rawListeners.add(listener);
    return () => this.rawListeners.delete(listener);
  }

  private setState(next: ConnectionState): void {
    const previous = this.state;
    this.state = next;
    for (const listener of this.stateListeners) listener(next, previous);
  }

  emitRaw(bytes: Uint8Array): void {
    for (const listener of this.rawListeners) listener(bytes);
  }

  emitError(error: MidiTransportError): void {
    for (const listener of this.errorListeners) listener(error);
  }
}

const PORT: MidiPortInfo = { id: "fake-1", type: "input", name: "Fake Input", manufacturer: null };

describe("createMidiInput", () => {
  it("exposes port and state as live values from the transport", async () => {
    const transport = new FakeRawInput(PORT);
    const input = createMidiInput(transport);

    expect(input.port).toBe(PORT);
    expect(input.state).toBe("available");

    await input.connect();
    expect(input.state).toBe("connected");
  });

  it("delegates connect/disconnect to the transport", async () => {
    const transport = new FakeRawInput(PORT);
    const connectSpy = vi.spyOn(transport, "connect");
    const disconnectSpy = vi.spyOn(transport, "disconnect");
    const input = createMidiInput(transport);

    await input.connect();
    await input.disconnect();

    expect(connectSpy).toHaveBeenCalledOnce();
    expect(disconnectSpy).toHaveBeenCalledOnce();
  });

  it("forwards state changes via onStateChange", async () => {
    const transport = new FakeRawInput(PORT);
    const input = createMidiInput(transport);
    const seen: ConnectionState[] = [];
    input.onStateChange((state) => seen.push(state));

    await input.connect();

    expect(seen).toEqual(["connecting", "connected"]);
  });

  it("forwards transport errors via onError", () => {
    const transport = new FakeRawInput(PORT);
    const input = createMidiInput(transport);
    const error: MidiTransportError = { code: "connection-failed", message: "nope" };
    const seen: MidiTransportError[] = [];
    input.onError((e) => seen.push(e));

    transport.emitError(error);

    expect(seen).toEqual([error]);
  });

  it("decodes raw bytes and delivers a normalized MidiMessage via onMessage", () => {
    const transport = new FakeRawInput(PORT);
    const input = createMidiInput(transport);
    const received: unknown[] = [];
    input.onMessage((message) => received.push(message));

    transport.emitRaw(Uint8Array.of(0x90, 60, 100));

    expect(received).toEqual([{ type: "note-on", channel: 0, note: 60, velocity: 100, raw: Uint8Array.of(0x90, 60, 100) }]);
  });

  it("delivers one decoded message per raw message, to every listener", () => {
    const transport = new FakeRawInput(PORT);
    const input = createMidiInput(transport);
    const a: unknown[] = [];
    const b: unknown[] = [];
    input.onMessage((m) => a.push(m));
    input.onMessage((m) => b.push(m));

    transport.emitRaw(Uint8Array.of(0xb0, 7, 100));
    transport.emitRaw(Uint8Array.of(0xf8));

    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    expect(a[1]).toMatchObject({ type: "clock" });
  });

  it("stops delivering to a listener after it unsubscribes", () => {
    const transport = new FakeRawInput(PORT);
    const input = createMidiInput(transport);
    const received: unknown[] = [];
    const unsubscribe = input.onMessage((m) => received.push(m));

    transport.emitRaw(Uint8Array.of(0x90, 60, 100));
    unsubscribe();
    transport.emitRaw(Uint8Array.of(0x90, 61, 100));

    expect(received).toHaveLength(1);
  });

  it("never fails to decode -- malformed bytes come through as an unknown message", () => {
    const transport = new FakeRawInput(PORT);
    const input = createMidiInput(transport);
    const received: unknown[] = [];
    input.onMessage((m) => received.push(m));

    transport.emitRaw(Uint8Array.of(0x90)); // truncated

    expect(received).toEqual([{ type: "unknown", raw: Uint8Array.of(0x90) }]);
  });
});
