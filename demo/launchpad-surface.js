// The Launchpad Mini MK3 surface configuration, shared by the browser demo (demo/launchpad.js) and the
// Node live-run script (scripts/launchpad-live.mjs). Transport-agnostic: it only ever sees MidiInput/MidiOutput.
// The binding table is surface configuration, not sequencer code: the application here exposes plain Controls
// and Actions, and this module decides which device control means what in each mode (ECS-89).
import { createAction, createControl, createControlRegistry, createSurfaceContext, createSurfaceEventSource } from "../dist/control-api/index.js";
import { LAUNCHPAD_MINI_MK3_PADS, LAUNCHPAD_MINI_MK3_PROFILE } from "../dist/profile/index.js";
import { bindActionTrigger, bindEventFeedback, createControlSurface, generateControlMappings, toMidiSource } from "../dist/surface/index.js";

export const STEP_ROWS = 8;
export const STEP_COLUMNS = 32; // four pages of eight
const PAGE_COLUMNS = 8;

const padNotes = new Set(LAUNCHPAD_MINI_MK3_PADS.map((pad) => pad.input.address.note));
const padRowColumn = (note) => ({ row: 8 - Math.floor(note / 10), column: (note % 10) - 1 }); // row 1..8 from bottom, col 1..8
const topButton = (controller) => toMidiSource(LAUNCHPAD_MINI_MK3_PROFILE.controls.find((c) => c.id === `top-${controller}`));
const sideButtonId = (controller) => `side-${controller}`;

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
    transport,
    actions,
    litSteps,
    setAllSteps(on) {
      for (const control of steps.values()) control.setValue(on);
    },
  };
}

/** The mode a device button selects, and the bindings each mode installs. Mode buttons work from every mode. */
const MODE_BUTTONS = [
  { controller: 89, mode: "steps" },
  { controller: 79, mode: "mixer" },
  { controller: 69, mode: "transport" },
];

function modeButtonBindings() {
  return MODE_BUTTONS.map(({ controller, mode }) => ({
    kind: "navigate",
    physicalControlId: sideButtonId(controller),
    role: `mode: ${mode}`,
    navigate: { kind: "set-mode", mode },
  }));
}

function stepBindings() {
  return [
    ...LAUNCHPAD_MINI_MK3_PADS.map((pad) => {
      const { row, column } = padRowColumn(pad.input.address.note);
      return { kind: "window", physicalControlId: pad.id, role: `step ${row},${column}`, gridId: "pads", template: "step.{row}.{column}" };
    }),
    { kind: "navigate", physicalControlId: "top-95", role: "page left", navigate: { kind: "page-by", delta: { row: 0, column: -PAGE_COLUMNS } } },
    { kind: "navigate", physicalControlId: "top-96", role: "page right", navigate: { kind: "page-by", delta: { row: 0, column: PAGE_COLUMNS } } },
  ];
}

function mixerBindings() {
  // Top pad row (notes 81-88) mutes tracks 1-8.
  return LAUNCHPAD_MINI_MK3_PADS.filter((pad) => padRowColumn(pad.input.address.note).row === 8)
    .map((pad) => {
      const { column } = padRowColumn(pad.input.address.note);
      return { kind: "control", physicalControlId: pad.id, role: `mute ${column + 1}`, resolve: { kind: "static", controlId: `mute.${column + 1}` } };
    });
}

/**
 * Builds the surface for one connected input/output pair. `log` receives human-readable lines.
 * Returns { surface, attach, detach }. attach/detach wrap the surface plus the pad-press LED policy.
 */
export function createLaunchpadSurface({ input, output, app, log = () => {} }) {
  const registry = createControlRegistry([...app.steps.values(), ...app.mutes.values()]);
  let transportUnbinds = [];
  const pressEvents = createSurfaceEventSource();
  let pressUnbinds = [];

  // Press-light policy for the pad-driven modes: the surface withholds feedback for values it just received
  // (echo suppression) and Programmer-mode pads don't self-light, so the app lights a pressed pad and restores
  // it on release. Release restores from the control the pad drives in the current mode.
  function lightStateOf(note) {
    const mode = surface.navigation.state.mode;
    const { row, column } = padRowColumn(note);
    if (mode === "steps") {
      const offset = surface.navigation.state.gridOffset ?? { row: 0, column: 0 };
      return app.steps.get(`step.${row + offset.row}.${column + offset.column}`)?.getValue() ?? false;
    }
    if (mode === "mixer" && row === 8) return app.mutes.get(`mute.${column + 1}`)?.getValue() ?? false;
    return false;
  }

  function encodeLed(event) {
    const note = event.payload.note;
    if (event.id === "pad.press") return { type: "note-on", channel: 0, note, velocity: 127 };
    if (event.id === "pad.release") {
      return lightStateOf(note)
        ? { type: "note-on", channel: 0, note, velocity: 127 }
        : { type: "note-off", channel: 0, note, velocity: 0 };
    }
    return undefined;
  }

  const surface = createControlSurface({
    profile: LAUNCHPAD_MINI_MK3_PROFILE,
    ports: { inputs: { "midi-in": input }, outputs: { "midi-out": output } },
    bindingTable: [
      {
        mode: "steps",
        bindings: [...modeButtonBindings(), ...stepBindings()],
        activateOn: { scope: "step" },
      },
      {
        mode: "mixer",
        bindings: [...modeButtonBindings(), ...mixerBindings()],
        activateOn: { scope: "track" },
      },
      {
        mode: "transport",
        bindings: modeButtonBindings(),
        hooks: {
          onEnter: () => {
            transportUnbinds = [
              bindActionTrigger(input, topButton(91), app.actions.play),
              bindActionTrigger(input, topButton(92), app.actions.stop),
              bindActionTrigger(input, topButton(93), app.actions.record),
              bindActionTrigger(input, topButton(94), app.actions.clear),
            ];
          },
          onExit: () => {
            for (const unbind of transportUnbinds) unbind();
            transportUnbinds = [];
          },
        },
      },
    ],
    context: createSurfaceContext(),
    registry,
    generate: generateControlMappings,
    initialNavigation: { mode: "steps", gridOffset: { row: 0, column: 0 } },
  });

  surface.onStateChange((change) => log(`surface: ${change.from} -> ${change.to}`));
  surface.onError((e) => log(`surface error [${e.code}]: ${e.message}`));
  surface.navigation.onChange((change) => log(`mode: ${change.from.mode} -> ${change.to.mode}`));

  return {
    surface,
    async attach() {
      await surface.attach();
      // Registered after attach() so the surface's own pad mapping has already updated the Control on release.
      pressUnbinds = [
        bindEventFeedback(pressEvents, encodeLed, output),
        input.onMessage((message) => {
          const padMode = surface.navigation.state.mode === "steps" || surface.navigation.state.mode === "mixer";
          if (!padMode) return;
          if (message.type === "note-on" && message.velocity > 0 && padNotes.has(message.note)) {
            pressEvents.emit({ id: "pad.press", payload: { note: message.note } });
          } else if ((message.type === "note-off" || message.type === "note-on") && padNotes.has(message.note)) {
            pressEvents.emit({ id: "pad.release", payload: { note: message.note } });
          }
        }),
      ];
    },
    async detach() {
      for (const unbind of pressUnbinds) unbind();
      pressUnbinds = [];
      await surface.detach();
    },
  };
}
