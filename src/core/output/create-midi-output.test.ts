import { describe, expect, it, vi } from "vitest";
import { createMidiOutput } from "./create-midi-output.js";
import { MidiEncodeError } from "../message/codec.js";
import type { RawMidiOutput } from "../types/output.js";
import type { ConnectionState } from "../types/lifecycle.js";
import type { MidiPortInfo } from "../types/identity.js";
import type { MidiTransportError } from "../types/errors.js";
import type { MidiMessage } from "../types/message.js";

/**
 * Minimal in-memory RawMidiOutput test double -- just enough to exercise
 * createMidiOutput's wiring. Not the project's mock/test device (ECS-32).
 */
class FakeRawOutput implements RawMidiOutput {
  readonly port: MidiPortInfo;
  state: ConnectionState = "available";
  readonly sent: Uint8Array[] = [];

  private readonly stateListeners = new Set<(state: ConnectionState, previous: ConnectionState) => void>();
  private readonly errorListeners = new Set<(error: MidiTransportError) => void>();

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

  sendRaw(bytes: Uint8Array): void {
    this.sent.push(bytes);
  }

  private setState(next: ConnectionState): void {
    const previous = this.state;
    this.state = next;
    for (const listener of this.stateListeners) listener(next, previous);
  }

  emitError(error: MidiTransportError): void {
    for (const listener of this.errorListeners) listener(error);
  }
}

const PORT: MidiPortInfo = { id: "fake-out-1", type: "output", name: "Fake Output", manufacturer: null };

describe("createMidiOutput", () => {
  it("exposes port and state as live values from the transport", async () => {
    const transport = new FakeRawOutput(PORT);
    const output = createMidiOutput(transport);

    expect(output.port).toBe(PORT);
    expect(output.state).toBe("available");

    await output.connect();
    expect(output.state).toBe("connected");
  });

  it("delegates connect/disconnect to the transport", async () => {
    const transport = new FakeRawOutput(PORT);
    const connectSpy = vi.spyOn(transport, "connect");
    const disconnectSpy = vi.spyOn(transport, "disconnect");
    const output = createMidiOutput(transport);

    await output.connect();
    await output.disconnect();

    expect(connectSpy).toHaveBeenCalledOnce();
    expect(disconnectSpy).toHaveBeenCalledOnce();
  });

  it("forwards state changes via onStateChange", async () => {
    const transport = new FakeRawOutput(PORT);
    const output = createMidiOutput(transport);
    const seen: ConnectionState[] = [];
    output.onStateChange((state) => seen.push(state));

    await output.connect();

    expect(seen).toEqual(["connecting", "connected"]);
  });

  it("forwards transport errors via onError instead of throwing", () => {
    const transport = new FakeRawOutput(PORT);
    const output = createMidiOutput(transport);
    const error: MidiTransportError = { code: "send-failed", message: "port gone" };
    const seen: MidiTransportError[] = [];
    output.onError((e) => seen.push(e));

    transport.emitError(error);

    expect(seen).toEqual([error]);
  });

  it("encodes a message and sends the resulting bytes", () => {
    const transport = new FakeRawOutput(PORT);
    const output = createMidiOutput(transport);

    output.send({ type: "note-on", channel: 0, note: 60, velocity: 100 });

    expect(transport.sent).toHaveLength(1);
    expect(Array.from(transport.sent[0]!)).toEqual([0x90, 60, 100]);
  });

  it("sends multiple messages as separate sendRaw calls, in order", () => {
    const transport = new FakeRawOutput(PORT);
    const output = createMidiOutput(transport);

    output.send({ type: "control-change", channel: 1, controller: 7, value: 100 });
    output.send({ type: "note-off", channel: 1, note: 60, velocity: 0 });

    expect(transport.sent.map((bytes) => Array.from(bytes))).toEqual([
      [0xb1, 7, 100],
      [0x81, 60, 0],
    ]);
  });

  it("sends SysEx/Unknown raw bytes through verbatim", () => {
    const transport = new FakeRawOutput(PORT);
    const output = createMidiOutput(transport);
    const raw = Uint8Array.of(0xf0, 0x7d, 0x01, 0xf7);

    output.send({ type: "sysex", raw });

    expect(transport.sent[0]).toBe(raw);
  });

  it("throws MidiEncodeError synchronously for an invalid message and never calls sendRaw", () => {
    const transport = new FakeRawOutput(PORT);
    const output = createMidiOutput(transport);

    const badMessage: MidiMessage = { type: "note-on", channel: 16, note: 60, velocity: 100 };
    expect(() => output.send(badMessage)).toThrow(MidiEncodeError);
    expect(transport.sent).toHaveLength(0);
  });
});
