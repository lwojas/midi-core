// The demo's Launchpad sequencer: a plain application (Controls and Actions, no MIDI) plus the surface wiring.
// The device configuration lives in midi-core (src/configurations), so this file only names the application's
// controls and actions. Transport-agnostic: it only ever sees MidiInput/MidiOutput.
import { createAction, createControl, createControlRegistry, createSurfaceContext } from "../dist/control-api/index.js";
import { LAUNCHPAD_MINI_MK3_PROFILE } from "../dist/profile/index.js";
import { createLaunchpadSequencerBindings } from "../dist/configurations/index.js";
import { createControlSurface, generateControlMappings } from "../dist/surface/index.js";

export const STEP_ROWS = 8;
export const STEP_COLUMNS = 32; // four pages of eight

const CONTRACT = {
  stepTemplate: "step.{row}.{column}",
  lengthControl: "steps.length",
  muteTemplate: "mute.{track}",
};

export function createLaunchpadApp({ onChange = () => {} } = {}) {
  const steps = new Map();
  for (let row = 0; row < STEP_ROWS; row++) {
    for (let column = 0; column < STEP_COLUMNS; column++) {
      const id = `step.${row}.${column}`;
      steps.set(id, createControl({ id, label: `Step ${row},${column}`, kind: "boolean", default: false }));
    }
  }
  const mutes = new Map();
  for (let track = 1; track <= 8; track++) {
    const id = `mute.${track}`;
    mutes.set(id, createControl({ id, label: `Mute ${track}`, kind: "boolean", default: false }));
  }
  const length = createControl({ id: CONTRACT.lengthControl, label: "Sequence length", kind: "number", min: 0, max: 64, default: STEP_COLUMNS });

  const transport = { status: "stopped" };
  const setStatus = (status) => {
    transport.status = status;
    onChange("transport", status);
  };
  const actions = {
    play: createAction({ id: "transport.play", label: "Play" }, () => setStatus("playing")),
    stop: createAction({ id: "transport.stop", label: "Stop" }, () => setStatus("stopped")),
    record: createAction({ id: "transport.record", label: "Record" }, () => setStatus("recording")),
    clear: createAction({ id: "transport.clear", label: "Clear" }, () => setStatus("cleared")),
  };
  const litSteps = () => [...steps.values()].filter((control) => control.getValue()).length;
  for (const control of steps.values()) control.onChange(() => onChange("steps", litSteps()));
  return {
    steps,
    mutes,
    length,
    transport,
    actions,
    litSteps,
    setAllSteps(on) {
      for (const control of steps.values()) control.setValue(on);
    },
  };
}

/** Builds the surface for one connected input/output pair. `log` receives human-readable lines. */
export function createLaunchpadSurface({ input, output, app, log = () => {} }) {
  const registry = createControlRegistry([...app.steps.values(), ...app.mutes.values(), app.length]);
  const surface = createControlSurface({
    profile: LAUNCHPAD_MINI_MK3_PROFILE,
    ports: { inputs: { "midi-in": input }, outputs: { "midi-out": output } },
    bindingTable: createLaunchpadSequencerBindings(input, { ...CONTRACT, actions: app.actions }),
    context: createSurfaceContext(),
    registry,
    generate: generateControlMappings,
    initialNavigation: { mode: "steps", gridOffset: { row: 0, column: 0 } },
  });

  surface.onStateChange((change) => log(`surface: ${change.from} -> ${change.to}`));
  surface.onError((e) => log(`surface error [${e.code}]: ${e.message}`));
  surface.navigation.onChange((change) => {
    if (change.from.mode !== change.to.mode) log(`mode: ${change.from.mode} -> ${change.to.mode}`);
    else if (change.from.gridOffset?.column !== change.to.gridOffset?.column) log(`page: first step ${change.to.gridOffset?.column ?? 0}`);
  });

  return {
    surface,
    attach: () => surface.attach(),
    detach: () => surface.detach(),
  };
}
