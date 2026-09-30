import type { MidiPortInfo, PortType } from "../../core/types/identity.js";
import type { ConnectionState } from "../../core/types/lifecycle.js";

export function toPortInfo(port: MIDIPort): MidiPortInfo {
  return {
    id: port.id,
    type: port.type as PortType, // Web MIDI's MIDIPortType ("input" | "output") matches Core's PortType exactly
    name: port.name,
    manufacturer: port.manufacturer,
  };
}

/**
 * Map Web MIDI's own two-axis state (`state`: connected/disconnected --
 * physical presence; `connection`: closed/pending/open -- whether we've
 * opened it) onto Core's single ConnectionState. Physical presence wins:
 * a disconnected port is `disconnected` regardless of its last-known
 * connection value.
 */
export function derivePortState(port: MIDIPort): ConnectionState {
  if (port.state === "disconnected") {
    return "disconnected";
  }
  switch (port.connection) {
    case "open":
      return "connected";
    case "pending":
      return "connecting";
    case "closed":
    default:
      return "available";
  }
}
