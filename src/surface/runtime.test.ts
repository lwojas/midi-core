import { describe, expect, it, vi } from "vitest";
import { createControl } from "../control-api/control.js";
import { createControlRegistry } from "../control-api/registry.js";
import { createSurfaceContext } from "../control-api/context.js";
import type { BooleanControlDef, NumericControlDef } from "../control-api/types/control.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import type { MidiInput } from "../core/types/input.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import { createMockSurfaceDevice } from "../testing/mock-surface-device.js";
import { createMockSurfaceHarness } from "../testing/mock-surface-harness.js";
import { generateControlMappings } from "./generate.js";
import { createControlSurface, type ControlSurfaceDeps } from "./runtime.js";
import type { SurfaceBindingTable } from "./types/bindings.js";
import type { SurfaceLifecycleChange } from "./types/lifecycle.js";

function mixerTable(): SurfaceBindingTable {
  return [
    { mode: "mixer", bindings: [{ physicalControlId: "knob-1", role: "track-fader", kind: "control", resolve: { kind: "static", controlId: "track.1.volume" } }] },
    { mode: "step-grid", bindings: [{ physicalControlId: "pad-1", role: "step", kind: "control", resolve: { kind: "static", controlId: "pattern.1.step.1" } }] },
  ];
}

function buildDeps() {
  const device = createMockSurfaceDevice();
  const harness = createMockSurfaceHarness(device);
  const volumeDef: NumericControlDef = { id: "track.1.volume", label: "Volume", kind: "number", min: 0, max: 127, default: 0 };
  const stepDef: BooleanControlDef = { id: "pattern.1.step.1", label: "Step 1", kind: "boolean", default: false };
  const volume = createControl(volumeDef);
  const step = createControl(stepDef);
  const registry = createControlRegistry([volume, step]);
  const context = createSurfaceContext();

  const deps: ControlSurfaceDeps = {
    profile: device.profile,
    ports: { inputs: { "main-in": createMidiInput(device.input) }, outputs: { "main-out": createMidiOutput(device.output) } },
    bindingTable: mixerTable(),
    context,
    registry,
    generate: generateControlMappings,
    initialNavigation: { mode: "mixer" },
  };

  return { device, harness, volume, step, deps };
}

