// The demo's Launchpad sequencer: a plain application (Controls and Actions, no MIDI) plus the surface wiring.
// The device configuration lives in midi-core (src/configurations), so this file only names the application's
// controls and actions. Transport-agnostic: it only ever sees MidiInput/MidiOutput.
import { createAction, createControl, createControlRegistry, createSurfaceContext } from "../dist/control-api/index.js";
import { createSequencerBindings } from "../dist/configurations/index.js";
import { DEVICE_REGISTRY } from "../dist/devices/index.js";
import { createControlSurface, generateControlMappings } from "../dist/surface/index.js";

export const STEP_ROWS = 16; // one row per track: two pages of eight
export const STEP_COLUMNS = 32; // four pages of eight

const CONTRACT = {
  stepTemplate: "step.{row}.{column}",
  lengthControl: "steps.length",
  muteTemplate: "mute.{track}",
  trackCountControl: "tracks.count",
  // ECS-96: each fader's application control, by bank and fader position (0-7). The demo's controls are 0-127.
  faderTemplates: { volume: "mixer.volume.{index}", pan: "mixer.pan.{index}", send: "mixer.send.{index}" },
};

export const FADER_BANKS = ["volume", "pan", "send"];

export function createLaunchpadApp({ onChange = () => {} } = {}) {
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

  // ECS-96: the mixer faders' controls, one per bank and position. Values are 0-127, the device's own range.
  const faders = new Map();
  for (const bank of FADER_BANKS) {
    for (let index = 0; index < 8; index++) {
      const id = `mixer.${bank}.${index}`;
      faders.set(id, createControl({ id, label: `${bank} ${index + 1}`, kind: "number", min: 0, max: 127, default: 64 }));
    }
  }

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
    faders,
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

/**
 * Builds the surface for one connected input/output pair. `daw` is the optional DAW port pair (ECS-96): when given, the
 * mixer's fader modes are available, and without it the Launchpad has no fader modes. `log` receives human-readable lines.
 */
export function createLaunchpadSurface({ input, output, app, daw, log = () => {} }) {
  const registry = createControlRegistry([...app.steps.values(), ...app.mutes.values(), ...app.faders.values(), app.length, app.trackCount]);
  const device = DEVICE_REGISTRY.find((entry) => entry.id === "novation.launchpad-mini-mk3");
  const devices = daw
    ? {
        outputs: { "midi-out": output, "daw-out": daw.output },
        inputs: { "daw-in": daw.input },
        connectedPortIds: ["midi-in", "midi-out", "daw-in", "daw-out"],
      }
    : { outputs: { "midi-out": output }, inputs: {}, connectedPortIds: ["midi-in", "midi-out"] };
  const sequencer = createSequencerBindings(input, device.profile, { ...CONTRACT, actions: app.actions }, devices);
  for (const role of sequencer.unresolved) log(`unresolved: ${role}`);
  const surface = createControlSurface({
    profile: device.profile,
    ports: {
      inputs: { "midi-in": input, ...(daw ? { "daw-in": daw.input } : {}) },
      outputs: { "midi-out": output, ...(daw ? { "daw-out": daw.output } : {}) },
    },
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
