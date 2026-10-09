import { describe, expect, it } from "vitest";
import { createAction } from "../control-api/action.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import type { MidiMessage } from "../core/types/message.js";
import type { MidiOutput } from "../core/types/output.js";
import { MockMidiInput } from "../adapters/mock/mock-input.js";
import { DEVICE_REGISTRY, findDevice, type DeviceEntry } from "../devices/registry.js";
import { EXAMPLE_GRID_8X8_PROFILE } from "../profile/devices/example-grid-8x8.js";
import { PUSH_MK1_PROFILE } from "../profile/devices/push-mk1.js";
import { validateDeviceProfile } from "../profile/validation/validate-profile.js";
import type { ModeBinding, NavigationBinding, SurfaceBindingTable } from "../surface/types/bindings.js";
import type { DeviceLayout } from "../profile/types/layout.js";
import { createSequencerBindings, type SequencerContract, type SequencerDevices } from "./sequencer.js";

// A `DisplayBinding` (ECS-137) is the one `ModeBinding` kind with no `physicalControlId`, so accessing it below
// needs this file's own navigation-binding narrowing, same as `createSequencerBindings` never produces one.
function isNavigationBinding(binding: ModeBinding): binding is NavigationBinding {
  return binding.kind === "navigate";
}

const action = () => createAction({ id: "a", label: "a" }, () => {});
const input = createMidiInput(new MockMidiInput({ id: "in", type: "input", name: "in", manufacturer: null }));
const contract = (): SequencerContract => ({
  stepTemplate: "step.{row}.{column}",
  lengthControl: "steps.length",
  muteTemplate: "mute.{track}",
  trackCountControl: "tracks.count",
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

  it("has the three modes, each with the device's two mode buttons available (side-69 is free, ECS-96), and activates steps and mixer from the application's selection", () => {
    expect(table.map((definition) => definition.mode)).toEqual(["steps", "mixer", "transport"]);
    for (const definition of table) {
      expect(definition.bindings?.filter((binding) => binding.kind === "navigate" && binding.navigate.kind === "set-mode")).toHaveLength(2);
    }
    expect(table.find((definition) => definition.mode === "steps")?.activateOn).toEqual({ scope: "step" });
    expect(table.find((definition) => definition.mode === "mixer")?.activateOn).toEqual({ scope: "track" });
  });

  it("steps mode windows all 64 pads onto the sequence, bounded by the length control and the track count", () => {
    const windows = bindingsOf(table, "steps").filter((binding) => binding.kind === "window");
    expect(windows).toHaveLength(64);
    for (const window of windows) {
      expect(window).toMatchObject({
        kind: "window",
        gridId: "pads",
        template: "step.{row}.{column}",
        press: "toggle",
        columnCountControl: "steps.length",
        rowCountControl: "tracks.count",
        colour: { red: 0, green: 0, blue: 127 },
      });
    }
  });

  it("pages tracks with the arrows' vertical pair, and time with the horizontal pair, in steps mode", () => {
    const pages = bindingsOf(table, "steps").filter(isNavigationBinding).filter((binding) => binding.navigate.kind === "page");
    expect(pages.map((binding) => [binding.physicalControlId, binding.navigate.kind === "page" ? binding.navigate.direction : undefined])).toEqual([
      ["top-91", { row: -1, column: 0 }],
      ["top-92", { row: 1, column: 0 }],
      ["top-93", { row: 0, column: -1 }],
      ["top-94", { row: 0, column: 1 }],
    ]);
  });

  it("pages tracks in the mixer with the left and right arrows, since its tracks run across, and has no vertical paging", () => {
    const pages = bindingsOf(table, "mixer").filter(isNavigationBinding).filter((binding) => binding.navigate.kind === "page");
    expect(pages.map((binding) => [binding.physicalControlId, binding.navigate.kind === "page" ? binding.navigate.direction : undefined])).toEqual([
      ["top-93", { row: -1, column: 0 }],
      ["top-94", { row: 1, column: 0 }],
    ]);
  });

  it("mixer mutes one track per column of the top row, laid out horizontally, and pages through tracks", () => {
    const mutes = bindingsOf(table, "mixer").filter((binding) => binding.kind === "window");
    expect(mutes.map((binding) => binding.physicalControlId)).toEqual(["pad-81", "pad-82", "pad-83", "pad-84", "pad-85", "pad-86", "pad-87", "pad-88"]);
    for (const mute of mutes) {
      expect(mute).toMatchObject({
        kind: "window",
        gridId: "pads",
        template: "mute.{track}",
        press: "toggle",
        orientation: "horizontal",
        rowCountControl: "tracks.count",
        colour: { red: 127, green: 0, blue: 0 },
      });
    }
  });

  it("lights steps blue and mutes red by default", () => {
    expect(bindingsOf(table, "steps").find((binding) => binding.kind === "window")).toMatchObject({ colour: { red: 0, green: 0, blue: 127 } });
    expect(bindingsOf(table, "mixer").find((binding) => binding.kind === "window")).toMatchObject({ colour: { red: 127, green: 0, blue: 0 } });
  });

  it("takes the colours an app names in its contract, and keeps the defaults for the rest", () => {
    const { bindings } = createSequencerBindings(input, launchpad.profile, { ...contract(), colours: { mutes: { red: 0, green: 127, blue: 0 } } });
    expect(bindingsOf(bindings, "steps").find((binding) => binding.kind === "window")).toMatchObject({ colour: { red: 0, green: 0, blue: 127 } });
    expect(bindingsOf(bindings, "mixer").find((binding) => binding.kind === "window")).toMatchObject({ colour: { red: 0, green: 127, blue: 0 } });
  });

  it("shows no duration or playhead feedback when the contract names neither (ECS-127, ECS-131)", () => {
    const windows = bindingsOf(table, "steps").filter((binding) => binding.kind === "window");
    for (const window of windows) {
      expect(window).not.toHaveProperty("durationTemplate");
      expect(window).not.toHaveProperty("playheadControl");
    }
  });

  it("carries a duration template and a dimmed continuation colour on every step when the contract names one (ECS-127)", () => {
    const { bindings } = createSequencerBindings(input, launchpad.profile, { ...contract(), stepDurationTemplate: "step.{row}.{column}.duration" });
    const windows = bindingsOf(bindings, "steps").filter((binding) => binding.kind === "window");
    expect(windows).toHaveLength(64);
    for (const window of windows) {
      expect(window).toMatchObject({ durationTemplate: "step.{row}.{column}.duration", continuationColour: { red: 0, green: 0, blue: 32 } });
    }
    // Mutes never show duration feedback: only steps have a per-step duration.
    for (const mute of bindingsOf(bindings, "mixer").filter((binding) => binding.kind === "window")) {
      expect(mute).not.toHaveProperty("durationTemplate");
    }
  });

  it("dims whatever colour the app names for steps, not a fixed default (ECS-127)", () => {
    const { bindings } = createSequencerBindings(input, launchpad.profile, {
      ...contract(),
      stepDurationTemplate: "step.{row}.{column}.duration",
      colours: { steps: { red: 100, green: 0, blue: 0 } },
    });
    const window = bindingsOf(bindings, "steps").find((binding) => binding.kind === "window");
    expect(window).toMatchObject({ colour: { red: 100, green: 0, blue: 0 }, continuationColour: { red: 25, green: 0, blue: 0 } });
  });

  it("carries a playhead control and the playhead colour on every step when the contract names one (ECS-131)", () => {
    const { bindings } = createSequencerBindings(input, launchpad.profile, { ...contract(), playheadControl: "transport.playhead" });
    const windows = bindingsOf(bindings, "steps").filter((binding) => binding.kind === "window");
    expect(windows).toHaveLength(64);
    for (const window of windows) {
      expect(window).toMatchObject({ playheadControl: "transport.playhead", playheadColour: { red: 127, green: 127, blue: 127 } });
    }
    // Mutes never show the playhead: it only moves through time steps, not tracks.
    for (const mute of bindingsOf(bindings, "mixer").filter((binding) => binding.kind === "window")) {
      expect(mute).not.toHaveProperty("playheadControl");
    }
  });

  it("takes the playhead colour the app names in its contract (ECS-131)", () => {
    const { bindings } = createSequencerBindings(input, launchpad.profile, {
      ...contract(),
      playheadControl: "transport.playhead",
      colours: { playhead: { red: 127, green: 127, blue: 0 } },
    });
    const window = bindingsOf(bindings, "steps").find((binding) => binding.kind === "window");
    expect(window).toMatchObject({ playheadColour: { red: 127, green: 127, blue: 0 } });
  });

  it("transport sits on the side column, clear of the arrows", () => {
    expect(launchpadLayout.transport).toEqual({ play: "side-59", stop: "side-49", record: "side-39", clear: "side-29" });
    expect(launchpadLayout.pageUp).toBe("top-91");
    expect(launchpadLayout.pageDown).toBe("top-92");
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
    const modeButtons = bindingsOf(table, "steps").filter(isNavigationBinding).filter((binding) => binding.navigate.kind === "set-mode");
    expect(modeButtons.map((binding) => binding.physicalControlId)).toEqual(["button-mode-a", "button-mode-b", "button-mode-c"]);
  });

  it("windows its own 8x8 grid, paged by its own paging, and mutes from its top row", () => {
    const windows = bindingsOf(table, "steps").filter((binding) => binding.kind === "window");
    expect(windows).toHaveLength(64);
    expect(new Set(windows.map((binding) => binding.physicalControlId)).size).toBe(64);
    expect(windows.every((binding) => binding.kind === "window" && binding.gridId === "grid")).toBe(true);
    const mutes = bindingsOf(table, "mixer").filter((binding) => binding.kind === "window");
    expect(mutes.map((binding) => binding.physicalControlId)).toEqual(["pad-0-0", "pad-0-1", "pad-0-2", "pad-0-3", "pad-0-4", "pad-0-5", "pad-0-6", "pad-0-7"]);
  });

  it("binds its page buttons to the grid's paging", () => {
    const pages = bindingsOf(table, "steps").filter(isNavigationBinding).filter((binding) => binding.navigate.kind === "page");
    expect(pages.map((binding) => binding.physicalControlId)).toEqual(["button-page-left", "button-page-right"]);
  });
});

