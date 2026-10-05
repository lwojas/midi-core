import { describe, expect, it } from "vitest";
import { createAction } from "../control-api/action.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { MockMidiInput } from "../adapters/mock/mock-input.js";
import { DEVICE_REGISTRY, findDevice, type DeviceEntry } from "../devices/registry.js";
import { LAUNCHPAD_SEQUENCER_BINDINGS_JSON } from "./fixtures/launchpad-sequencer-bindings.js";
import { EXAMPLE_GRID_8X8_PROFILE } from "../profile/devices/example-grid-8x8.js";
import { validateDeviceProfile } from "../profile/validation/validate-profile.js";
import type { ModeBinding, SurfaceBindingTable } from "../surface/types/bindings.js";
import type { DeviceLayout } from "../profile/types/layout.js";
import { createSequencerBindings, type SequencerContract } from "./sequencer.js";

const action = () => createAction({ id: "a", label: "a" }, () => {});
const input = createMidiInput(new MockMidiInput({ id: "in", type: "input", name: "in", manufacturer: null }));
const contract = (): SequencerContract => ({
  stepTemplate: "step.{row}.{column}",
  lengthControl: "steps.length",
  muteTemplate: "mute.{track}",
  actions: { play: action(), stop: action(), record: action(), clear: action() },
});

const launchpad = findDevice({ name: "Launchpad Mini MK3 MIDI" }) as DeviceEntry;
const example = DEVICE_REGISTRY.find((entry) => entry.id === EXAMPLE_GRID_8X8_PROFILE.identity.id) as DeviceEntry;
const launchpadLayout = launchpad.profile.layout as DeviceLayout;

function bindingsOf(table: SurfaceBindingTable, mode: string): readonly ModeBinding[] {
  return table.find((definition) => definition.mode === mode)?.bindings ?? [];
}

describe("createSequencerBindings on the Launchpad", () => {
  const { bindings: table, unresolved } = createSequencerBindings(input, launchpad.profile, contract());

  it("resolves every role", () => {
    expect(unresolved).toEqual([]);
  });

  it("has the three modes, each with the device's mode buttons available, and activates steps and mixer from the application's selection", () => {
    expect(table.map((definition) => definition.mode)).toEqual(["steps", "mixer", "transport"]);
    for (const definition of table) {
      expect(definition.bindings?.filter((binding) => binding.kind === "navigate" && binding.navigate.kind === "set-mode")).toHaveLength(3);
    }
    expect(table.find((definition) => definition.mode === "steps")?.activateOn).toEqual({ scope: "step" });
    expect(table.find((definition) => definition.mode === "mixer")?.activateOn).toEqual({ scope: "track" });
  });

  it("steps mode windows all 64 pads onto the sequence, paged by the grid's page size, bounded by the length control", () => {
    const windows = bindingsOf(table, "steps").filter((binding) => binding.kind === "window");
    expect(windows).toHaveLength(64);
    for (const window of windows) {
      expect(window).toMatchObject({ kind: "window", gridId: "pads", template: "step.{row}.{column}", press: "toggle", columnCountControl: "steps.length" });
    }
    const pages = bindingsOf(table, "steps").filter((binding) => binding.kind === "navigate" && binding.navigate.kind === "page");
    expect(pages).toHaveLength(2);
  });

  it("mixer mutes tracks 1-8 from the top pad row, one per column", () => {
    const mutes = bindingsOf(table, "mixer").filter((binding) => binding.kind === "control");
    expect(mutes).toHaveLength(8);
    const controlIds = mutes.map((binding) => (binding.kind === "control" && binding.resolve.kind === "static" ? binding.resolve.controlId : undefined));
    expect(controlIds).toEqual(["mute.1", "mute.2", "mute.3", "mute.4", "mute.5", "mute.6", "mute.7", "mute.8"]);
  });

  it("gives the same bindings as the hardcoded configuration this replaced (ECS-89), so the refactor changed no behavior", () => {
    expect(JSON.stringify(table, null, 1)).toBe(LAUNCHPAD_SEQUENCER_BINDINGS_JSON);
  });
});

