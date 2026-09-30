import { describe, expect, it } from "vitest";
import { createWebMidiAccess, requestWebMidiAccess } from "./web-midi-access.js";
import { WebMidiDiscovery } from "./web-midi-discovery.js";
import { WebMidiInputTransport } from "./web-midi-input.js";
import { WebMidiOutputTransport } from "./web-midi-output.js";

/**
 * Fakes for the slice of the Web MIDI API our adapter actually uses.
 * Extending the real global EventTarget gets addEventListener/
 * removeEventListener/dispatchEvent for free, satisfying MIDIPort's
 * structural type without reimplementing it.
 */

class FakeMidiPort extends EventTarget implements MIDIPort {
  readonly id: string;
  readonly manufacturer: string | null;
  readonly name: string | null;
  readonly type: MIDIPortType;
  readonly version: string | null = null;
  state: MIDIPortDeviceState = "connected";
  connection: MIDIPortConnectionState = "closed";
  onstatechange: ((this: MIDIPort, ev: MIDIConnectionEvent) => unknown) | null = null;

  constructor(init: { id: string; name?: string | null; manufacturer?: string | null; type: MIDIPortType }) {
    super();
    this.id = init.id;
    this.name = init.name ?? null;
    this.manufacturer = init.manufacturer ?? null;
    this.type = init.type;
  }

  async open(): Promise<MIDIPort> {
    this.connection = "open";
    this.fireOwnStateChange();
    return this;
  }

  async close(): Promise<MIDIPort> {
    this.connection = "closed";
    this.fireOwnStateChange();
    return this;
  }

  fireOwnStateChange(): void {
    this.onstatechange?.call(this, { port: this } as unknown as MIDIConnectionEvent);
  }
}

class FakeMidiInput extends FakeMidiPort implements MIDIInput {
  onmidimessage: ((this: MIDIInput, ev: MIDIMessageEvent) => unknown) | null = null;

  constructor(init: { id: string; name?: string | null; manufacturer?: string | null }) {
    super({ ...init, type: "input" });
  }

  emitMessage(data: Uint8Array): void {
    this.onmidimessage?.call(this, { data } as unknown as MIDIMessageEvent);
  }
}

class FakeMidiOutput extends FakeMidiPort implements MIDIOutput {
  readonly sent: number[][] = [];
  failNextSend = false;

  constructor(init: { id: string; name?: string | null; manufacturer?: string | null }) {
    super({ ...init, type: "output" });
  }

  send(data: number[]): void {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error("simulated send failure");
    }
    this.sent.push(data);
  }
}

function fakePortMap<T extends MIDIPort>(ports: T[]): { forEach(fn: (port: T) => void): void } {
  return {
    forEach(fn) {
      for (const port of ports) fn(port);
    },
  };
}

class FakeMidiAccess extends EventTarget implements MIDIAccess {
  onstatechange: ((this: MIDIAccess, ev: MIDIConnectionEvent) => unknown) | null = null;
  readonly sysexEnabled = false;
  readonly inputs: MIDIInputMap;
  readonly outputs: MIDIOutputMap;

  constructor(
    private readonly inputPorts: FakeMidiInput[],
    private readonly outputPorts: FakeMidiOutput[],
  ) {
    super();
    this.inputs = fakePortMap(inputPorts) as unknown as MIDIInputMap;
    this.outputs = fakePortMap(outputPorts) as unknown as MIDIOutputMap;
  }

  addPort(port: FakeMidiInput | FakeMidiOutput): void {
    if (port instanceof FakeMidiOutput) this.outputPorts.push(port);
    else this.inputPorts.push(port as FakeMidiInput);
  }

  fireStateChange(port: MIDIPort | null): void {
    this.onstatechange?.call(this, { port } as unknown as MIDIConnectionEvent);
  }
}

