import { describe, expect, it } from "vitest";
import { createControl } from "../control-api/control.js";
import { createSurfaceContext } from "../control-api/context.js";
import { createControlRegistry } from "../control-api/registry.js";
import type { NumericControlDef } from "../control-api/types/control.js";
import { MockMidiInput } from "../adapters/mock/mock-input.js";
import { MockMidiOutput } from "../adapters/mock/mock-output.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import { PUSH_MK1_PROFILE } from "../profile/devices/push-mk1.js";
import { generateControlMappings } from "../surface/generate.js";
import { createControlSurface } from "../surface/runtime.js";
import { createSequencerBindings, type SequencerContract } from "./sequencer.js";

/**
 * ECS-155, end to end: the Push mk1's contextual selection buttons (CC 36-43) and Master (CC 28), through the
 * surface runtime. MIDI Core only ever moves a virtual index in and out of one shared application control; what the
 * index means (a track, here) is entirely this test's own stand-in for the integration layer, never midi-core's.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function build(options: { trackCount?: number } = {}) {
  const portInfo = { name: "Ableton Push", manufacturer: "Ableton" };
  const midiIn = new MockMidiInput({ id: "user-port-in", type: "input", ...portInfo });
  const midiOut = new MockMidiOutput({ id: "user-port-out", type: "output", ...portInfo });

  const selectedIndex = createControl<NumericControlDef>({ id: "selection.index", label: "Selected index", kind: "number", min: -1, max: 1024, default: -1 });
  const trackCount = createControl<NumericControlDef>({
    id: "tracks.count",
    label: "Track count",
    kind: "number",
    min: 0,
    max: 1024,
    default: options.trackCount ?? 16,
  });
  const registry = createControlRegistry([
    selectedIndex,
    trackCount,
    createControl<NumericControlDef>({ id: "steps.length", label: "length", kind: "number", min: 0, max: 1024, default: 0 }),
  ]);

  const contract: SequencerContract = {
    stepTemplate: "step.{row}.{column}",
    lengthControl: "steps.length",
    muteTemplate: "mute.{track}",
    trackCountControl: "tracks.count",
    actions: {},
    selectionIndexControl: "selection.index",
    selectionClearValue: -1,
  };
  const { bindings, unresolved } = createSequencerBindings(createMidiInput(midiIn), PUSH_MK1_PROFILE, contract);

  const surface = createControlSurface({
    profile: { ...PUSH_MK1_PROFILE, setup: undefined },
    ports: { inputs: { "user-port-in": createMidiInput(midiIn) }, outputs: { "user-port-out": createMidiOutput(midiOut) } },
    bindingTable: bindings,
    context: createSurfaceContext(),
    registry,
    generate: generateControlMappings,
    initialNavigation: { mode: "steps", gridOffset: { row: 0, column: 0 } },
  });

  const pressCc = async (controller: number) => {
    midiIn.emitRawMessage(new Uint8Array([0xb0, controller, 127]));
    await flush();
    midiIn.emitRawMessage(new Uint8Array([0xb0, controller, 0]));
    await flush();
  };

  /** The last value sent for `controller`, as a monochrome CC, or undefined if none was. */
  const lastValue = (controller: number): number | undefined => {
    const matches = midiOut.sentMessages.filter((bytes) => bytes[0] === 0xb0 && bytes[1] === controller);
    return matches[matches.length - 1]?.[2];
  };

  return { surface, registry, unresolved, pressCc, lastValue, selectedIndex, setTrackCount: (n: number) => trackCount.setValue(n) };
}

describe("ECS-155: the Push mk1's contextual selection buttons (CC 36-43) and Master (CC 28)", () => {
  it("resolves every role with no unresolved roles", async () => {
    const { unresolved } = build();
    expect(unresolved).toEqual([]);
  });

  it("a press on CC36-43 (page 0) writes its own virtual index — 'slot 3 was activated', never 'track 4'", async () => {
    const { surface, pressCc, selectedIndex } = build();
    await surface.attach();

    await pressCc(38); // button-select-3
    expect(selectedIndex.getValue()).toBe(2);

    await pressCc(43); // button-select-8
    expect(selectedIndex.getValue()).toBe(7);
    await surface.detach();
  });

  it("the selected button lights full, every other available button dim (ECS-145's monochrome tier, reused)", async () => {
    const { surface, pressCc, lastValue } = build();
    await surface.attach();

    await pressCc(36); // button-select-1
    expect(lastValue(36)).toBe(127);
    for (const cc of [37, 38, 39, 40, 41, 42, 43]) expect(lastValue(cc), `cc ${cc}`).toBe(1);
    await surface.detach();
  });

  it("selecting an item in the application (no device press at all) lights the matching button on the Push", async () => {
    const { surface, selectedIndex, lastValue } = build();
    await surface.attach();

    selectedIndex.setValue(4); // the application's own UI selected item 4 directly
    expect(lastValue(40)).toBe(127); // button-select-5, column 4
    expect(lastValue(36)).toBe(1);
    await surface.detach();
  });

  it("changing page (Arrow Down) moves which item each button represents, without losing the selection", async () => {
    const { surface, pressCc, selectedIndex, lastValue } = build({ trackCount: 24 });
    await surface.attach();

    selectedIndex.setValue(3); // selected on page 0 (button-select-4, CC 39)
    expect(lastValue(39)).toBe(127);

    await pressCc(47); // Arrow Down: pages tracks by the pad grid's own 8-row page size
    expect(lastValue(39)).toBe(1); // column 3 is now item 11 on this page: no longer the selected one

    await pressCc(39); // pressing it now selects item 11, not item 3
    expect(selectedIndex.getValue()).toBe(11);
    await surface.detach();
  });

  it("a button past the application's track count renders fully off — selection outside the current page", async () => {
    const { surface, lastValue } = build({ trackCount: 5 });
    await surface.attach();

    for (const cc of [36, 37, 38, 39, 40]) expect(lastValue(cc), `cc ${cc}`).toBe(1); // items 0-4 exist: dim
    for (const cc of [41, 42, 43]) expect(lastValue(cc), `cc ${cc}`).toBe(0); // items 5-7 don't: off
    await surface.detach();
  });

  it("Master (CC 28) clears the selection: every button goes dim, and Master's own LED lights full", async () => {
    const { surface, pressCc, selectedIndex, lastValue } = build();
    await surface.attach();

    await pressCc(37); // select item 1
    expect(selectedIndex.getValue()).toBe(1);
    expect(lastValue(37)).toBe(127);

    await pressCc(28); // Master
    expect(selectedIndex.getValue()).toBe(-1);
    expect(lastValue(37)).toBe(1); // no longer selected
    expect(lastValue(28)).toBe(127); // Master's own indicator: lit while the index is the "no selection" sentinel
    await surface.detach();
  });

  it("survives a mode switch: the selection buttons and Master are available in mixer and transport too", async () => {
    const { surface, pressCc, selectedIndex, lastValue } = build();
    await surface.attach();

    // The Push has no dedicated mixer mode button; its Note button only reaches `steps` (ECS-138), so this test
    // drives the mode directly instead of pretending a button exists for it.
    surface.navigation.setMode("mixer");
    await flush();

    await pressCc(40); // button-select-5
    expect(selectedIndex.getValue()).toBe(4);
    expect(lastValue(40)).toBe(127);

    await pressCc(28); // Master, still live in mixer mode too
    expect(selectedIndex.getValue()).toBe(-1);
    await surface.detach();
  });
});
