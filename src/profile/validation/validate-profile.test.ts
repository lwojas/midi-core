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
  };
}

const MAIN_OUT_PORT: DeviceProfile["ports"][number] = { id: "main-out", type: "output", role: "main", required: true, messageTypes: ["note-on"] };

function withSetup(steps: NonNullable<DeviceProfile["setup"]>["steps"]): DeviceProfile {
  const profile = validProfile();
  return {
    ...profile,
    ports: [...profile.ports, MAIN_OUT_PORT],
    setup: { inputPortId: "main-in", outputPortId: "main-out", steps },
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

  it("flags a control referencing a nonexistent feedbackPortId", () => {
    const profile = validProfile();
    const broken = { ...profile, controls: [{ ...profile.controls[0], feedbackPortId: "ghost-port" }] };
    expect(validateDeviceProfile(broken)).toContainEqual(
      expect.objectContaining({ code: "dangling-port-reference", path: "controls[0].feedbackPortId" }),
    );
  });

  it("accepts a control whose feedbackPortId resolves to a declared port", () => {
    const profile = validProfile();
    const withFeedbackPort = {
      ...profile,
      ports: [...profile.ports, { id: "main-out", type: "output", role: "main", required: true, messageTypes: ["note-on"] }],
      controls: [{ ...profile.controls[0], feedbackPortId: "main-out" }],
    };
    expect(validateDeviceProfile(withFeedbackPort)).toEqual([]);
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

  it("has no diagnostics for a setup with a send step and an expect step", () => {
    const withReply = withSetup([
      { id: "inquiry", description: "Identify.", send: [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7] },
      { id: "reply", description: "Reply.", expect: [0xf0, 0x7e, 0x00, null, 0xf7] },
    ]);
    expect(validateDeviceProfile(withReply)).toEqual([]);
  });

  it("flags a setup step that has neither send nor expect, or both", () => {
    expect(validateDeviceProfile(withSetup([{ id: "s", description: "x" }]))).toContainEqual(
      expect.objectContaining({ code: "setup-step-needs-send-or-expect", path: "setup.steps[0]" }),
    );
    expect(validateDeviceProfile(withSetup([{ id: "s", description: "x", send: [0xf0, 0xf7], expect: [0xf0] }]))).toContainEqual(
      expect.objectContaining({ code: "setup-step-needs-send-or-expect" }),
    );
  });

  it("flags out-of-range setup bytes, but allows null only in an expect step", () => {
    expect(validateDeviceProfile(withSetup([{ id: "s", description: "x", send: [0xf0, 256, 0xf7] }]))).toContainEqual(
      expect.objectContaining({ code: "setup-byte-out-of-range", path: "setup.steps[0].send[1]" }),
    );
    expect(validateDeviceProfile(withSetup([{ id: "s", description: "x", send: [0xf0, null, 0xf7] as unknown as number[] }]))).toContainEqual(
      expect.objectContaining({ code: "setup-byte-out-of-range" }),
    );
    expect(validateDeviceProfile(withSetup([{ id: "s", description: "x", expect: [0xf0, null, 0xf7] }]))).toEqual([]);
  });

  it("flags a SysEx send that starts with 0xF0 but never ends with 0xF7", () => {
    expect(validateDeviceProfile(withSetup([{ id: "s", description: "x", send: [0xf0, 0x00, 0x20] }]))).toContainEqual(
      expect.objectContaining({ code: "setup-sysex-unterminated" }),
    );
  });

  it("flags setup ports that are missing, the wrong direction, or not required", () => {
    const profile = withSetup([]);
    expect(validateDeviceProfile({ ...profile, setup: { ...profile.setup, inputPortId: "nope" } })).toContainEqual(
      expect.objectContaining({ code: "dangling-port-reference", path: "setup.inputPortId" }),
    );
    expect(validateDeviceProfile({ ...profile, setup: { ...profile.setup, inputPortId: "main-out" } })).toContainEqual(
      expect.objectContaining({ code: "setup-port-wrong-type", path: "setup.inputPortId" }),
    );
    const optionalOut = { ...profile, ports: profile.ports.map((p) => (p.id === "main-out" ? { ...p, required: false } : p)) };
    expect(validateDeviceProfile(optionalOut)).toContainEqual(
      expect.objectContaining({ code: "setup-port-not-required", path: "setup.outputPortId" }),
    );
  });

  it("warns (not errors) on a setup step with no description", () => {
    expect(validateDeviceProfile(withSetup([{ id: "s", description: "", send: [0xf0, 0xf7] }]))).toContainEqual(
      expect.objectContaining({ code: "setup-step-missing-description", severity: "warning" }),
    );
  });

  describe("rgb-led feedback (ECS-95)", () => {
    const withFeedback = (feedback: unknown): unknown => {
      const profile = validProfile();
      return { ...profile, controls: profile.controls.map((control) => ({ ...control, feedback })) };
    };

    it("accepts an rgb-led control with a SysEx prefix of byte values", () => {
      expect(validateDeviceProfile(withFeedback({ kind: "rgb-led", address: { address: { type: "note", note: 36 }, channel: 0 }, rgbSysExPrefix: [0x00, 0x20, 0x29] }))).toEqual([]);
    });

    it("reports an rgb-led control with no prefix, or one with a byte out of range", () => {
      const address = { address: { type: "note", note: 36 }, channel: 0 };
      expect(validateDeviceProfile(withFeedback({ kind: "rgb-led", address }))).toContainEqual(
        expect.objectContaining({ code: "invalid-rgb-prefix", path: "controls[0].feedback.rgbSysExPrefix", severity: "error" }),
      );
      expect(validateDeviceProfile(withFeedback({ kind: "rgb-led", address, rgbSysExPrefix: [0x00, 0x80] }))).toContainEqual(
        expect.objectContaining({ code: "invalid-rgb-prefix" }),
      );
    });
  });

  describe("layout (ECS-90)", () => {
    const withLayout = (layout: unknown): unknown => ({ ...validProfile(), layout });

    it("accepts a profile with no layout, and a layout whose control ids all resolve", () => {
      expect(validateDeviceProfile(validProfile())).toEqual([]);
      expect(validateDeviceProfile(withLayout({ modeButtons: [{ controlId: "pad-1", mode: "steps" }], pageLeft: "pad-1", transport: { play: "pad-1" } }))).toEqual([]);
    });

    it("reports a layout control id the profile does not declare, at the path that names it", () => {
      expect(validateDeviceProfile(withLayout({ modeButtons: [{ controlId: "side-89", mode: "steps" }] }))).toContainEqual(
        expect.objectContaining({ code: "dangling-control-reference", path: "layout.modeButtons[0].controlId" }),
      );
      expect(validateDeviceProfile(withLayout({ pageRight: "top-96" }))).toContainEqual(
        expect.objectContaining({ code: "dangling-control-reference", path: "layout.pageRight" }),
      );
      expect(validateDeviceProfile(withLayout({ transport: { clear: "top-94" } }))).toContainEqual(
        expect.objectContaining({ code: "dangling-control-reference", path: "layout.transport.clear" }),
      );
    });

    it("reports a layout that is not an object, or whose mode buttons are malformed", () => {
      expect(validateDeviceProfile(withLayout("steps"))).toContainEqual(expect.objectContaining({ code: "invalid-layout", path: "layout" }));
      expect(validateDeviceProfile(withLayout({ modeButtons: "pad-1" }))).toContainEqual(
        expect.objectContaining({ code: "invalid-layout", path: "layout.modeButtons" }),
      );
      expect(validateDeviceProfile(withLayout({ modeButtons: [{ controlId: "pad-1" }] }))).toContainEqual(
        expect.objectContaining({ code: "invalid-layout", path: "layout.modeButtons[0]" }),
      );
    });
  });
});