describe("WebMidiDiscovery", () => {
  it("lists only currently-present ports", () => {
    const input = new FakeMidiInput({ id: "in-1", name: "Launchpad Mini" });
    const output = new FakeMidiOutput({ id: "out-1", name: "Launchpad Mini" });
    const access = new FakeMidiAccess([input], [output]);
    const discovery = new WebMidiDiscovery(access);

    const ports = discovery.listPorts();
    expect(ports).toHaveLength(2);
    expect(ports.map((p) => p.id).sort()).toEqual(["in-1", "out-1"]);
  });

  it("emits 'added' when a new port appears and includes it in listPorts()", () => {
    const access = new FakeMidiAccess([], []);
    const discovery = new WebMidiDiscovery(access);
    const changes: string[] = [];
    discovery.onChange((change) => changes.push(`${change.type}:${change.port.id}`));

    const newInput = new FakeMidiInput({ id: "in-new", name: "New Device" });
    access.addPort(newInput);
    access.fireStateChange(newInput);

    expect(changes).toEqual(["added:in-new"]);
    expect(discovery.listPorts().map((p) => p.id)).toContain("in-new");
  });

  it("emits 'removed' when a known port disconnects and drops it from listPorts()", () => {
    const input = new FakeMidiInput({ id: "in-1", name: "Launchpad Mini" });
    const access = new FakeMidiAccess([input], []);
    const discovery = new WebMidiDiscovery(access);
    const changes: string[] = [];
    discovery.onChange((change) => changes.push(`${change.type}:${change.port.id}`));

    input.state = "disconnected";
    access.fireStateChange(input);

    expect(changes).toEqual(["removed:in-1"]);
    expect(discovery.listPorts().map((p) => p.id)).not.toContain("in-1");
  });

  it("does not emit a change for a connection-only statechange (not a presence change)", () => {
    const input = new FakeMidiInput({ id: "in-1" });
    const access = new FakeMidiAccess([input], []);
    const discovery = new WebMidiDiscovery(access);
    const changes: unknown[] = [];
    discovery.onChange((change) => changes.push(change));

    input.connection = "open"; // still present, just now "open" -- a MidiConnection-level change, not discovery's concern
    access.fireStateChange(input);

    expect(changes).toEqual([]);
  });
});

describe("WebMidiInputTransport", () => {
  it("derives ConnectionState from the port and updates on open()", async () => {
    const midiInput = new FakeMidiInput({ id: "in-1" });
    const transport = new WebMidiInputTransport(midiInput);

    expect(transport.state).toBe("available");
    await transport.connect();
    expect(transport.state).toBe("connected");
  });

  it("reflects physical disconnection via onStateChange", () => {
    const midiInput = new FakeMidiInput({ id: "in-1" });
    const transport = new WebMidiInputTransport(midiInput);
    const seen: string[] = [];
    transport.onStateChange((state) => seen.push(state));

    midiInput.state = "disconnected";
    midiInput.fireOwnStateChange();

    expect(seen).toEqual(["disconnected"]);
  });

  it("decodes and forwards incoming raw messages", () => {
    const midiInput = new FakeMidiInput({ id: "in-1" });
    const transport = new WebMidiInputTransport(midiInput);
    const received: Uint8Array[] = [];
    transport.onRawMessage((bytes) => received.push(bytes));

    midiInput.emitMessage(Uint8Array.of(0x90, 60, 100));

    expect(received).toHaveLength(1);
    expect(Array.from(received[0]!)).toEqual([0x90, 60, 100]);
  });
});

describe("WebMidiOutputTransport", () => {
  it("sends bytes as a plain number array via MIDIOutput.send", () => {
    const midiOutput = new FakeMidiOutput({ id: "out-1" });
    const transport = new WebMidiOutputTransport(midiOutput);

    transport.sendRaw(Uint8Array.of(0x90, 60, 100));

    expect(midiOutput.sent).toEqual([[0x90, 60, 100]]);
  });

  it("reports a failed send through onError instead of throwing", () => {
    const midiOutput = new FakeMidiOutput({ id: "out-1" });
    midiOutput.failNextSend = true;
    const transport = new WebMidiOutputTransport(midiOutput);
    const errors: unknown[] = [];
    transport.onError((error) => errors.push(error));

    expect(() => transport.sendRaw(Uint8Array.of(0x90, 60, 100))).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "send-failed", portId: "out-1" });
  });
});

describe("createWebMidiAccess", () => {
  it("looks up ports by id and caches the same transport instance", () => {
    const input = new FakeMidiInput({ id: "in-1" });
    const access = createWebMidiAccess(new FakeMidiAccess([input], []));

    const first = access.getInput("in-1");
    const second = access.getInput("in-1");

    expect(first).toBeDefined();
    expect(first).toBe(second);
  });

  it("returns undefined for an unknown port id", () => {
    const access = createWebMidiAccess(new FakeMidiAccess([], []));
    expect(access.getInput("missing")).toBeUndefined();
    expect(access.getOutput("missing")).toBeUndefined();
  });

  it("exposes a working discovery alongside port lookup", () => {
    const output = new FakeMidiOutput({ id: "out-1", name: "Launchpad Mini" });
    const access = createWebMidiAccess(new FakeMidiAccess([], [output]));

    expect(access.discovery.listPorts()).toEqual([
      { id: "out-1", type: "output", name: "Launchpad Mini", manufacturer: null },
    ]);
  });
});

describe("requestWebMidiAccess", () => {
  it("rejects when the Web MIDI API is not available in this environment", async () => {
    await expect(requestWebMidiAccess()).rejects.toThrow("Web MIDI API is not available");
  });
});
