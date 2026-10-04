import { describe, expect, it } from "vitest";
import { encodeMidiMessage } from "../core/message/codec.js";
import { createMockSurfaceDevice } from "./mock-surface-device.js";
import { createMockSurfaceHarness } from "./mock-surface-harness.js";

describe("createMockSurfaceHarness", () => {
  it("press() emits a note-on for a button, using the profile's declared address", () => {
    const device = createMockSurfaceDevice();
    const harness = createMockSurfaceHarness(device);
    const received: Uint8Array[] = [];
    device.input.onRawMessage((bytes) => received.push(bytes));

    harness.press("button-1");

    expect(Array.from(received[0]!)).toEqual([0x90, 101, 127]);
  });

  it("release() emits a note-off, defaulting velocity to 0", () => {
    const device = createMockSurfaceDevice();
    const harness = createMockSurfaceHarness(device);
    const received: Uint8Array[] = [];
    device.input.onRawMessage((bytes) => received.push(bytes));

    harness.release("pad-1");

    expect(Array.from(received[0]!)).toEqual([0x80, 37, 0]);
  });

  it("turnKnob() emits a control-change at the profile's declared controller", () => {
    const device = createMockSurfaceDevice();
    const harness = createMockSurfaceHarness(device);
    const received: Uint8Array[] = [];
    device.input.onRawMessage((bytes) => received.push(bytes));

    harness.turnKnob("knob-3", 64);

    expect(Array.from(received[0]!)).toEqual([0xb0, 13, 64]);
  });

  it("press() throws for a CC-only control (a knob)", () => {
    const harness = createMockSurfaceHarness(createMockSurfaceDevice());
    expect(() => harness.press("knob-1")).toThrow(/control-change/);
  });

  it("turnKnob() throws for a note-only control (a button)", () => {
    const harness = createMockSurfaceHarness(createMockSurfaceDevice());
    expect(() => harness.turnKnob("button-1", 64)).toThrow(/note/);
  });

  it("press()/turnKnob() throw for an unknown PhysicalControl id", () => {
    const harness = createMockSurfaceHarness(createMockSurfaceDevice());
    expect(() => harness.press("nowhere")).toThrow(/No PhysicalControl/);
  });

  it("decodedFeedback() decodes every message sent through output, in order", () => {
    const device = createMockSurfaceDevice();
    const harness = createMockSurfaceHarness(device);

    device.output.sendRaw(encodeMidiMessage({ type: "note-on", channel: 0, note: 37, velocity: 5 }));
    device.output.sendRaw(encodeMidiMessage({ type: "note-on", channel: 0, note: 38, velocity: 9 }));

    expect(harness.decodedFeedback()).toMatchObject([
      { type: "note-on", channel: 0, note: 37, velocity: 5 },
      { type: "note-on", channel: 0, note: 38, velocity: 9 },
    ]);
  });

  it("lastFeedbackFor() returns the most recent feedback matching a pad's declared feedback address", () => {
    const device = createMockSurfaceDevice();
    const harness = createMockSurfaceHarness(device);

    device.output.sendRaw(encodeMidiMessage({ type: "note-on", channel: 0, note: 37, velocity: 5 }));
    device.output.sendRaw(encodeMidiMessage({ type: "note-on", channel: 0, note: 38, velocity: 9 }));
    device.output.sendRaw(encodeMidiMessage({ type: "note-on", channel: 0, note: 37, velocity: 20 }));

    expect(harness.lastFeedbackFor("pad-1")).toMatchObject({ type: "note-on", channel: 0, note: 37, velocity: 20 });
    expect(harness.lastFeedbackFor("pad-2")).toMatchObject({ type: "note-on", channel: 0, note: 38, velocity: 9 });
  });

  it("lastFeedbackFor() returns undefined for a control with no feedback, or none sent yet", () => {
    const device = createMockSurfaceDevice();
    const harness = createMockSurfaceHarness(device);

    expect(harness.lastFeedbackFor("button-1")).toBeUndefined(); // buttons have no feedback at all
    expect(harness.lastFeedbackFor("pad-1")).toBeUndefined(); // nothing sent yet
  });
});
