/**
 * Device metadata and identity.
 *
 * Core's unit of identity is a MIDI *port* (an input or an output), matching
 * how the underlying transport (Web MIDI) exposes hardware: a single
 * physical device commonly surfaces as one input port and one output port
 * with distinct ids. Core does not invent a "device" grouping above that —
 * doing so would require heuristics (matching by name/manufacturer) that
 * belong, if anywhere, in a higher layer, not in Core.
 */

export type PortId = string;

export type PortType = "input" | "output";

export const PORT_TYPES: readonly PortType[] = ["input", "output"];

export function isPortType(value: unknown): value is PortType {
  return typeof value === "string" && (PORT_TYPES as readonly string[]).includes(value);
}

/**
 * Generic, transport-level identity and capability info for a MIDI port.
 * Contains nothing device-specific — no control layout, no vendor behavior.
 */
export interface MidiPortInfo {
  readonly id: PortId;
  readonly type: PortType;
  readonly name: string | null;
  readonly manufacturer: string | null;
}
