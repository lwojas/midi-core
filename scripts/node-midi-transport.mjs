// Node transport for midi-core's RawMidiInput/RawMidiOutput seam, backed by @julusian/midi (CoreMIDI on macOS).
// Dev-only: used by scripts/ to drive real hardware from the terminal, never imported by the published package.
import midi from "@julusian/midi";

function connectionState(initial = "available") {
  let state = initial;
  const listeners = new Set();
  return {
    get state() {
      return state;
    },
    set(next) {
      const previous = state;
      state = next;
      for (const listener of listeners) listener(next, previous);
    },
    onStateChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createNodeInputTransport(portIndex, name) {
  const device = new midi.Input();
  const conn = connectionState();
  const errorListeners = new Set();
  const messageListeners = new Set();

  return {
    port: { id: `node-in-${portIndex}`, type: "input", name, manufacturer: null },
    get state() {
      return conn.state;
    },
    async connect() {
      if (conn.state === "connected") return;
      conn.set("connecting");
      device.ignoreTypes(false, true, true); // keep SysEx (ignoreTypes defaults to dropping it)
      device.on("message", (_deltaTime, bytes) => {
        const message = Uint8Array.from(bytes);
        for (const listener of messageListeners) listener(message);
      });
      device.openPort(portIndex);
      conn.set("connected");
    },
    async disconnect() {
      if (conn.state !== "connected") return;
      conn.set("disconnecting");
      device.closePort();
      conn.set("disconnected");
    },
    onStateChange: (listener) => conn.onStateChange(listener),
    onError: (listener) => {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
    onRawMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
  };
}

export function createNodeOutputTransport(portIndex, name) {
  const device = new midi.Output();
  const conn = connectionState();
  const errorListeners = new Set();

  return {
    port: { id: `node-out-${portIndex}`, type: "output", name, manufacturer: null },
    get state() {
      return conn.state;
    },
    async connect() {
      if (conn.state === "connected") return;
      conn.set("connecting");
      device.openPort(portIndex);
      conn.set("connected");
    },
    async disconnect() {
      if (conn.state !== "connected") return;
      conn.set("disconnecting");
      device.closePort();
      conn.set("disconnected");
    },
    onStateChange: (listener) => conn.onStateChange(listener),
    onError: (listener) => {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
    sendRaw(bytes) {
      device.sendMessage(Array.from(bytes));
    },
  };
}

/** Finds a port by name pattern, returning its index, or -1. Lists every port on the system for logging. */
export function findPort(kind, pattern) {
  const probe = kind === "input" ? new midi.Input() : new midi.Output();
  try {
    const count = probe.getPortCount();
    const names = Array.from({ length: count }, (_, i) => probe.getPortName(i));
    return { names, index: names.findIndex((name) => pattern.test(name)) };
  } finally {
    probe.closePort();
  }
}
