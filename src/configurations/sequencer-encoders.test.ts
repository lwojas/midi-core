import { describe, expect, it } from "vitest";
import { createControl } from "../control-api/control.js";
import { createSurfaceContext } from "../control-api/context.js";
import { createControlRegistry } from "../control-api/registry.js";
import type { NumericControlDef } from "../control-api/types/control.js";
import { MockMidiInput } from "../adapters/mock/mock-input.js";
import { MockMidiOutput } from "../adapters/mock/mock-output.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import { PUSH_MK1_PROFILE } from "../profile/devices/push-mk1.js";
import { LAUNCHPAD_MINI_MK3_PROFILE } from "../profile/devices/launchpad-mini-mk3.js";
import { generateControlMappings } from "../surface/generate.js";
import { createControlSurface } from "../surface/runtime.js";
import type { ModeBinding, SurfaceBindingTable } from "../surface/types/bindings.js";
import { createSequencerBindings, type SequencerContract } from "./sequencer.js";

/**
 * ECS-140, end to end: the Push mk1's generic parameter encoders (`encoder-1`/`encoder-2`/`encoder-3`, CC 71/72/73,
 * relative), through the surface runtime, each bound by `layout.encoders`' `"volume"`/`"send"`/`"effects"` roles to
 * whatever `SequencerContract.encoderParameters` resolves — representative-first: one role proven (volume), then
 * the same contract reused unchanged for two more.
 */

/**
 * The shipped Push profile gives encoder-1..8 to the generic encoder bank and so declares no fixed `encoders` roles
 * (a cell with both would have two targets). The fixed-role mechanism is still a supported generic feature, so it's
 * exercised here on a Push variant without the bank.
 */
