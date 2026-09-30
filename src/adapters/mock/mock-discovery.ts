import type { DiscoveryChange, MidiDiscovery, Unsubscribe } from "../../core/types/discovery.js";
import type { MidiPortInfo } from "../../core/types/identity.js";

/**
 * A test-controllable MidiDiscovery: ports only appear/disappear when a
 * test calls addPort()/removePort(), unlike WebMidiDiscovery which tracks
 * a real MIDIAccess. Lets higher layers and tests exercise
 * device-picker-style discovery flows without any transport at all.
 */
export class MockMidiDiscovery implements MidiDiscovery {
  private readonly ports = new Map<string, MidiPortInfo>();
  private readonly changeListeners = new Set<(change: DiscoveryChange) => void>();

  listPorts(): readonly MidiPortInfo[] {
    return Array.from(this.ports.values());
  }

  onChange(listener: (change: DiscoveryChange) => void): Unsubscribe {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Test control: make a port appear in discovery. */
  addPort(port: MidiPortInfo): void {
    if (this.ports.has(port.id)) return;
    this.ports.set(port.id, port);
    this.emit({ type: "added", port });
  }

  /** Test control: make a port disappear from discovery. */
  removePort(portId: string): void {
    const port = this.ports.get(portId);
    if (!port) return;
    this.ports.delete(portId);
    this.emit({ type: "removed", port });
  }

  private emit(change: DiscoveryChange): void {
    for (const listener of this.changeListeners) listener(change);
  }
}