describe("createSequencerBindings on the example grid", () => {
  const { bindings: table, unresolved } = createSequencerBindings(input, example.profile, contract());

  it("validates its profile, and resolves every role through the same code path", () => {
    expect(validateDeviceProfile(EXAMPLE_GRID_8X8_PROFILE)).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  it("builds the same three modes, with its own mode buttons", () => {
    expect(table.map((definition) => definition.mode)).toEqual(["steps", "mixer", "transport"]);
    const modeButtons = bindingsOf(table, "steps").filter((binding) => binding.kind === "navigate" && binding.navigate.kind === "set-mode");
    expect(modeButtons.map((binding) => binding.physicalControlId)).toEqual(["button-mode-a", "button-mode-b", "button-mode-c"]);
  });

  it("windows its own 8x8 grid, paged by its own paging, and mutes from its top row", () => {
    const windows = bindingsOf(table, "steps").filter((binding) => binding.kind === "window");
    expect(windows).toHaveLength(64);
    expect(new Set(windows.map((binding) => binding.physicalControlId)).size).toBe(64);
    expect(windows.every((binding) => binding.kind === "window" && binding.gridId === "grid")).toBe(true);
    const mutes = bindingsOf(table, "mixer").filter((binding) => binding.kind === "control");
    expect(mutes.map((binding) => binding.physicalControlId)).toEqual(["pad-0-0", "pad-0-1", "pad-0-2", "pad-0-3", "pad-0-4", "pad-0-5", "pad-0-6", "pad-0-7"]);
  });

  it("binds its page buttons to the grid's paging", () => {
    const pages = bindingsOf(table, "steps").filter((binding) => binding.kind === "navigate" && binding.navigate.kind === "page");
    expect(pages.map((binding) => binding.physicalControlId)).toEqual(["button-page-left", "button-page-right"]);
  });
});

describe("createSequencerBindings when a role cannot be found", () => {
  const withLayout = (layout: DeviceLayout | undefined, profile = launchpad.profile) =>
    createSequencerBindings(input, { ...profile, layout }, contract());

  it("reports a mode button whose control the profile lacks, and omits only that binding", () => {
    const { bindings, unresolved } = withLayout({
      ...launchpadLayout,
      modeButtons: [...(launchpadLayout.modeButtons ?? []), { controlId: "side-1", mode: "extra" }],
    });
    expect(unresolved).toEqual(["mode: extra (control side-1)"]);
    expect(bindingsOf(bindings, "steps").filter((binding) => binding.kind === "navigate" && binding.navigate.kind === "set-mode")).toHaveLength(3);
  });

  it("reports a page button and a transport button the profile lacks, and keeps the rest", () => {
    const { bindings, unresolved } = withLayout({
      ...launchpadLayout,
      pageLeft: "top-0",
      transport: { ...launchpadLayout.transport, play: "top-0" },
    });
    expect(unresolved).toEqual(["page left (control top-0)", "transport: play (control top-0)"]);
    expect(bindingsOf(bindings, "steps").filter((binding) => binding.kind === "navigate" && binding.navigate.kind === "page")).toHaveLength(1);
  });

  it("reports the step grid, and builds the modes without its windows, mutes or pages, when the profile has no grid with paging", () => {
    const { bindings, unresolved } = createSequencerBindings(input, { ...launchpad.profile, grids: [] }, contract());
    expect(unresolved).toEqual(["step grid (a grid with paging)"]);
    expect(bindingsOf(bindings, "steps").filter((binding) => binding.kind === "window")).toHaveLength(0);
    expect(bindingsOf(bindings, "mixer").filter((binding) => binding.kind === "control")).toHaveLength(0);
    expect(bindingsOf(bindings, "steps").filter((binding) => binding.kind === "navigate" && binding.navigate.kind === "set-mode")).toHaveLength(3);
  });

  it("builds transport without a button the layout does not name, and does not report it", () => {
    const { bindings, unresolved } = withLayout({ ...launchpadLayout, transport: { play: "top-91" } });
    expect(unresolved).toEqual([]);
    expect(bindings.find((definition) => definition.mode === "transport")?.hooks).toBeDefined();
  });

  it("reports a profile with no layout, and still builds the step grid and its paging-free windows", () => {
    const { bindings, unresolved } = withLayout(undefined);
    expect(unresolved).toEqual(["layout (the profile declares none)"]);
    expect(bindingsOf(bindings, "steps").filter((binding) => binding.kind === "window")).toHaveLength(64);
    expect(bindingsOf(bindings, "steps").filter((binding) => binding.kind === "navigate")).toHaveLength(0);
  });
});

describe("findDevice", () => {
  it("matches a port by its reported name, and returns undefined for a port no profile describes", () => {
    expect(findDevice({ name: "Launchpad Mini [MK3] MIDI" })?.id).toBe("novation.launchpad-mini-mk3");
    expect(findDevice({ name: "Launchpad Mini MK3" })?.id).toBe("novation.launchpad-mini-mk3");
    expect(findDevice({ name: "Example 8x8 Grid MIDI In" })?.id).toBe("example.grid-8x8");
    expect(findDevice({ name: "Some Other Keyboard" })).toBeUndefined();
    expect(findDevice({ name: null })).toBeUndefined();
  });
});
