import { describe, expect, it } from "vitest";
import { createAction } from "../control-api/action.js";
import { createControl } from "../control-api/control.js";
import { createControlRegistry } from "../control-api/registry.js";
import { createSurfaceContext } from "../control-api/context.js";
import { createSurfaceEventSource } from "../control-api/event.js";
import type { Action } from "../control-api/types/action.js";
import type { BooleanControlDef, Control, EnumControlDef, NumericControlDef } from "../control-api/types/control.js";
import type { EmittableSurfaceEventSource } from "../control-api/event.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import type { MidiInput } from "../core/types/input.js";
import type { MidiOutput } from "../core/types/output.js";
import { MOCK_SURFACE_BUTTONS, MOCK_SURFACE_KNOBS, MOCK_SURFACE_PADS } from "../profile/generic/mock-surface-profile.js";
import type { Unsubscribe } from "../core/types/discovery.js";
import { createMockSurfaceDevice } from "../testing/mock-surface-device.js";
import { createMockSurfaceHarness } from "../testing/mock-surface-harness.js";
import { bindActionTrigger } from "./action-binding.js";
import { bindEventFeedback } from "./event-feedback.js";
import { generateControlMappings, toMidiSource, toMidiTarget } from "./generate.js";
import { createControlSurface, type ControlSurfaceDeps } from "./runtime.js";
import type { SurfaceBindingTable } from "./types/bindings.js";

/**
 * ECS-77: the mock-validation gate before real sequencer integration
 * (ECS-78) and hardware validation (ECS-79). Everything below is built
 * from pieces ECS-69–76 already shipped; this ticket's job is proving
 * they compose into one working `ControlSurface` against one real
 * profile (the generic mock surface device, ECS-71) across all three
 * named modes, with no new production code of its own.
 *
 * `createFakeSequencer()` is this test's entire "application" — every
 * field on it is a plain `Control`/`Action`/`SurfaceEventSource`
 * (ECS-70). It imports nothing from `core`, `mapping`, or `profile`:
 * no MIDI/device-specific code in application logic, per the ticket.
 */
function createFakeSequencer() {
  const tracks: Control<NumericControlDef>[] = MOCK_SURFACE_KNOBS.map((_, i) =>
    createControl<NumericControlDef>({ id: `track.${i + 1}.volume`, label: `Track ${i + 1} Volume`, kind: "number", min: 0, max: 127, default: 0 }),
  );
  const steps: Control<BooleanControlDef>[] = MOCK_SURFACE_PADS.map((_, i) =>
    createControl<BooleanControlDef>({ id: `pattern.1.step.${i + 1}`, label: `Step ${i + 1}`, kind: "boolean", default: false }),
  );
  const statusDef: EnumControlDef = {
    id: "transport.status",
    label: "Status",
    kind: "enum",
    options: [
      { label: "Stopped", value: "stopped" },
      { label: "Playing", value: "playing" },
      { label: "Recording", value: "recording" },
    ],
    default: "stopped",
  };
  const status = createControl(statusDef);
  const playhead: EmittableSurfaceEventSource = createSurfaceEventSource();

  let currentStep = 0;
  const play: Action = createAction({ id: "transport.play", label: "Play" }, () => status.setValue("playing"));
  const stop: Action = createAction({ id: "transport.stop", label: "Stop" }, () => {
    status.setValue("stopped");
    currentStep = 0;
  });
  const record: Action = createAction({ id: "transport.record", label: "Record" }, () => status.setValue("recording"));

  return {
    tracks,
    steps,
    status,
    play,
    stop,
    record,
    playhead,
    registry: createControlRegistry([...tracks, ...steps, status]),
    /** Simulates one playback tick advancing the (test-driven) playhead — no timers, so the test stays deterministic. */
    advanceOneStep(): number {
      currentStep = (currentStep % steps.length) + 1;
      playhead.emit({ id: "transport.tick", payload: { step: currentStep } });
      return currentStep;
    },
  };
}

/**
 * Builds the one `SurfaceBindingTable` this validation uses across all
 * three modes, against the mock device's real `input`/`output` and the
 * fake sequencer's `Action`s/`SurfaceEventSource`. `transport`'s
 * button-to-`Action` wiring and `step-grid`'s playhead feedback both use
 * `hooks.onEnter`/`onExit` — exactly the escape valve
 * `docs/contracts/surface-bindings.md` (ECS-68) named for "a declarative
 * binding has no field for," since `ModeBinding` has no action- or
 * event-driven kind (ECS-74/73 both deliberately kept those standalone).
 */
