import { describe, expect, it } from "vitest";
import { validateDeviceProfile } from "../validation/validate-profile.js";
import {
  PUSH_MK1_ENCODERS,
  PUSH_MK1_CONTROLS,
  PUSH_MK1_MUTE_STRIP_GRID,
  PUSH_MK1_PAD_GRID,
  PUSH_MK1_PADS,
  PUSH_MK1_PROFILE,
  PUSH_MK1_UTILITY_BUTTONS,
} from "./push-mk1.js";

describe("PUSH_MK1_PROFILE", () => {
  it("has no validation diagnostics", () => {
    expect(validateDeviceProfile(PUSH_MK1_PROFILE)).toEqual([]);
  });

  it("has 11 encoders (22 controls: a CC and a touch-note each), 64 pads, 39 utility/nav/mode buttons: 127 controls", () => {
    expect(PUSH_MK1_ENCODERS).toHaveLength(22);
    expect(PUSH_MK1_PADS).toHaveLength(64);
    expect(PUSH_MK1_UTILITY_BUTTONS).toHaveLength(39);
    expect(PUSH_MK1_CONTROLS).toHaveLength(127);
  });

  it("every control id is unique", () => {
    const ids = PUSH_MK1_CONTROLS.map((control) => control.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no setup: User Mode is a physical toggle, and the one SysEx that could force it was never verified", () => {
    expect(PUSH_MK1_PROFILE.setup).toBeUndefined();
  });

  it("pad notes follow the device's bottom-left-origin, row-major numbering: bottom-left is 36, top-right is 99", () => {
    expect(PUSH_MK1_PADS[0]!.input?.address).toEqual({ type: "note", note: 36 });
    expect(PUSH_MK1_PADS[7]!.input?.address).toEqual({ type: "note", note: 43 });
    expect(PUSH_MK1_PADS[56]!.input?.address).toEqual({ type: "note", note: 92 });
    expect(PUSH_MK1_PADS[63]!.input?.address).toEqual({ type: "note", note: 99 });
  });

  it("the pad grid's cells cover every pad exactly once, with row 0 at the top (matching the Launchpad's own convention)", () => {
    expect(PUSH_MK1_PAD_GRID.cells).toHaveLength(64);
    expect(PUSH_MK1_PAD_GRID.cells[0]).toEqual({ row: 7, column: 0, controlId: "pad-36" });
    expect(PUSH_MK1_PAD_GRID.cells[63]).toEqual({ row: 0, column: 7, controlId: "pad-99" });
  });

  it("every control with feedback routes it to user-port-out, not user-port-in (the feedbackPortId correction)", () => {
    for (const control of PUSH_MK1_CONTROLS) {
      if (!control.feedback) continue;
      expect(control.feedbackPortId, `${control.id} feedbackPortId`).toBe("user-port-out");
    }
  });

  it("buttons and encoder touches are note/CC-addressed on channel 0; pads are note-addressed on channel 0", () => {
    for (const button of PUSH_MK1_UTILITY_BUTTONS) {
      expect(button.input?.address.type).toBe("control-change");
      expect(button.input?.channel).toBe(0);
    }
    for (const pad of PUSH_MK1_PADS) {
      expect(pad.input?.address.type).toBe("note");
      expect(pad.input?.channel).toBe(0);
    }
  });

  it("the layout's mode/page/transport roles all name real controls on the profile", () => {
    const ids = new Set(PUSH_MK1_CONTROLS.map((control) => control.id));
    const layout = PUSH_MK1_PROFILE.layout!;
    for (const { controlId } of layout.modeButtons ?? []) expect(ids.has(controlId)).toBe(true);
    for (const side of [layout.pageUp, layout.pageDown, layout.pageLeft, layout.pageRight]) expect(ids.has(side!)).toBe(true);
    for (const controlId of Object.values(layout.transport ?? {})) expect(ids.has(controlId!)).toBe(true);
  });

  it("has no mode button for mixer: Session is free, and mute moved to the dedicated strip instead (ECS-138)", () => {
    const layout = PUSH_MK1_PROFILE.layout!;
    expect(layout.modeButtons?.map((button) => button.mode)).toEqual(["steps", "transport"]);
    expect(layout.modeButtons?.every((button) => button.controlId !== "button-session")).toBe(true);
  });

  it("lights Note and Stop while their own mode is active (ECS-138)", () => {
    const layout = PUSH_MK1_PROFILE.layout!;
    expect(layout.modeButtons).toEqual([
      { controlId: "button-note", mode: "steps", indicator: true },
      { controlId: "button-stop-clip", mode: "transport", indicator: true },
    ]);
  });

  it("names the upper control row as a dedicated, always-available mute strip (ECS-138)", () => {
    expect(PUSH_MK1_PROFILE.layout?.dedicatedMuteGridId).toBe("mute-strip");
    expect(PUSH_MK1_MUTE_STRIP_GRID).toEqual({
      id: "mute-strip",
      label: "Upper control row, as a dedicated mute strip",
      rows: 1,
      columns: 8,
      cells: [
        { row: 0, column: 0, controlId: "button-upper-1" },
        { row: 0, column: 1, controlId: "button-upper-2" },
        { row: 0, column: 2, controlId: "button-upper-3" },
        { row: 0, column: 3, controlId: "button-upper-4" },
        { row: 0, column: 4, controlId: "button-upper-5" },
        { row: 0, column: 5, controlId: "button-upper-6" },
        { row: 0, column: 6, controlId: "button-upper-7" },
        { row: 0, column: 7, controlId: "button-upper-8" },
      ],
    });
    expect(PUSH_MK1_PROFILE.grids).toContain(PUSH_MK1_MUTE_STRIP_GRID);
  });

  it("every relative-valueMode encoder declares a relativeEncoding (ECS-137)", () => {
    const relativeEncoders = PUSH_MK1_ENCODERS.filter((control) => control.valueMode === "relative");
    expect(relativeEncoders).toHaveLength(11);
    for (const encoder of relativeEncoders) expect(encoder.relativeEncoding).toBe("twos-complement-7bit");
  });

  it("declares the LCD as a 4-line display, routed to user-port-out (ECS-137)", () => {
    const display = PUSH_MK1_PROFILE.displays?.[0];
    expect(display?.portId).toBe("user-port-out");
    expect(display?.lines).toHaveLength(4);
    expect(display?.lines.map((line) => line.lineId)).toEqual([0x18, 0x19, 0x1a, 0x1b]);
    expect(display?.charCount).toBe(68);
    expect(display?.prefix[0]).toBe(0xf0);
  });
});
