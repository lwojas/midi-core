// The Launchpad Mini MK3 surface wiring, shared by the browser demo (demo/launchpad.js) and the
// Node live-run script (scripts/launchpad-live.mjs). Transport-agnostic: it only ever sees
// MidiInput/MidiOutput, so the same code runs over Web MIDI in a browser and CoreMIDI in Node.
import { createAction, createControl, createControlRegistry, createSurfaceContext, createSurfaceEventSource } from "../dist/control-api/index.js";
import { LAUNCHPAD_MINI_MK3_PADS, LAUNCHPAD_MINI_MK3_PROFILE } from "../dist/profile/index.js";
import { bindActionTrigger, bindEventFeedback, createControlSurface, generateControlMappings, toMidiSource } from "../dist/surface/index.js";

// Programmer-mode switch (F0h 00h 20h 29h 02h 0Dh 0Eh 01h F7h), from the profile's own handshake description.
// Literal Launchpad bytes live in this demo layer, not in the surface runtime or the generic profile schema.
export const ENTER_PROGRAMMER_MODE = Uint8Array.of(0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x0e, 0x01, 0xf7);

const padNotes = new Set(LAUNCHPAD_MINI_MK3_PADS.map((pad) => pad.input.address.note));
const padControlId = (note) => `pad.${8 - Math.floor(note / 10)}.${(note % 10) - 1}`;
const topButton = (controller) => toMidiSource(LAUNCHPAD_MINI_MK3_PROFILE.controls.find((c) => c.id === `top-${controller}`));

export function createLaunchpadApp({ onChange = () => {} } = {}) {
  const pads = new Map();
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const id = `pad.${row}.${col}`;
      pads.set(id, createControl({ id, label: `Pad ${row},${col}`, kind: "boolean", default: false }));
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
  for (const control of pads.values()) control.onChange(() => onChange("pads", litPadCount(pads)));
  return {
    pads,
    transport,
    actions,
    litPadCount: () => litPadCount(pads),
    setAllPads(on) {
      for (const control of pads.values()) control.setValue(on);
    },
  };
}

function litPadCount(pads) {
  return [...pads.values()].filter((control) => control.getValue()).length;
}

/**
 * Builds the surface for one connected input/output pair. `log` receives human-readable lines.
 * Returns { surface, attach, detach } where attach/detach wrap the surface plus the pad-press
 * LED policy and the transport top-button triggers.
 */
export function createLaunchpadSurface({ input, output, app, log = () => {} }) {
  const registry = createControlRegistry([...app.pads.values()]);
  const padBindings = LAUNCHPAD_MINI_MK3_PADS.map((pad) => ({
    physicalControlId: pad.id,
    role: "pad",
    kind: "control",
    resolve: { kind: "static", controlId: padControlId(pad.input.address.note) },
  }));

  let transportUnbinds = [];
  const pressEvents = createSurfaceEventSource();
  let pressUnbinds = [];

  // Pad LED policy: press lights the pad, release restores it to the app's state. The surface withholds
  // feedback for values it just received (echo suppression), and Programmer-mode pads don't self-light,
  // so this goes through the same event-feedback path as any other application-driven light.
  function encodeLed(event) {
    const note = event.payload.note;
    if (event.id === "pad.press") return { type: "note-on", channel: 0, note, velocity: 127 };
    if (event.id === "pad.release") {
      const lit = app.pads.get(padControlId(note)).getValue();
      return lit ? { type: "note-on", channel: 0, note, velocity: 127 } : { type: "note-off", channel: 0, note, velocity: 0 };
    }
    return undefined;
  }

  const surface = createControlSurface({
    profile: LAUNCHPAD_MINI_MK3_PROFILE,
    ports: { inputs: { "midi-in": input }, outputs: { "midi-out": output } },
    bindingTable: [
      { mode: "pads", bindings: padBindings },
      {
        mode: "transport",
        bindings: [],
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
    initialNavigation: { mode: "pads" },
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
