import { describe, expect, it } from "vitest";
import { validateDeviceProfile } from "../validation/validate-profile.js";
import {
  LAUNCHPAD_MINI_MK3_CONTROLS,
  LAUNCHPAD_MINI_MK3_PADS,
  LAUNCHPAD_MINI_MK3_PAD_GRID,
  LAUNCHPAD_MINI_MK3_PROFILE,
  LAUNCHPAD_MINI_MK3_SETUP,
  LAUNCHPAD_MINI_MK3_SIDE_COLUMN,
  LAUNCHPAD_MINI_MK3_TOP_ROW,
} from "./launchpad-mini-mk3.js";

describe("LAUNCHPAD_MINI_MK3_PROFILE", () => {
  it("has no validation diagnostics", () => {
    expect(validateDeviceProfile(LAUNCHPAD_MINI_MK3_PROFILE)).toEqual([]);
  });

  it("has 64 pads, 8 top-row buttons, 8 side-column buttons and a logo, 81 controls in all", () => {
    expect(LAUNCHPAD_MINI_MK3_PADS).toHaveLength(64);
    expect(LAUNCHPAD_MINI_MK3_TOP_ROW).toHaveLength(8);
    expect(LAUNCHPAD_MINI_MK3_SIDE_COLUMN).toHaveLength(8);
    expect(LAUNCHPAD_MINI_MK3_CONTROLS).toHaveLength(81);
  });

  it("setup identifies the device, then switches it into Programmer mode, on the device's own midi-in/midi-out", () => {
    expect(LAUNCHPAD_MINI_MK3_SETUP).toMatchObject({ inputPortId: "midi-in", outputPortId: "midi-out" });
    const [inquiry, reply, programmer] = LAUNCHPAD_MINI_MK3_SETUP.steps;
    expect(inquiry!.send).toEqual([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]);
    expect(reply!.expect).toEqual([0xf0, 0x7e, 0x00, 0x06, 0x02, 0x00, 0x20, 0x29, 0x13, 0x01, 0x00, 0x00, null, 0xf7]);
    expect(programmer!.send).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x0e, 0x01, 0xf7]);
  });

  it("every control id is unique", () => {
    const ids = LAUNCHPAD_MINI_MK3_CONTROLS.map((control) => control.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("pad notes follow the device's row-major numbering: top-left is 81, bottom-right is 18", () => {
    expect(LAUNCHPAD_MINI_MK3_PADS[0]!.input?.address).toEqual({ type: "note", note: 81 });
    expect(LAUNCHPAD_MINI_MK3_PADS[7]!.input?.address).toEqual({ type: "note", note: 88 });
    expect(LAUNCHPAD_MINI_MK3_PADS[56]!.input?.address).toEqual({ type: "note", note: 11 });
    expect(LAUNCHPAD_MINI_MK3_PADS[63]!.input?.address).toEqual({ type: "note", note: 18 });
  });

  it("the pad grid's cells cover every pad exactly once, in row-major order", () => {
    expect(LAUNCHPAD_MINI_MK3_PAD_GRID.cells).toHaveLength(64);
    expect(LAUNCHPAD_MINI_MK3_PAD_GRID.cells[0]).toEqual({ row: 0, column: 0, controlId: "pad-81" });
    expect(LAUNCHPAD_MINI_MK3_PAD_GRID.cells[63]).toEqual({ row: 7, column: 7, controlId: "pad-18" });
  });

  it("every control with feedback routes it to midi-out, not midi-in (the feedbackPortId correction)", () => {
    for (const control of LAUNCHPAD_MINI_MK3_CONTROLS) {
      if (!control.feedback) continue;
      expect(control.feedbackPortId, `${control.id} feedbackPortId`).toBe("midi-out");
    }
  });

  it("buttons are CC-addressed on channel 0; pads are note-addressed on channel 0", () => {
    for (const button of [...LAUNCHPAD_MINI_MK3_TOP_ROW, ...LAUNCHPAD_MINI_MK3_SIDE_COLUMN]) {
      expect(button.input?.address.type).toBe("control-change");
      expect(button.input?.channel).toBe(0);
    }
    for (const pad of LAUNCHPAD_MINI_MK3_PADS) {
      expect(pad.input?.address.type).toBe("note");
      expect(pad.input?.channel).toBe(0);
    }
  });
});