describe("createSequencerBindings on the Push mk1 (ECS-91: device-independence, no Push-specific code in this module)", () => {
  const push = DEVICE_REGISTRY.find((entry) => entry.id === PUSH_MK1_PROFILE.identity.id) as DeviceEntry;
  const { bindings: table, unresolved } = createSequencerBindings(input, push.profile, contract());

  it("validates its profile, and resolves every role its layout actually names", () => {
    expect(validateDeviceProfile(PUSH_MK1_PROFILE)).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  it("builds the same three modes, but reaches only steps by button: mixer and transport have no mode button on this device (ECS-138, ECS-146)", () => {
    expect(table.map((definition) => definition.mode)).toEqual(["steps", "mixer", "transport"]);
    const modeButtons = bindingsOf(table, "steps").filter(isNavigationBinding).filter((binding) => binding.navigate.kind === "set-mode");
    expect(modeButtons.map((binding) => binding.physicalControlId)).toEqual(["button-note"]);
  });

  it("windows its own 8x8 pad grid onto the sequence; the grid's top row (notes 92-99) still mutes in mixer mode", () => {
    const windows = bindingsOf(table, "steps")
      .filter((binding) => binding.kind === "window")
      .filter((binding) => binding.gridId === "pads");
    expect(windows).toHaveLength(64);
    const mutes = bindingsOf(table, "mixer")
      .filter((binding) => binding.kind === "window")
      .filter((binding) => binding.gridId === "pads");
    expect(mutes.map((binding) => binding.physicalControlId)).toEqual(["pad-92", "pad-93", "pad-94", "pad-95", "pad-96", "pad-97", "pad-98", "pad-99"]);
  });

  it("also mutes from the dedicated upper-row strip (CC 102-109), live in steps and transport without a mode switch (ECS-138)", () => {
    for (const mode of ["steps", "transport"]) {
      const dedicated = bindingsOf(table, mode)
        .filter((binding) => binding.kind === "window")
        .filter((binding) => binding.gridId === "mute-strip");
      expect(dedicated.map((binding) => binding.physicalControlId)).toEqual([
        "button-upper-1",
        "button-upper-2",
        "button-upper-3",
        "button-upper-4",
        "button-upper-5",
        "button-upper-6",
        "button-upper-7",
        "button-upper-8",
      ]);
      expect(dedicated.every((binding) => binding.kind === "window" && binding.template === "mute.{track}" && binding.orientation === "horizontal")).toBe(
        true,
      );
    }
  });

  it("lights Note while steps is active, and nowhere else (ECS-138)", () => {
    const indicators = bindingsOf(table, "steps").filter((binding) => binding.kind === "mode-indicator");
    expect(indicators).toEqual([{ kind: "mode-indicator", physicalControlId: "button-note", role: "mode indicator: steps", mode: "steps" }]);
    // Present, identically, in every mode's own bindings -- the same "available everywhere" treatment bank indicators get.
    expect(bindingsOf(table, "mixer").filter((binding) => binding.kind === "mode-indicator")).toEqual(indicators);
    expect(bindingsOf(table, "transport").filter((binding) => binding.kind === "mode-indicator")).toEqual(indicators);
  });

  it("pages with the dedicated Arrow buttons", () => {
    const pages = bindingsOf(table, "steps").filter(isNavigationBinding).filter((binding) => binding.navigate.kind === "page");
    expect(pages.map((binding) => binding.physicalControlId)).toEqual(["button-arrow-up", "button-arrow-down", "button-arrow-left", "button-arrow-right"]);
  });

  it("builds transport from Play/Stop/Record: Clear has no assigned action button and is silently absent, not reported", () => {
    expect(push.profile.layout?.transport).toEqual({ play: "button-play", stop: "button-stop-clip", record: "button-record" });
    expect(table.find((definition) => definition.mode === "transport")?.hooks).toBeDefined();
  });

  it("has no button that reaches transport mode; Stop Clip is a plain transport control instead (ECS-146)", () => {
    const toTransport = bindingsOf(table, "steps")
      .filter(isNavigationBinding)
      .find((binding) => binding.navigate.kind === "set-mode" && binding.navigate.mode === "transport");
    expect(toTransport).toBeUndefined();
  });

  it("fires Play/Stop/Record from steps and mixer alike, with no mode switch: Stop actually invokes contract.actions.stop (ECS-146)", async () => {
    const rawInput = new MockMidiInput({ id: "push-in", type: "input", name: "push-in", manufacturer: null });
    const pushInput = createMidiInput(rawInput);
    const played: string[] = [];
    const fire = (name: string) => () => played.push(name);
    const trackedContract: SequencerContract = {
      ...contract(),
      actions: {
        play: createAction({ id: "play", label: "play" }, fire("play")),
        stop: createAction({ id: "stop", label: "stop" }, fire("stop")),
        record: createAction({ id: "record", label: "record" }, fire("record")),
      },
    };
    const { bindings: pushTable } = createSequencerBindings(pushInput, push.profile, trackedContract);
    const press = (cc: number) => rawInput.emitRawMessage(new Uint8Array([0xb0, cc, 127]));

    for (const mode of ["steps", "mixer"] as const) {
      const definition = pushTable.find((candidate) => candidate.mode === mode);
      await definition?.hooks?.onEnter?.();
      press(85); // Play
      press(29); // Stop (button-stop-clip)
      press(86); // Record
      await definition?.hooks?.onExit?.();
    }
    expect(played).toEqual(["play", "stop", "record", "play", "stop", "record"]);
  });

  it("has no bank role: bank buttons/indicators are simply absent, with nothing to report", () => {
    expect(push.profile.layout?.bank).toBeUndefined();
    const indicators = bindingsOf(table, "steps").filter((binding) => binding.kind === "indicator");
    expect(indicators).toHaveLength(0);
  });

  it("lights Play/Stop/Record dim on enter, full while held, and off on exit, when an output is connected (ECS-145 follow-up)", async () => {
    const rawInput = new MockMidiInput({ id: "push-in", type: "input", name: "push-in", manufacturer: null });
    const pushInput = createMidiInput(rawInput);
    const sent: Array<readonly number[]> = [];
    const output = {
      send: (message: MidiMessage) => sent.push(message.type === "control-change" ? [message.controller, message.value] : []),
    } as unknown as MidiOutput;
    const devices: SequencerDevices = { outputs: { "user-port-out": output }, inputs: {} };

    const { bindings: pushTable } = createSequencerBindings(pushInput, push.profile, contract(), devices);
    const definition = pushTable.find((candidate) => candidate.mode === "steps")!;

    await definition.hooks?.onEnter?.();
    // Play (CC 85), Stop (CC 29), Record (CC 86) all rest dim (value 1) immediately on enter.
    expect(sent).toEqual(expect.arrayContaining([[85, 1], [29, 1], [86, 1]]));

    sent.length = 0;
    rawInput.emitRawMessage(new Uint8Array([0xb0, 85, 127])); // hold Play
    expect(sent).toContainEqual([85, 127]);
    rawInput.emitRawMessage(new Uint8Array([0xb0, 85, 0])); // release Play
    expect(sent).toContainEqual([85, 1]); // back to dim, not off

    sent.length = 0;
    await definition.hooks?.onExit?.();
    expect(sent).toEqual(expect.arrayContaining([[85, 0], [29, 0], [86, 0]])); // fully off on exit
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
    expect(bindingsOf(bindings, "steps").filter((binding) => binding.kind === "navigate" && binding.navigate.kind === "set-mode")).toHaveLength(2);
  });

  it("reports a page button and a transport button the profile lacks, and keeps the rest", () => {
    const { bindings, unresolved } = withLayout({
      ...launchpadLayout,
      pageLeft: "top-0",
      transport: { ...launchpadLayout.transport, play: "top-0" },
    });
    // Transport roles are resolved before mode/page roles now (ECS-146: the fader modes need them up front), so "transport:" reports first.
    expect(unresolved).toEqual(["transport: play (control top-0)", "page left (control top-0)"]);
    expect(bindingsOf(bindings, "steps").filter((binding) => binding.kind === "navigate" && binding.navigate.kind === "page")).toHaveLength(3);
  });

  it("reports the step grid, and builds the modes without its windows, mutes or pages, when the profile has no grid with paging", () => {
    const { bindings, unresolved } = createSequencerBindings(input, { ...launchpad.profile, grids: [] }, contract());
    expect(unresolved).toEqual(["step grid (a grid with paging)"]);
    expect(bindingsOf(bindings, "steps").filter((binding) => binding.kind === "window")).toHaveLength(0);
    expect(bindingsOf(bindings, "mixer").filter((binding) => binding.kind === "control")).toHaveLength(0);
    expect(bindingsOf(bindings, "steps").filter((binding) => binding.kind === "navigate" && binding.navigate.kind === "set-mode")).toHaveLength(2);
  });

  it("reports a dedicatedMuteGridId naming a grid the profile lacks, and still builds the rest (ECS-138)", () => {
    const { bindings, unresolved } = withLayout({ ...launchpadLayout, dedicatedMuteGridId: "no-such-grid" });
    expect(unresolved).toEqual(["dedicated mutes (grid no-such-grid)"]);
    expect(bindingsOf(bindings, "steps").filter((binding) => binding.kind === "window" && binding.gridId === "no-such-grid")).toHaveLength(0);
    expect(bindingsOf(bindings, "steps").filter((binding) => binding.kind === "navigate" && binding.navigate.kind === "set-mode")).toHaveLength(2);
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