describe("createControlSurface — attach()", () => {
  it("connects required ports, transitions detached -> attaching -> attached, and binds the initial mode", async () => {
    const { device, harness, volume, deps } = buildDeps();
    const surface = createControlSurface(deps);
    const changes: SurfaceLifecycleChange[] = [];
    surface.onStateChange((change) => changes.push(change));

    await surface.attach();

    expect(changes).toEqual([
      { from: "detached", to: "attaching" },
      { from: "attaching", to: "attached" },
    ]);
    expect(surface.state).toBe("attached");
    expect(device.input.state).toBe("connected");

    harness.turnKnob("knob-1", 64);
    expect(volume.getValue()).toBe(64);
  });

  it("rejects if called while not detached", async () => {
    const { deps } = buildDeps();
    const surface = createControlSurface(deps);
    await surface.attach();

    await expect(surface.attach()).rejects.toThrow(/not detached/);
  });

  it("fails with a port-unavailable SurfaceError when a required port was never supplied", async () => {
    const { deps } = buildDeps();
    const brokenDeps: ControlSurfaceDeps = { ...deps, ports: { inputs: {}, outputs: {} } };
    const surface = createControlSurface(brokenDeps);
    const errors: unknown[] = [];
    surface.onError((error) => errors.push(error));

    await expect(surface.attach()).rejects.toMatchObject({ code: "port-unavailable" });
    expect(surface.state).toBe("error");
    expect(errors).toMatchObject([{ code: "port-unavailable" }]);
  });

  it("fails with a port-unavailable SurfaceError (carrying the cause) when a required port's connect() rejects", async () => {
    const { deps } = buildDeps();
    const failure = new Error("permission denied");
    const failingInput: MidiInput = {
      port: { id: "main-in", type: "input", name: null, manufacturer: null },
      state: "available",
      connect: () => Promise.reject(failure),
      disconnect: () => Promise.resolve(),
      onStateChange: () => () => {},
      onError: () => () => {},
      onMessage: () => () => {},
    };
    const brokenDeps: ControlSurfaceDeps = { ...deps, ports: { ...deps.ports, inputs: { "main-in": failingInput } } };
    const surface = createControlSurface(brokenDeps);

    await expect(surface.attach()).rejects.toMatchObject({ code: "port-unavailable", cause: failure });
    expect(surface.state).toBe("error");
  });

  it("sends each setup step's bytes on the setup output port, in order, before attaching", async () => {
    const profile: DeviceProfile = {
      schemaVersion: "1.0",
      identity: { id: "test.setup-device", manufacturer: "Test", model: "Test Setup Device" },
      ports: [
        { id: "main-in", type: "input", role: "main", required: true, messageTypes: [] },
        { id: "main-out", type: "output", role: "main", required: true, messageTypes: [] },
      ],
      controls: [],
      setup: {
        inputPortId: "main-in",
        outputPortId: "main-out",
        timeoutMs: 50,
        steps: [
          { id: "enter-mode", description: "Enter programmer mode", send: [0xf0, 0x00, 0x20, 0x29, 0xf7] },
          { id: "await-ack", description: "Wait for ack", expect: [0xf0, 0x00, null, 0xf7] },
        ],
      },
    };
    const { device } = buildDeps();
    const output = createMidiOutput(device.output);
    const realSend = output.send.bind(output);
    output.send = (message) => {
      realSend(message);
      device.input.emitRawMessage(Uint8Array.of(0xf0, 0x00, 0x7e, 0xf7)); // the device's ack
    };
    const deps: ControlSurfaceDeps = {
      profile,
      ports: { inputs: { "main-in": createMidiInput(device.input) }, outputs: { "main-out": output } },
      bindingTable: [],
      context: createSurfaceContext(),
      registry: createControlRegistry(),
      generate: generateControlMappings,
      initialNavigation: { mode: "none" },
    };
    const surface = createControlSurface(deps);

    await surface.attach();

    expect(surface.state).toBe("attached");
    expect(device.output.sentMessages.map((bytes) => Array.from(bytes))).toEqual([[0xf0, 0x00, 0x20, 0x29, 0xf7]]);
  });

  it("fails the attach with setup-timeout when an expected reply never arrives", async () => {
    const profile: DeviceProfile = {
      schemaVersion: "1.0",
      identity: { id: "test.setup-device", manufacturer: "Test", model: "Test Setup Device" },
      ports: [
        { id: "main-in", type: "input", role: "main", required: true, messageTypes: [] },
        { id: "main-out", type: "output", role: "main", required: true, messageTypes: [] },
      ],
      controls: [],
      setup: {
        inputPortId: "main-in",
        outputPortId: "main-out",
        timeoutMs: 20,
        steps: [{ id: "await-ack", description: "Wait for ack", expect: [0xf0, 0x00, 0xf7] }],
      },
    };
    const { device } = buildDeps();
    const deps: ControlSurfaceDeps = {
      profile,
      ports: { inputs: { "main-in": createMidiInput(device.input) }, outputs: { "main-out": createMidiOutput(device.output) } },
      bindingTable: [],
      context: createSurfaceContext(),
      registry: createControlRegistry(),
      generate: generateControlMappings,
      initialNavigation: { mode: "none" },
    };
    const surface = createControlSurface(deps);

    await expect(surface.attach()).rejects.toMatchObject({ code: "setup-timeout" });
    expect(surface.state).toBe("error");
  });

  it("fails the attach with setup-failed (carrying the cause) when a send step cannot be sent", async () => {
    const profile: DeviceProfile = {
      schemaVersion: "1.0",
      identity: { id: "test.setup-device", manufacturer: "Test", model: "Test Setup Device" },
      ports: [
        { id: "main-in", type: "input", role: "main", required: true, messageTypes: [] },
        { id: "main-out", type: "output", role: "main", required: true, messageTypes: [] },
      ],
      controls: [],
      setup: { inputPortId: "main-in", outputPortId: "main-out", steps: [{ id: "enter-mode", description: "Enter mode", send: [0xf0, 0xf7] }] },
    };
    const { device } = buildDeps();
    const failure = new Error("port went away");
    const output = createMidiOutput(device.output);
    output.send = () => {
      throw failure;
    };
    const deps: ControlSurfaceDeps = {
      profile,
      ports: { inputs: { "main-in": createMidiInput(device.input) }, outputs: { "main-out": output } },
      bindingTable: [],
      context: createSurfaceContext(),
      registry: createControlRegistry(),
      generate: generateControlMappings,
      initialNavigation: { mode: "none" },
    };
    const surface = createControlSurface(deps);

    await expect(surface.attach()).rejects.toMatchObject({ code: "setup-failed", cause: failure });
    expect(surface.state).toBe("error");
  });
});

