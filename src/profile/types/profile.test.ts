import { describe, expect, it } from "vitest";
import type { ControlGrid } from "./grid.js";
import type { PhysicalControl } from "./control.js";
import { DEVICE_PROFILE_SCHEMA_VERSION, type DeviceProfile } from "./profile.js";

/**
 * A fictional test fixture, not a real controller — ECS-39 scopes out
 * concrete device profiles (Launchpad/APC/Push or otherwise). It exists to
 * prove the schema can actually describe a device with every facet named
 * in the ticket: identity, ports, controls, a grid, LED/motorized
 * feedback, SysEx, and a handshake.
 */

const padControls: PhysicalControl[] = [
  { row: 0, column: 0 },
  { row: 0, column: 1 },
  { row: 1, column: 0 },
  { row: 1, column: 1 },
].map(({ row, column }) => ({
  id: `pad-${row}-${column}`,
  label: `Pad ${row},${column}`,
  kind: "pad",
  portId: "main-in",
  input: { address: { type: "note", note: 36 + row * 4 + column }, channel: 0 },
  feedback: {
    kind: "velocity-color-led",
    address: { address: { type: "note", note: 36 + row * 4 + column }, channel: 0 },
    paletteSize: 128,
  },
}));

const grid: ControlGrid = {
  id: "main-grid",
  label: "Main pad grid",
  rows: 2,
  columns: 2,
  cells: padControls.map((control) => {
    const [, row, column] = control.id.split("-");
    return { row: Number(row), column: Number(column), controlId: control.id };
  }),
};

const fixture: DeviceProfile = {
  schemaVersion: DEVICE_PROFILE_SCHEMA_VERSION,
  identity: {
    id: "test.fixture-grid-controller",
    manufacturer: "Test Fixture Co.",
    model: "Grid Controller 64",
  },
  ports: [
    {
      id: "main-in",
      type: "input",
      role: "main",
      required: true,
      messageTypes: ["note-on", "note-off", "control-change"],
    },
    {
      id: "main-out",
      type: "output",
      role: "main",
      required: true,
      messageTypes: ["note-on", "note-off", "control-change"],
    },
  ],
  controls: [
    {
      id: "knob-1",
      label: "Knob 1",
      kind: "knob",
      portId: "main-in",
      input: { address: { type: "control-change", controller: 20 }, channel: 0 },
    },
    {
      id: "encoder-1",
      label: "Encoder 1",
      kind: "encoder",
      portId: "main-in",
      valueMode: "relative",
      input: { address: { type: "control-change", controller: 21 }, channel: 0 },
    },
    {
      id: "fader-1",
      label: "Fader 1",
      kind: "fader",
      portId: "main-in",
      input: { address: { type: "control-change", controller: 22 }, channel: 0 },
      feedback: {
        kind: "motorized",
        address: { address: { type: "control-change", controller: 22 }, channel: 0 },
      },
    },
    ...padControls,
  ],
  grids: [grid],
  sysex: {
    manufacturerId: [0x00, 0x21, 0x3f],
    required: false,
    notes: "Used only for the optional palette-customization extras.",
  },
  handshake: {
    required: true,
    steps: [
      { id: "enter-programmer-mode", description: "Send mode-switch SysEx to enable LED/pad control.", direction: "send" },
      { id: "mode-ack", description: "Device echoes the mode byte back once switched.", direction: "expect" },
    ],
  },
};

describe("DeviceProfile shape", () => {
  it("can describe identity, ports, controls, grids, feedback, sysex and handshake together", () => {
    expect(fixture.identity.id).toBe("test.fixture-grid-controller");
    expect(fixture.ports).toHaveLength(2);
    expect(fixture.controls).toHaveLength(3 + padControls.length);
    expect(fixture.grids?.[0]?.cells).toHaveLength(4);
    expect(fixture.sysex?.required).toBe(false);
    expect(fixture.handshake?.steps.map((step) => step.direction)).toEqual(["send", "expect"]);
  });
});
