import { describe, expect, it } from "vitest";
import { createAction } from "../control-api/action.js";
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
 * Phase 2: the Push mk1's 8 generic parameter encoders, through the surface runtime, windowed onto the currently
 * active 8-track page of `track.{track}.volume` controls via `layout.encoderBank` -- unlike ECS-140's
 * `encoders`/`encoderParameters` (one encoder, one fixed role, re-targeted by *selection*), this is 8 encoders at
 * once, re-targeted by *page*, reusing the exact same page offset Arrow Up/Down already move for the step grid
 * and the mute/selection strips.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function volumeDef(id: string): NumericControlDef {
  return { id, label: "Volume", kind: "number", min: 0, max: 100, default: 50 } satisfies NumericControlDef;
}

function build(trackCount = 16) {
  const portInfo = { name: "Ableton Push", manufacturer: "Ableton" };
  const midiIn = new MockMidiInput({ id: "user-port-in", type: "input", ...portInfo });
  const midiOut = new MockMidiOutput({ id: "user-port-out", type: "output", ...portInfo });

  const volumes = Array.from({ length: trackCount }, (_, i) => createControl(volumeDef(`track.${i + 1}.volume`), 50));
  const encoderMode = createControl({ id: "encoder.mode", label: "Encoder bank mode", kind: "number", min: 0, max: 1, default: 0 } satisfies NumericControlDef, 0);
  const registry = createControlRegistry([...volumes, encoderMode]);
  const context = createSurfaceContext([]);

  const contract: SequencerContract = {
    stepTemplate: "step.{row}.{column}",
    lengthControl: "steps.length",
    muteTemplate: "mute.{track}",
    trackCountControl: "tracks.count",
    actions: {},
    encoderBankTemplates: { volume: "track.{track}.volume" },
    encoderBankModeControl: "encoder.mode",
    encoderBankModes: { volume: 0, devices: 1 },
    encoderBankModeActions: {
      volume: createAction({ id: "encoder-mode.volume", label: "Volume" }, () => encoderMode.setValue(0)),
      devices: createAction({ id: "encoder-mode.devices", label: "Devices" }, () => encoderMode.setValue(1)),
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

  const turn = async (controller: number, delta: 1 | -1) => {
    midiIn.emitRawMessage(new Uint8Array([0xb0, controller, delta === 1 ? 1 : 127]));
    await flush();
  };
  const press = async (controller: number) => {
    midiIn.emitRawMessage(new Uint8Array([0xb0, controller, 127]));
    await flush();
    midiIn.emitRawMessage(new Uint8Array([0xb0, controller, 0]));
    await flush();
  };

  return { surface, unresolved, turn, press, volumes, encoderMode };
}

const ENCODER_CCS = [71, 72, 73, 74, 75, 76, 77, 78];
const ARROW_DOWN_CC = 47; // pages tracks forward (steps mode, vertical)
const ARROW_UP_CC = 46;
const VOLUME_MODE_CC = 114; // button-volume
const DEVICES_MODE_CC = 110; // button-devices

describe("Phase 2: the Push mk1's encoder bank (CC71-78) windowed onto track.{track}.volume", () => {
  it("resolves every role with no unresolved roles", () => {
    const { unresolved } = build();
    expect(unresolved).toEqual([]);
  });

  it("maps encoders 1-8 to tracks 1-8 of the active bank, in both directions", async () => {
    const { surface, turn, volumes } = build();
    await surface.attach();

    await turn(ENCODER_CCS[0]!, 1);
    expect(volumes[0]!.getValue()).toBe(51);
    await turn(ENCODER_CCS[7]!, 1);
    expect(volumes[7]!.getValue()).toBe(51);
    await turn(ENCODER_CCS[0]!, -1);
    expect(volumes[0]!.getValue()).toBe(50);
    await surface.detach();
  });

  it("pages the whole bank forward on Arrow Down, re-targeting all 8 encoders to tracks 9-16", async () => {
    const { surface, press, turn, volumes } = build();
    await surface.attach();

    await press(ARROW_DOWN_CC);
    await turn(ENCODER_CCS[0]!, 1);
    expect(volumes[8]!.getValue()).toBe(51); // track 9
    expect(volumes[0]!.getValue()).toBe(50); // track 1, untouched

    await turn(ENCODER_CCS[7]!, 1);
    expect(volumes[15]!.getValue()).toBe(51); // track 16
    await surface.detach();
  });

  it("pages back on Arrow Up, restoring the original assignments", async () => {
    const { surface, press, turn, volumes } = build();
    await surface.attach();

    await press(ARROW_DOWN_CC);
    await press(ARROW_UP_CC);
    await turn(ENCODER_CCS[0]!, 1);
    expect(volumes[0]!.getValue()).toBe(51);
    await surface.detach();
  });

  it("does not drive any track past the end of a short bank", async () => {
    const { surface, press, turn, volumes } = build(10);
    await surface.attach();

    await press(ARROW_DOWN_CC);
    await turn(ENCODER_CCS[7]!, 1); // would be track 16, which doesn't exist
    for (const volume of volumes) expect(volume.getValue()).toBe(50);
    await surface.detach();
  });

  it("switches to Devices mode on CC110, which stops the bank driving track volumes", async () => {
    const { surface, press, turn, volumes, encoderMode } = build();
    await surface.attach();

    await press(DEVICES_MODE_CC);
    expect(encoderMode.getValue()).toBe(1);
    await turn(ENCODER_CCS[0]!, 1);
    expect(volumes[0]!.getValue()).toBe(50); // unchanged -- gated off
    await surface.detach();
  });

  it("returning to Volume mode (CC114) restores the bank's correct assignments, with the underlying page untouched", async () => {
    const { surface, press, turn, volumes, encoderMode } = build();
    await surface.attach();

    await press(ARROW_DOWN_CC); // bank moves to tracks 9-16
    await press(DEVICES_MODE_CC); // switch away -- must not disturb the page
    await turn(ENCODER_CCS[0]!, 1);
    expect(volumes[8]!.getValue()).toBe(50); // gated off, track 9 untouched

    await press(VOLUME_MODE_CC);
    expect(encoderMode.getValue()).toBe(0);
    await turn(ENCODER_CCS[0]!, 1);
    expect(volumes[8]!.getValue()).toBe(51); // track 9 again, not track 1 -- the page survived the mode switch
    await surface.detach();
  });
});