const PUSH_FIXED_ROLES_PROFILE: DeviceProfile = {
  ...PUSH_MK1_PROFILE,
  layout: { ...PUSH_MK1_PROFILE.layout, encoderBank: undefined, encoders: { volume: "encoder-1", send: "encoder-2", effects: "encoder-3" } },
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function volumeDef(id: string, initial = 50): NumericControlDef {
  return { id, label: "Volume", kind: "number", min: 0, max: 100, default: 50 } satisfies NumericControlDef;
}

function build(options: { encoderParameters?: SequencerContract["encoderParameters"] } = {}) {
  const portInfo = { name: "Ableton Push", manufacturer: "Ableton" };
  const midiIn = new MockMidiInput({ id: "user-port-in", type: "input", ...portInfo });
  const midiOut = new MockMidiOutput({ id: "user-port-out", type: "output", ...portInfo });

  const track1Volume = createControl(volumeDef("track.1.volume"), 50);
  const track2Volume = createControl(volumeDef("track.2.volume"), 20);
  const track1Send = createControl(volumeDef("track.1.send"), 10);
  const track1Fx = createControl({ id: "track.1.fx.cutoff", label: "Cutoff", kind: "number", min: 0, max: 18000, default: 2000 }, 2000);
  const registry = createControlRegistry([track1Volume, track2Volume, track1Send, track1Fx]);
  const context = createSurfaceContext([{ scope: "track", id: "1" }]);

  const contract: SequencerContract = {
    stepTemplate: "step.{row}.{column}",
    lengthControl: "steps.length",
    muteTemplate: "mute.{track}",
    trackCountControl: "tracks.count",
    actions: {},
    encoderParameters: options.encoderParameters ?? {
      volume: { kind: "from-selection", scope: "track", template: "track.{id}.volume" },
      send: { kind: "from-selection", scope: "track", template: "track.{id}.send" },
      effects: { kind: "from-selection", scope: "track", template: "track.{id}.fx.cutoff" },
    },
  };
  const { bindings, unresolved } = createSequencerBindings(createMidiInput(midiIn), PUSH_FIXED_ROLES_PROFILE, contract);

  const surface = createControlSurface({
    profile: { ...PUSH_FIXED_ROLES_PROFILE, setup: undefined },
    ports: { inputs: { "user-port-in": createMidiInput(midiIn) }, outputs: { "user-port-out": createMidiOutput(midiOut) } },
    bindingTable: bindings,
    context,
    registry,
    generate: generateControlMappings,
    initialNavigation: { mode: "steps", gridOffset: { row: 0, column: 0 } },
  });

  const turn = async (controller: number, delta: 1 | -1) => {
    midiIn.emitRawMessage(new Uint8Array([0xb0, controller, delta === 1 ? 1 : 127]));
    await flush();
  };

  return { surface, unresolved, context, turn, track1Volume, track2Volume, track1Send, track1Fx, bindings };
}

function definitionOf(table: SurfaceBindingTable, mode: string) {
  const found = table.find((definition) => definition.mode === mode);
  if (!found) throw new Error(`no mode ${mode}`);
  return found;
}

function encoderBindingsOf(bindings: readonly ModeBinding[] | undefined) {
  return (bindings ?? []).filter((binding): binding is Extract<ModeBinding, { kind: "control" }> => binding.kind === "control" && binding.role.startsWith("encoder:"));
}

describe("ECS-140: the Push mk1's parameter encoders (CC 71-73), representative volume/send/effects roles", () => {
  it("resolves every role with no unresolved roles", () => {
    const { unresolved } = build();
    expect(unresolved).toEqual([]);
  });

  it("drives the currently selected track's volume via encoder-1 (CC 71), in both directions", async () => {
    const { surface, turn, track1Volume } = build();
    await surface.attach();

    await turn(71, 1);
    expect(track1Volume.getValue()).toBe(51);
    await turn(71, -1);
    await turn(71, -1);
    expect(track1Volume.getValue()).toBe(49);
    await surface.detach();
  });

  it("drives the representative send (encoder-2, CC 72) and effects (encoder-3, CC 73) roles through the same contract, unmodified", async () => {
    const { surface, turn, track1Send, track1Fx } = build();
    await surface.attach();

    await turn(72, 1);
    expect(track1Send.getValue()).toBe(11);

    await turn(73, 1);
    // track1Fx declares no `step`, so one detent moves it by the fallback 1% of its 0-18000 range (180), not a raw
    // delta of 1 — see relativeIncrement()'s own doc comment for why a fixed raw delta would be the wrong default
    // for a control this wide (and catastrophically wrong for a narrow one, like track volume).
    expect(track1Fx.getValue()).toBe(2180);
    await surface.detach();
  });

  it("retargets live when the application's current track selection changes, with no mode switch and no rebind", async () => {
    const { surface, turn, context, track1Volume, track2Volume } = build();
    await surface.attach();

    await turn(71, 1);
    expect(track1Volume.getValue()).toBe(51);

    context.setSelection({ scope: "track", id: "2" });
    await turn(71, 1);
    expect(track2Volume.getValue()).toBe(21);
    expect(track1Volume.getValue()).toBe(51); // untouched by the turn after retargeting
    await surface.detach();
  });

  it("has no binding, and reports no unresolved role, for a device-declared role the application's contract doesn't name", async () => {
    const { surface, turn, track1Send } = build({
      encoderParameters: { volume: { kind: "from-selection", scope: "track", template: "track.{id}.volume" } },
    });
    await surface.attach();

    await turn(72, 1); // encoder-2's own CC, now unbound
    expect(track1Send.getValue()).toBe(10); // unchanged
    await surface.detach();
  });

  it("is available in every sequencer mode (steps, mixer, transport), not just one", () => {
    const { bindings } = build();
    for (const mode of ["steps", "mixer", "transport"] as const) {
      const roles = encoderBindingsOf(definitionOf(bindings, mode).bindings).map((binding) => binding.role);
      expect(roles).toEqual(["encoder: volume", "encoder: send", "encoder: effects"]);
    }
  });

  it("builds no encoder bindings for a device whose profile declares no layout.encoders (the Launchpad)", () => {
    const input = createMidiInput(new MockMidiInput({ id: "in", type: "input", name: "in", manufacturer: null }));
    const { bindings, unresolved } = createSequencerBindings(input, LAUNCHPAD_MINI_MK3_PROFILE, {
      stepTemplate: "step.{row}.{column}",
      lengthControl: "steps.length",
      muteTemplate: "mute.{track}",
      actions: {},
      encoderParameters: { volume: { kind: "from-selection", scope: "track", template: "track.{id}.volume" } },
    });
    expect(encoderBindingsOf(definitionOf(bindings, "steps").bindings)).toEqual([]);
    expect(unresolved).toEqual([]);
  });
});
