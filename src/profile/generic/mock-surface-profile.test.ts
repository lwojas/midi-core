import { describe, expect, it } from "vitest";
import { validateDeviceProfile } from "../validation/validate-profile.js";
import {
  MOCK_SURFACE_BUTTONS,
  MOCK_SURFACE_CONTROLS,
  MOCK_SURFACE_DEVICE_PROFILE,
  MOCK_SURFACE_KNOBS,
  MOCK_SURFACE_PADS,
  MOCK_SURFACE_STEP_GRID,
} from "./mock-surface-profile.js";

describe("MOCK_SURFACE_DEVICE_PROFILE", () => {
  it("has no validation diagnostics: every reference resolves, every enum value is known", () => {
    expect(validateDeviceProfile(MOCK_SURFACE_DEVICE_PROFILE)).toEqual([]);
  });

  it("has eight knobs, four buttons and eight pads, per the ticket's shape", () => {
    expect(MOCK_SURFACE_KNOBS).toHaveLength(8);
    expect(MOCK_SURFACE_BUTTONS).toHaveLength(4);
    expect(MOCK_SURFACE_PADS).toHaveLength(8);
    expect(MOCK_SURFACE_CONTROLS).toHaveLength(20);
  });

  it("every control id is unique", () => {
    const ids = MOCK_SURFACE_CONTROLS.map((control) => control.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("knobs are CC input-only (no feedback)", () => {
    for (const knob of MOCK_SURFACE_KNOBS) {
      expect(knob.input?.address.type).toBe("control-change");
      expect(knob.feedback).toBeUndefined();
    }
  });

  it("buttons are note input-only (no feedback)", () => {
    for (const button of MOCK_SURFACE_BUTTONS) {
      expect(button.input?.address.type).toBe("note");
      expect(button.feedback).toBeUndefined();
    }
  });

  it("pads have both note input and note feedback, routed to main-out", () => {
    for (const pad of MOCK_SURFACE_PADS) {
      expect(pad.input?.address.type).toBe("note");
      expect(pad.feedback?.address.address.type).toBe("note");
      expect(pad.feedbackPortId).toBe("main-out");
    }
  });

  it("the step grid is a single row referencing every pad, in order, by column", () => {
    expect(MOCK_SURFACE_STEP_GRID.rows).toBe(1);
    expect(MOCK_SURFACE_STEP_GRID.columns).toBe(8);
    expect(MOCK_SURFACE_STEP_GRID.cells).toHaveLength(8);
    MOCK_SURFACE_STEP_GRID.cells.forEach((cell, index) => {
      expect(cell).toEqual({ row: 0, column: index, controlId: `pad-${index + 1}` });
    });
  });
});
