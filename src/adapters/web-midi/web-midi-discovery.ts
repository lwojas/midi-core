import type { DiscoveryChange, MidiDiscovery, Unsubscribe } from "../../core/types/discovery.js";
import type { MidiPortInfo } from "../../core/types/identity.js";
import { toPortInfo } from "./port-info.js";

/**
 * Per the Web MIDI spec, a disconnected port's entry stays in
 * MIDIAccess.inputs/outputs (with state flipped to "disconnected")
 * rather than being removed, so reconnection can reuse the same port
 * object/id. Discovery here tracks presence explicitly (the `known`
 * set) rather than map membership, and listPorts()/onChange both filter
 * to currently-present ports -- "removed" means gone from discovery,
 * not merely disconnected-but-still-listed.
 */
export class WebMidiDiscovery implements MidiDiscovery {
  private readonly access: MIDIAccess;
  private readonly known = new Set<string>();
  private readonly changeListeners = new Set<(change: DiscoveryChange) => void>();

  constructor(access: MIDIAccess) {
    this.access = access;
    this.forEachPresentPort((port) => this.known.add(port.id));
    access.onstatechange = (event) => this.handleStateChange(event.port);
  }

  private forEachPort(fn: (port: MIDIPort) => void): void {
    this.access.inputs.forEach(fn);
    this.access.outputs.forEach(fn);
  }

  private forEachPresentPort(fn: (port: MIDIPort) => void): void {
    this.forEachPort((port) => {
      if (port.state !== "disconnected") fn(port);
    });
  }

  private handleStateChange(port: MIDIPort | null): void {
    if (!port) return;

    const info = toPortInfo(port);
    const wasKnown = this.known.has(info.id);
    const isPresent = port.state !== "disconnected";

    if (isPresent && !wasKnown) {
      this.known.add(info.id);
      this.emit({ type: "added", port: info });
    } else if (!isPresent && wasKnown) {
      this.known.delete(info.id);
      this.emit({ type: "removed", port: info });
    }
  }

  private emit(change: DiscoveryChange): void {
    for (const listener of this.changeListeners) listener(change);
  }

  listPorts(): readonly MidiPortInfo[] {
    const ports: MidiPortInfo[] = [];
    this.forEachPresentPort((port) => ports.push(toPortInfo(port)));
    return ports;
  }

  onChange(listener: (change: DiscoveryChange) => void): Unsubscribe {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }
}
