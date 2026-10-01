/**
 * Whether a device needs a connection-time exchange before normal
 * operation — e.g. a mode-switch SysEx ("enter programmer mode"), or a
 * MIDI Identity Request/Reply. Described, not executed: a `HandshakeStep`
 * is a documented fact about what the device expects, not a runtime
 * instruction — nothing here sends or waits for a message. Actually
 * performing a handshake is application behavior built on top of a
 * profile, same boundary this schema draws everywhere else.
 */

export type HandshakeDirection = "send" | "expect";

export const HANDSHAKE_DIRECTIONS: readonly HandshakeDirection[] = ["send", "expect"];

export function isHandshakeDirection(value: unknown): value is HandshakeDirection {
  return typeof value === "string" && (HANDSHAKE_DIRECTIONS as readonly string[]).includes(value);
}

export interface HandshakeStep {
  readonly id: string;
  readonly description: string;
  readonly direction: HandshakeDirection;
}

export interface DeviceHandshake {
  readonly required: boolean;
  readonly steps: readonly HandshakeStep[];
}
