import type { MidiDiscovery } from "../../core/types/discovery.js";
import type { RawMidiInput } from "../../core/types/input.js";
import type { RawMidiOutput } from "../../core/types/output.js";
import { WebMidiDiscovery } from "./web-midi-discovery.js";
import { WebMidiInputTransport } from "./web-midi-input.js";
import { WebMidiOutputTransport } from "./web-midi-output.js";

export interface WebMidiAccess {
  readonly discovery: MidiDiscovery;
  getInput(portId: string): RawMidiInput | undefined;
  getOutput(portId: string): RawMidiOutput | undefined;
}

function findPort<T extends MIDIPort>(map: { forEach(fn: (port: T) => void): void }, portId: string): T | undefined {
  let found: T | undefined;
  map.forEach((port) => {
    if (port.id === portId) found = port;
  });
  return found;
}

/**
 * Wrap an already-obtained MIDIAccess. Kept separate from
 * requestWebMidiAccess() so adapter wiring (discovery, port lookup,
 * transport caching) can be unit tested with a fake MIDIAccess, without
 * needing a real browser.
 */
export function createWebMidiAccess(access: MIDIAccess): WebMidiAccess {
  const discovery = new WebMidiDiscovery(access);
  const inputCache = new Map<string, WebMidiInputTransport>();
  const outputCache = new Map<string, WebMidiOutputTransport>();

  return {
    discovery,
    getInput(portId) {
      const cached = inputCache.get(portId);
      if (cached) return cached;
      const midiInput = findPort(access.inputs, portId);
      if (!midiInput) return undefined;
      const transport = new WebMidiInputTransport(midiInput);
      inputCache.set(portId, transport);
      return transport;
    },
    getOutput(portId) {
      const cached = outputCache.get(portId);
      if (cached) return cached;
      const midiOutput = findPort(access.outputs, portId);
      if (!midiOutput) return undefined;
      const transport = new WebMidiOutputTransport(midiOutput);
      outputCache.set(portId, transport);
      return transport;
    },
  };
}

/**
 * Request Web MIDI access from the browser and wrap it. Not exercised by
 * unit tests -- it depends on navigator.requestMIDIAccess, which only a
 * real browser provides (and only after a user permission prompt).
 */
export async function requestWebMidiAccess(options?: MIDIOptions): Promise<WebMidiAccess> {
  if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function") {
    throw new Error("Web MIDI API is not available in this environment.");
  }
  const access = await navigator.requestMIDIAccess(options);
  return createWebMidiAccess(access);
}
