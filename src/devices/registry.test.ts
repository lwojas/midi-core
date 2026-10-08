import { describe, expect, it } from "vitest";
import type { MidiPortInfo } from "../core/types/identity.js";
import { DEVICE_REGISTRY, findDawPorts, findDevice, type DeviceEntry } from "./registry.js";

const launchpad = DEVICE_REGISTRY.find((entry) => entry.id === "novation.launchpad-mini-mk3")!;
const grid = DEVICE_REGISTRY.find((entry) => entry.id === "example.grid-8x8")!;

function port(id: string, type: MidiPortInfo["type"], name: string): MidiPortInfo {
  return { id, type, name, manufacturer: null } as MidiPortInfo;
}

const LAUNCHPAD_PORTS: MidiPortInfo[] = [
  port("lp-in", "input", "Launchpad Mini [MK3] MIDI Out"),
  port("lp-out", "output", "Launchpad Mini [MK3] MIDI In"),
  port("lp-daw-in", "input", "Launchpad Mini [MK3] DAW Out"),
  port("lp-daw-out", "output", "Launchpad Mini [MK3] DAW In"),
];

describe("findDawPorts (ECS-103)", () => {
  it("finds the Launchpad's DAW pair from its MIDI pair, by name", () => {
    const daw = findDawPorts(launchpad, LAUNCHPAD_PORTS, { input: "Launchpad Mini [MK3] MIDI Out", output: "Launchpad Mini [MK3] MIDI In" });
    expect(daw.input?.id).toBe("lp-daw-in");
    expect(daw.output?.id).toBe("lp-daw-out");
  });

  it("gives no ports for a device with no DAW ports, even when a port named like one is connected", () => {
    const ports = [port("g-in", "input", "Example 8x8 Grid MIDI Out"), port("g-daw", "input", "Example 8x8 Grid DAW Out")];
    expect(grid.dawPortNames).toBeUndefined();
    expect(findDawPorts(grid, ports, { input: "Example 8x8 Grid MIDI Out", output: "Example 8x8 Grid MIDI In" })).toEqual({});
  });

  it("gives no port the system doesn't report, while still finding the other one", () => {
    const ports = LAUNCHPAD_PORTS.filter((candidate) => candidate.id !== "lp-daw-out");
    const daw = findDawPorts(launchpad, ports, { input: "Launchpad Mini [MK3] MIDI Out", output: "Launchpad Mini [MK3] MIDI In" });
    expect(daw.input?.id).toBe("lp-daw-in");
    expect(daw.output).toBeUndefined();
  });

  it("gives no ports when the MIDI names are missing", () => {
    expect(findDawPorts(launchpad, LAUNCHPAD_PORTS, { input: null, output: undefined })).toEqual({});
  });

  it("matches the DAW port's type, so an output named like a DAW input is not returned as one", () => {
    const ports = [port("lp-daw-as-output", "output", "Launchpad Mini [MK3] DAW Out")];
    const daw = findDawPorts(launchpad, ports, { input: "Launchpad Mini [MK3] MIDI Out" });
    expect(daw.input).toBeUndefined();
  });
});

describe("findDevice", () => {
  it("recognises the Launchpad by its MIDI input name, so its DAW pair can be found from the registry", () => {
    expect(findDevice({ name: "Launchpad Mini [MK3] MIDI Out" })).toBe(launchpad);
  });

  it("recognises the Push mk1 by its User Port's name, but not its Live Port (a different, unmodeled protocol)", () => {
    const push = DEVICE_REGISTRY.find((entry) => entry.id === "ableton.push-mk1")!;
    expect(findDevice({ name: "Ableton Push User Port" })).toBe(push);
    expect(findDevice({ name: "Ableton Push Live Port" })).toBeUndefined();
  });

  it("returns entries whose DAW names are declared on their own, not inherited", () => {
    const declared = DEVICE_REGISTRY.filter((entry: DeviceEntry) => entry.dawPortNames !== undefined);
    expect(declared.map((entry) => entry.id)).toEqual(["novation.launchpad-mini-mk3"]);
  });
});
