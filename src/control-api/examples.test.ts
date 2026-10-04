import { describe, expect, it, vi } from "vitest";
import { createAction } from "./action.js";
import { createControl } from "./control.js";
import { createControlRegistry } from "./registry.js";
import { createSurfaceContext } from "./context.js";
import { createSurfaceEventSource } from "./event.js";
import type { BooleanControlDef, EnumControlDef, NumericControlDef } from "./types/control.js";

/**
 * ECS-70's own required proof set, straight from
 * `docs/contracts/control-api.md`'s examples table: transport, track
 * volume, step state and playhead, built from nothing but this file's
 * generic factories. No MIDI, no device, no sequencer internals — proving
 * the factories are sufficient for what the mock-device/sequencer
 * validation tickets (ECS-77/78) will eventually wire for real.
 */
describe("the proof's required examples, composed from the generic factories", () => {
  it("transport: an Action to play, and a Control<EnumControlDef> reporting status", () => {
    const status: EnumControlDef = {
      id: "transport.status",
      label: "Playback status",
      kind: "enum",
      options: [
        { label: "Stopped", value: "stopped" },
        { label: "Playing", value: "playing" },
      ],
      default: "stopped",
    };
    const statusControl = createControl(status);
    const play = createAction({ id: "transport.play", label: "Play" }, () => statusControl.setValue("playing"));

    play.invoke();

    expect(statusControl.getValue()).toBe("playing");
  });

  it("track volume: a Control<NumericControlDef>, registered and resolvable by ControlId", () => {
    const def: NumericControlDef = { id: "track.1.volume", label: "Volume", kind: "number", min: 0, max: 1, default: 0.8 };
    const volume = createControl(def);
    const registry = createControlRegistry([volume]);

    registry.getControl("track.1.volume")!.setValue(0.5);

    expect(volume.getValue()).toBe(0.5);
  });

  it("step state: a Control<BooleanControlDef> per step, independent of any other step", () => {
    const stepDef: BooleanControlDef = { id: "pattern.1.step.3", label: "Step 3", kind: "boolean", default: false };
    const step = createControl(stepDef);
    const otherStepDef: BooleanControlDef = { id: "pattern.1.step.4", label: "Step 4", kind: "boolean", default: false };
    const otherStep = createControl(otherStepDef);

    step.setValue(true);

    expect(step.getValue()).toBe(true);
    expect(otherStep.getValue()).toBe(false);
  });

  it("playhead: a SurfaceEventSource reporting each tick, not a polled value", () => {
    const playhead = createSurfaceEventSource();
    const chaseLight = vi.fn();
    playhead.onEvent(chaseLight);

    playhead.emit({ id: "transport.tick", payload: { step: 7 } });

    expect(chaseLight).toHaveBeenCalledWith({ id: "transport.tick", payload: { step: 7 } });
  });

  it("selected track: SurfaceContext resolving which track.N.volume a 'track fader' role currently means", () => {
    const context = createSurfaceContext();
    const track1Volume = createControl<NumericControlDef>({ id: "track.1.volume", label: "Volume", kind: "number", min: 0, max: 1, default: 0.8 });
    const track2Volume = createControl<NumericControlDef>({ id: "track.2.volume", label: "Volume", kind: "number", min: 0, max: 1, default: 0.3 });
    const registry = createControlRegistry([track1Volume, track2Volume]);

    context.setSelection({ scope: "track", id: "2" });
    const selected = context.getSelection("track")!;
    const resolved = registry.getControl(`track.${selected.id}.volume`);

    expect(resolved).toBe(track2Volume);
  });
});
