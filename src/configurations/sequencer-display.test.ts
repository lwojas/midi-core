import { describe, expect, it } from "vitest";
import { createControl } from "../control-api/control.js";
import { createSurfaceContext } from "../control-api/context.js";
import { createControlRegistry } from "../control-api/registry.js";
import { MockMidiInput } from "../adapters/mock/mock-input.js";
import { MockMidiOutput } from "../adapters/mock/mock-output.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import { PUSH_MK1_PROFILE } from "../profile/devices/push-mk1.js";
import { LAUNCHPAD_MINI_MK3_PROFILE } from "../profile/devices/launchpad-mini-mk3.js";
import { generateControlMappings } from "../surface/generate.js";
import { createControlSurface } from "../surface/runtime.js";
import { createSequencerBindings, type SequencerContract } from "./sequencer.js";

/**
 * ECS-139, end to end: application controls (a string, a number's label/value, a boolean) reach the Push mk1's LCD
 * through `SequencerContract.displayLines` -> `layout.displayLines` -> `DisplayBinding` -> `PUSH_MK1_DISPLAY`'s
 * already-verified SysEx template, following the application's own state changes.
 */

const LINE_IDS = { track: 0x18, effect: 0x19, parameter: 0x1a, transport: 0x1b } as const;

/** The text the most recent message to `lineId` carried, with the template's fixed padding trimmed. */
function lastLineText(midiOut: MockMidiOutput, lineId: number): string | undefined {
  const message = [...midiOut.sentMessages].reverse().find((bytes) => bytes[0] === 0xf0 && bytes[4] === lineId);
  if (!message) return undefined;
  // F0 47 7F 15 <line> 00 45 00 <68 chars> F7
  return String.fromCharCode(...message.slice(8, 8 + 68)).trimEnd();
}

function build(displayLines: SequencerContract["displayLines"] | undefined = undefined) {
  const portInfo = { name: "Ableton Push", manufacturer: "Ableton" };
  const midiIn = new MockMidiInput({ id: "user-port-in", type: "input", ...portInfo });
  const midiOut = new MockMidiOutput({ id: "user-port-out", type: "output", ...portInfo });

  const trackName1 = createControl({ id: "track.1.name", label: "Track 1 name", kind: "string", default: "" }, "Kick");
  const trackName2 = createControl({ id: "track.2.name", label: "Track 2 name", kind: "string", default: "" }, "Snare");
  const cutoff = createControl({ id: "fx.cutoff", label: "Cutoff", kind: "number", min: 0, max: 18000, default: 2000, unit: "Hz" }, 2000);
  const volume = createControl({ id: "track.1.volume", label: "Volume", kind: "number", min: 0, max: 1, default: 0.5 }, 0.5);
  const playing = createControl({ id: "transport.isPlaying", label: "Playing", kind: "boolean", default: false }, false);
  const registry = createControlRegistry([trackName1, trackName2, cutoff, volume, playing]);
  const context = createSurfaceContext([{ scope: "track", id: "1" }]);

  const contract: SequencerContract = {
    stepTemplate: "step.{row}.{column}",
    lengthControl: "steps.length",
    muteTemplate: "mute.{track}",
    actions: {},
    displayLines: displayLines ?? {
      track: { kind: "from-selection", scope: "track", template: "track.{id}.name" },
      effect: { kind: "static", controlId: "fx.cutoff" },
      parameter: { kind: "from-selection", scope: "track", template: "track.{id}.volume" },
      transport: { kind: "static", controlId: "transport.isPlaying" },
    },
  };
  const { bindings, unresolved } = createSequencerBindings(createMidiInput(midiIn), PUSH_MK1_PROFILE, contract);
  const surface = createControlSurface({
    profile: { ...PUSH_MK1_PROFILE, setup: undefined },
    ports: { inputs: { "user-port-in": createMidiInput(midiIn) }, outputs: { "user-port-out": createMidiOutput(midiOut) } },
    bindingTable: bindings,
    context,
    registry,
    generate: generateControlMappings,
    initialNavigation: { mode: "steps", gridOffset: { row: 0, column: 0 } },
  });
  return { surface, midiOut, context, unresolved, bindings, trackName1, trackName2, cutoff, volume, playing };
}

describe("ECS-139: application text on the Push mk1's LCD", () => {
  it("paints each role's control text through the verified template on attach: strings as-is, other kinds as label and value", async () => {
    const { surface, midiOut, unresolved } = build();
    await surface.attach();

    expect(unresolved).toEqual([]);
    expect(lastLineText(midiOut, LINE_IDS.track)).toBe("Kick");
    expect(lastLineText(midiOut, LINE_IDS.effect)).toBe("Cutoff 2000 Hz");
    expect(lastLineText(midiOut, LINE_IDS.parameter)).toBe("Volume 0.50");
    expect(lastLineText(midiOut, LINE_IDS.transport)).toBe("Playing off");
    await surface.detach();
  });

  it("follows application state changes: a value change, then a selection change retargeting a from-selection role", async () => {
    const { surface, midiOut, context, cutoff, playing } = build();
    await surface.attach();

    cutoff.setValue(4000);
    playing.setValue(true);
    expect(lastLineText(midiOut, LINE_IDS.effect)).toBe("Cutoff 4000 Hz");
    expect(lastLineText(midiOut, LINE_IDS.transport)).toBe("Playing on");

    context.setSelection({ scope: "track", id: "2" });
    expect(lastLineText(midiOut, LINE_IDS.track)).toBe("Snare");
    await surface.detach();
  });

  it("sends nothing new when a change leaves a line's text the same, and blanks a from-selection role with no target", async () => {
    const { surface, midiOut, context, volume } = build();
    await surface.attach();
    const before = midiOut.sentMessages.length;

    volume.setValue(0.501); // still "Volume 0.50"
    expect(midiOut.sentMessages.length).toBe(before);

    context.setSelection({ scope: "track", id: "9" }); // no track.9.name
    expect(lastLineText(midiOut, LINE_IDS.track)).toBe("");
    await surface.detach();
  });

  it("binds only the roles the application names; the rest of the device's lines are left alone", async () => {
    const { surface, midiOut } = build({ track: { kind: "static", controlId: "track.1.name" } });
    await surface.attach();

    expect(lastLineText(midiOut, LINE_IDS.track)).toBe("Kick");
    expect(lastLineText(midiOut, LINE_IDS.effect)).toBeUndefined();
    await surface.detach();
  });

  it("is a no-op for a device that declares no display lines (the Launchpad)", () => {
    const portInfo = { name: "Launchpad", manufacturer: "Novation" };
    const input = createMidiInput(new MockMidiInput({ id: "in", type: "input", ...portInfo }));
    const { bindings, unresolved } = createSequencerBindings(input, LAUNCHPAD_MINI_MK3_PROFILE, {
      stepTemplate: "step.{row}.{column}",
      lengthControl: "steps.length",
      muteTemplate: "mute.{track}",
      actions: {},
      displayLines: { track: { kind: "static", controlId: "track.1.name" } },
    });
    expect(unresolved.filter((entry) => entry.startsWith("display"))).toEqual([]);
    expect(bindings.flatMap((definition) => definition.bindings).some((binding) => binding?.kind === "display")).toBe(false);
  });
});
