import { MockMidiDiscovery } from "./mock-discovery.js";
import { MockMidiInput } from "./mock-input.js";
import { MockMidiOutput } from "./mock-output.js";

let nextDeviceId = 1;

export interface MockDeviceOptions {
  /** Base id for the device's ports; the ports themselves get `${id}-in`/`${id}-out`. Defaults to an auto-incrementing id. */
  readonly id?: string;
  readonly name?: string;
  readonly manufacturer?: string | null;
  /** When given, the device's ports are registered with this discovery on creation. */
  readonly discovery?: MockMidiDiscovery;
}

export interface MockDevice {
  readonly input: MockMidiInput;
  readonly output: MockMidiOutput;
}

/**
 * A generic mock/test device: a paired input + output port, matching how
 * a real physical controller shows up to Core (one input port, one output
 * port -- identity is a port, not a device; see
 * docs/contracts/discovery-lifecycle.md) with no device-specific profile
 * or behavior layered on top. Used to exercise discovery, lifecycle,
 * errors and both message directions against the real Core contracts
 * without needing hardware or a browser.
 */
export function createMockDevice(options: MockDeviceOptions = {}): MockDevice {
  const id = options.id ?? `mock-device-${nextDeviceId++}`;
  const name = options.name ?? "Mock Test Device";
  const manufacturer = options.manufacturer ?? null;

  const input = new MockMidiInput({ id: `${id}-in`, type: "input", name, manufacturer });
  const output = new MockMidiOutput({ id: `${id}-out`, type: "output", name, manufacturer });

  if (options.discovery) {
    options.discovery.addPort(input.port);
    options.discovery.addPort(output.port);
  }

  return { input, output };
}
