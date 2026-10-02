import { describe, expect, it } from "vitest";
import { DEVICE_PROFILE_SCHEMA_VERSION, type DeviceProfile } from "../types/profile.js";
import { validateDeviceProfile } from "./validate-profile.js";

function validProfile(): DeviceProfile {
  return {
    schemaVersion: DEVICE_PROFILE_SCHEMA_VERSION,
    identity: { id: "test.fixture", manufacturer: "Test Fixture Co.", model: "Fixture Device" },
    ports: [{ id: "main-in", type: "input", role: "main", required: true, messageTypes: ["note-on"] }],
    controls: [
      {
        id: "pad-1",
        label: "Pad 1",
        kind: "pad",
        portId: "main-in",
        input: { address: { type: "note", note: 36 }, channel: 0 },
      },
    ],
    grids: [{ id: "grid-1", label: "Grid", rows: 1, columns: 1, cells: [{ row: 0, column: 0, controlId: "pad-1" }] }],
    sysex: { manufacturerId: [0x7d], required: false },
    handshake: { required: true, steps: [{ id: "step-1", description: "Enter mode.", direction: "send" }] },
  };
}

describe("validateDeviceProfile", () => {
  it("returns no diagnostics for a valid profile", () => {
    expect(validateDeviceProfile(validProfile())).toEqual([]);
  });

  it("rejects a non-object document", () => {
    expect(validateDeviceProfile(null)).toEqual([
      { severity: "error", code: "invalid-document", path: "", message: expect.any(String) },
    ]);
  });

  it("flags an unsupported schemaVersion", () => {
    const profile = { ...validProfile(), schemaVersion: "99.0" };
    expect(validateDeviceProfile(profile)).toContainEqual(
      expect.objectContaining({ code: "unsupported-schema-version", path: "schemaVersion" }),
    );
  });

  it("flags an unknown port type", () => {
    const profile = validProfile();
    const broken = { ...profile, ports: [{ ...profile.ports[0], type: "bidirectional" }] };
    expect(validateDeviceProfile(broken)).toContainEqual(
      expect.objectContaining({ code: "unknown-port-type", path: "ports[0].type" }),
    );
  });

  it("flags a duplicate port id", () => {
    const profile = validProfile();
    const broken = { ...profile, ports: [...profile.ports, ...profile.ports] };
    expect(validateDeviceProfile(broken)).toContainEqual(
      expect.objectContaining({ code: "duplicate-port-id", path: "ports[1].id" }),
    );
  });

  it("flags a control referencing a nonexistent port", () => {
    const profile = validProfile();
    const broken = { ...profile, controls: [{ ...profile.controls[0], portId: "ghost-port" }] };
    expect(validateDeviceProfile(broken)).toContainEqual(
      expect.objectContaining({ code: "dangling-port-reference", path: "controls[0].portId" }),
    );
  });

  it("flags an unknown control kind", () => {
    const profile = validProfile();
    const broken = { ...profile, controls: [{ ...profile.controls[0], kind: "lever" }] };
    expect(validateDeviceProfile(broken)).toContainEqual(
      expect.objectContaining({ code: "unknown-control-kind", path: "controls[0].kind" }),
    );
  });

  it("flags a duplicate control id", () => {
    const profile = validProfile();
    const broken = { ...profile, controls: [...profile.controls, ...profile.controls] };
    expect(validateDeviceProfile(broken)).toContainEqual(
      expect.objectContaining({ code: "duplicate-control-id", path: "controls[1].id" }),
    );
  });

  it("flags a grid cell outside the grid's declared bounds", () => {
    const profile = validProfile();
    const broken = {
      ...profile,
      grids: [{ ...profile.grids![0], cells: [{ row: 5, column: 0, controlId: "pad-1" }] }],
    };
    expect(validateDeviceProfile(broken)).toContainEqual(
      expect.objectContaining({ code: "grid-cell-out-of-bounds", path: "grids[0].cells[0]" }),
    );
  });

  it("flags a grid cell referencing a nonexistent control", () => {
    const profile = validProfile();
    const broken = {
      ...profile,
      grids: [{ ...profile.grids![0], cells: [{ row: 0, column: 0, controlId: "ghost-control" }] }],
    };
    expect(validateDeviceProfile(broken)).toContainEqual(
      expect.objectContaining({ code: "dangling-control-reference", path: "grids[0].cells[0].controlId" }),
    );
  });

  it("flags duplicate cells at the same grid position", () => {
    const profile = validProfile();
    const cell = { row: 0, column: 0, controlId: "pad-1" };
    const broken = { ...profile, grids: [{ ...profile.grids![0], rows: 1, columns: 1, cells: [cell, cell] }] };
    expect(validateDeviceProfile(broken)).toContainEqual(
      expect.objectContaining({ code: "duplicate-grid-cell", path: "grids[0].cells[1]" }),
    );
  });

  it("flags sysex marked required with no manufacturerId, rather than assuming one", () => {
    const profile = validProfile();
    const broken = { ...profile, sysex: { manufacturerId: [], required: true } };
    expect(validateDeviceProfile(broken)).toContainEqual(
      expect.objectContaining({ code: "sysex-required-no-manufacturer-id" }),
    );
  });

  it("flags a handshake marked required with no steps, rather than inventing one", () => {
    const profile = validProfile();
    const broken = { ...profile, handshake: { required: true, steps: [] } };
    expect(validateDeviceProfile(broken)).toContainEqual(
      expect.objectContaining({ code: "handshake-required-no-steps" }),
    );
  });

  it("flags an unknown handshake step direction", () => {
    const profile = validProfile();
    const broken = {
      ...profile,
      handshake: { required: true, steps: [{ id: "s", description: "x", direction: "sideways" }] },
    };
    expect(validateDeviceProfile(broken)).toContainEqual(
      expect.objectContaining({ code: "unknown-handshake-direction", path: "handshake.steps[0].direction" }),
    );
  });

  it("warns (not errors) on a handshake step with no description", () => {
    const profile = validProfile();
    const broken = {
      ...profile,
      handshake: { required: true, steps: [{ id: "s", description: "", direction: "send" }] },
    };
    expect(validateDeviceProfile(broken)).toContainEqual(
      expect.objectContaining({ code: "handshake-step-missing-description", severity: "warning" }),
    );
  });
});