function buildBindingTable(input: MidiInput, output: MidiOutput, sequencer: ReturnType<typeof createFakeSequencer>): SurfaceBindingTable {
  let unbindActions: Unsubscribe[] = [];
  let unbindPlayhead: Unsubscribe | undefined;

  return [
    {
      mode: "mixer",
      bindings: MOCK_SURFACE_KNOBS.map((knob, i) => ({
        physicalControlId: knob.id,
        role: "track-fader",
        kind: "control" as const,
        resolve: { kind: "static" as const, controlId: `track.${i + 1}.volume` },
      })),
    },
    {
      mode: "transport",
      bindings: [],
      hooks: {
        onEnter: () => {
          const [playButton, stopButton, recordButton] = MOCK_SURFACE_BUTTONS;
          unbindActions = [
            bindActionTrigger(input, toMidiSource(playButton!)!, sequencer.play),
            bindActionTrigger(input, toMidiSource(stopButton!)!, sequencer.stop),
            bindActionTrigger(input, toMidiSource(recordButton!)!, sequencer.record),
          ];
        },
        onExit: () => {
          for (const unbind of unbindActions) unbind();
          unbindActions = [];
        },
      },
    },
    {
      mode: "step-grid",
      bindings: MOCK_SURFACE_PADS.map((pad, i) => ({
        physicalControlId: pad.id,
        role: "step",
        kind: "control" as const,
        resolve: { kind: "static" as const, controlId: `pattern.1.step.${i + 1}` },
      })),
      hooks: {
        onEnter: () => {
          unbindPlayhead = bindEventFeedback(
            sequencer.playhead,
            (event) => {
              if (event.id !== "transport.tick") return undefined;
              const { step } = event.payload as { step: number };
              const pad = MOCK_SURFACE_PADS[step - 1];
              const target = pad && toMidiTarget(pad);
              if (!target || target.address.type !== "note") return undefined;
              // One lit pad per tick, no unlight-the-previous-one sequencing --
              // full chase-light logic is sequencer behavior, out of scope here
              // (see docs/contracts/application-surface-feedback.md).
              return { type: "note-on", channel: target.channel, note: target.address.note, velocity: 127 };
            },
            output,
          );
        },
        onExit: () => {
          unbindPlayhead?.();
          unbindPlayhead = undefined;
        },
      },
    },
  ];
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ECS-77: minimal surface validated against the generic mock device", () => {
  it("demonstrates Mixer, Transport and Step Grid sharing one profile, bidirectional updates, and clean lifecycle teardown", async () => {
    const device = createMockSurfaceDevice();
    const harness = createMockSurfaceHarness(device);
    const input = createMidiInput(device.input);
    const output = createMidiOutput(device.output);
    const sequencer = createFakeSequencer();

    const deps: ControlSurfaceDeps = {
      profile: device.profile,
      ports: { inputs: { "main-in": input }, outputs: { "main-out": output } },
      bindingTable: buildBindingTable(input, output, sequencer),
      context: createSurfaceContext(),
      registry: sequencer.registry,
      generate: generateControlMappings,
      initialNavigation: { mode: "mixer" },
    };

    const surface = createControlSurface(deps);
    await surface.attach();
    expect(surface.state).toBe("attached");

    // --- Mixer: eight controls -> eight track volumes ---
    MOCK_SURFACE_KNOBS.forEach((knob, i) => {
      const value = (i + 1) * 10;
      harness.turnKnob(knob.id, value);
      expect(sequencer.tracks[i]!.getValue()).toBe(value);
    });
    // Every track volume is independent -- turning knob-1 didn't touch track 8.
    expect(sequencer.tracks[7]!.getValue()).toBe(80);

    // --- Switch to Transport: buttons -> play/stop/record ---
    surface.navigation.setMode("transport");
    await flushMicrotasks();

    harness.press("button-1");
    expect(sequencer.status.getValue()).toBe("playing");
    harness.press("button-3");
    expect(sequencer.status.getValue()).toBe("recording");
    harness.press("button-2");
    expect(sequencer.status.getValue()).toBe("stopped");

    // Mixer's bindings are gone now -- the same physical knob no longer drives anything.
    harness.turnKnob("knob-1", 5);
    expect(sequencer.tracks[0]!.getValue()).toBe(10);

    // --- Switch to Step Grid: grid -> steps, feedback <- active step state/playhead ---
    surface.navigation.setMode("step-grid");
    await flushMicrotasks();

    // Transport's bindings are gone now -- the same physical button no longer invokes anything.
    harness.press("button-1");
    expect(sequencer.status.getValue()).toBe("stopped");

    MOCK_SURFACE_PADS.forEach((pad, i) => {
      harness.press(pad.id);
      expect(sequencer.steps[i]!.getValue()).toBe(true);
      // No fresh feedback here: ECS-57's echo suppression correctly withholds it --
      // this step's new value just arrived via this same pad's own press, so
      // bindControlMapping() recognizes its own just-made change and doesn't
      // echo it straight back out. See docs/contracts/mapping-runtime.md.
    });

    // Active-step feedback: the application (not a MIDI echo) turns a step off directly --
    // the UI-must-not-mediate case ECS-73 already established, confirmed here for pads too.
    sequencer.steps[0]!.setValue(false);
    expect(harness.lastFeedbackFor(MOCK_SURFACE_PADS[0]!.id)).toMatchObject({ type: "note-off" });

    // Playhead: a SurfaceEvent, driven by the application, lighting the current step's pad.
    const step = sequencer.advanceOneStep();
    expect(harness.lastFeedbackFor(MOCK_SURFACE_PADS[step - 1]!.id)).toMatchObject({ type: "note-on", velocity: 127 });

    // --- Back to Mixer: the same profile, a full cycle, not a one-shot transition ---
    surface.navigation.setMode("mixer");
    await flushMicrotasks();

    harness.turnKnob("knob-1", 42);
    expect(sequencer.tracks[0]!.getValue()).toBe(42);

    // --- Lifecycle cleanup ---
    await surface.detach();
    expect(surface.state).toBe("detached");
    expect(device.input.state).toBe("disconnected");

    harness.turnKnob("knob-1", 99);
    expect(sequencer.tracks[0]!.getValue()).toBe(42); // unbound: no longer tracked after detach
  });
});
