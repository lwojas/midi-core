import { describe, expect, it } from "vitest";
import { createAction } from "../control-api/action.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { MockMidiInput } from "../adapters/mock/mock-input.js";
import type { ModeBinding } from "../surface/types/bindings.js";
import { createLaunchpadSequencerBindings } from "./launchpad-mini-mk3-sequencer.js";

const action = () => createAction({ id: "a", label: "a" }, () => {});
const input = createMidiInput(new MockMidiInput({ id: "in", type: "input", name: "in", manufacturer: null }));
const table = createLaunchpadSequencerBindings(input, {
  stepTemplate: "step.{row}.{column}",
  lengthControl: "steps.length",
  muteTemplate: "mute.{track}",
  actions: { play: action(), stop: action(), record: action(), clear: action() },
});
const bindingsOf = (mode: string): readonly ModeBinding[] => table.find((definition) => definition.mode === mode)?.bindings ?? [];

describe("createLaunchpadSequencerBindings", () => {
  it("has the three modes, each with the device's mode buttons, and activates steps and mixer from the application's selection", () => {
    expect(table.map((definition) => definition.mode)).toEqual(["steps", "mixer", "transport"]);
    for (const definition of table) {
      expect(definition.bindings?.filter((binding) => binding.kind === "navigate" && binding.navigate.kind === "set-mode")).toHaveLength(3);
    }
    expect(table.find((definition) => definition.mode === "steps")?.activateOn).toEqual({ scope: "step" });
    expect(table.find((definition) => definition.mode === "mixer")?.activateOn).toEqual({ scope: "track" });
  });

  it("steps mode windows all 64 pads onto the sequence, paged by the profile's page size, bounded by the length control", () => {
    const windows = bindingsOf("steps").filter((binding) => binding.kind === "window");
    expect(windows).toHaveLength(64);
    for (const window of windows) {
      expect(window).toMatchObject({ kind: "window", gridId: "pads", template: "step.{row}.{column}", press: "toggle", columnCountControl: "steps.length" });
    }
    const pages = bindingsOf("steps").filter((binding) => binding.kind === "navigate" && binding.navigate.kind === "page");
    expect(pages).toHaveLength(2);
  });

  it("mixer mutes tracks 1-8 from the top pad row, one per column", () => {
    const mutes = bindingsOf("mixer").filter((binding) => binding.kind === "control");
    expect(mutes).toHaveLength(8);
    const controlIds = mutes.map((binding) => (binding.kind === "control" && binding.resolve.kind === "static" ? binding.resolve.controlId : undefined));
    expect(controlIds).toEqual(["mute.1", "mute.2", "mute.3", "mute.4", "mute.5", "mute.6", "mute.7", "mute.8"]);
  });
});
