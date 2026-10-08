// The demo's Push mk1 sequencer: a plain application (Controls and Actions, no MIDI) plus the surface wiring.
// Mirrors demo/launchpad-surface.js; no DAW ports or fader modes, since Push mk1's profile declares none (ECS-91).
import { createAction, createControl, createControlRegistry, createSurfaceContext } from "../dist/control-api/index.js";
import { createSequencerBindings } from "../dist/configurations/index.js";
import { DEVICE_REGISTRY } from "../dist/devices/index.js";
import { createControlSurface, generateControlMappings } from "../dist/surface/index.js";

export const STEP_ROWS = 16; // two pages of eight tracks
export const STEP_COLUMNS = 16; // two pages of eight beats

const CONTRACT = {
  stepTemplate: "step.{row}.{column}",
  lengthControl: "steps.length",
  muteTemplate: "mute.{track}",
  trackCountControl: "tracks.count",
};

export function createPushMk1App({ onChange = () => {} } = {}) {
  const steps = new Map();
  for (let row = 0; row < STEP_ROWS; row++) {
    for (let column = 0; column < STEP_COLUMNS; column++) {
      const id = `step.${row}.${column}`;
      steps.set(id, createControl({ id, label: `Step ${row},${column}`, kind: "boolean", default: false }));
    }
  }
  const mutes = new Map();
  for (let track = 1; track <= STEP_ROWS; track++) {
    const id = `mute.${track}`;
    mutes.set(id, createControl({ id, label: `Mute ${track}`, kind: "boolean", default: false }));
  }
  const length = createControl({ id: CONTRACT.lengthControl, label: "Sequence length", kind: "number", min: 0, max: 64, default: STEP_COLUMNS });
  const trackCount = createControl({ id: CONTRACT.trackCountControl, label: "Track count", kind: "number", min: 0, max: 64, default: STEP_ROWS });

  const transport = { status: "stopped" };
  const setStatus = (status) => {
    transport.status = status;
    onChange("transport", status);
  };
  const actions = {
    play: createAction({ id: "transport.play", label: "Play" }, () => setStatus("playing")),
    record: createAction({ id: "transport.record", label: "Record" }, () => setStatus("recording")),
  };
  const litSteps = () => [...steps.values()].filter((control) => control.getValue()).length;
  for (const control of steps.values()) control.onChange(() => onChange("steps", litSteps()));
  return {
    steps,
    mutes,
    length,
    trackCount,
    transport,
    actions,
    litSteps,
    setAllSteps(on) {
      for (const control of steps.values()) control.setValue(on);
    },
  };
}

/** Builds the surface for one connected input/output pair. `log` receives human-readable lines. */
export function createPushMk1Surface({ input, output, app, log = () => {} }) {
  const registry = createControlRegistry([...app.steps.values(), ...app.mutes.values(), app.length, app.trackCount]);
  const device = DEVICE_REGISTRY.find((entry) => entry.id === "ableton.push-mk1");
  const sequencer = createSequencerBindings(input, device.profile, { ...CONTRACT, actions: app.actions });
  for (const role of sequencer.unresolved) log(`unresolved: ${role}`);
  const surface = createControlSurface({
    profile: device.profile,
    ports: { inputs: { "user-port-in": input }, outputs: { "user-port-out": output } },
    bindingTable: sequencer.bindings,
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