describe("createControlSurface — detach()", () => {
  it("unbinds the active mode, disconnects required ports, and transitions attached -> detaching -> detached", async () => {
    const { device, harness, volume, deps } = buildDeps();
    const surface = createControlSurface(deps);
    await surface.attach();

    const changes: SurfaceLifecycleChange[] = [];
    surface.onStateChange((change) => changes.push(change));

    await surface.detach();

    expect(changes).toEqual([
      { from: "attached", to: "detaching" },
      { from: "detaching", to: "detached" },
    ]);
    expect(surface.state).toBe("detached");
    expect(device.input.state).toBe("disconnected");

    harness.turnKnob("knob-1", 10);
    expect(volume.getValue()).toBe(0); // unbound: no longer tracking input
  });

  it("is a no-op when already detached", async () => {
    const { deps } = buildDeps();
    const surface = createControlSurface(deps);
    await expect(surface.detach()).resolves.toBeUndefined();
    expect(surface.state).toBe("detached");
  });

  it("recovers from error state by cleaning up and transitioning directly to detached, never through detaching", async () => {
    const { deps } = buildDeps();
    const brokenDeps: ControlSurfaceDeps = { ...deps, ports: { inputs: {}, outputs: {} } };
    const surface = createControlSurface(brokenDeps);
    await expect(surface.attach()).rejects.toMatchObject({ code: "port-unavailable" });
    expect(surface.state).toBe("error");

    const changes: SurfaceLifecycleChange[] = [];
    surface.onStateChange((change) => changes.push(change));

    await surface.detach();

    expect(changes).toEqual([{ from: "error", to: "detached" }]);
    expect(surface.state).toBe("detached");
  });
});

describe("createControlSurface — spontaneous disconnect", () => {
  it("transitions straight to error when a connected port leaves 'connected' on its own, not via detach()", async () => {
    const { device, deps } = buildDeps();
    const surface = createControlSurface(deps);
    await surface.attach();

    const errors: unknown[] = [];
    surface.onError((error) => errors.push(error));
    const changes: SurfaceLifecycleChange[] = [];
    surface.onStateChange((change) => changes.push(change));

    device.input.simulateDisconnect();

    expect(surface.state).toBe("error");
    expect(changes).toEqual([{ from: "attached", to: "error" }]);
    expect(errors).toMatchObject([{ code: "port-unavailable" }]);
  });
});

describe("createControlSurface — mode switching", () => {
  it("rebinds automatically when navigation.setMode() is called while attached", async () => {
    const { device, harness, volume, step, deps } = buildDeps();
    const surface = createControlSurface(deps);
    await surface.attach();

    harness.turnKnob("knob-1", 50);
    expect(volume.getValue()).toBe(50);

    surface.navigation.setMode("step-grid");
    await flushMicrotasks();

    harness.press("pad-1");
    expect(step.getValue()).toBe(true);
    harness.turnKnob("knob-1", 99); // mixer's binding is gone now
    expect(volume.getValue()).toBe(50);

    surface.navigation.setMode("mixer");
    await flushMicrotasks();

    harness.turnKnob("knob-1", 99);
    expect(volume.getValue()).toBe(99);

    void device;
  });
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
