/**
 * Connection lifecycle for a single MIDI port.
 *
 * This is Core's own abstraction, not a passthrough of Web MIDI's
 * `state`/`connection` fields — clients should not need to know which
 * transport is underneath.
 *
 *   available -> connecting -> connected -> disconnecting -> disconnected
 *   available|connecting|connected -> error
 *   disconnected -> available            (port re-appears)
 */

export type ConnectionState =
  | "available"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "disconnected"
  | "error";

export const CONNECTION_STATES: readonly ConnectionState[] = [
  "available",
  "connecting",
  "connected",
  "disconnecting",
  "disconnected",
  "error",
];

export function isConnectionState(value: unknown): value is ConnectionState {
  return typeof value === "string" && (CONNECTION_STATES as readonly string[]).includes(value);
}

const ALLOWED_TRANSITIONS: Readonly<Record<ConnectionState, readonly ConnectionState[]>> = {
  available: ["connecting", "disconnected", "error"],
  connecting: ["connected", "error", "disconnected"],
  connected: ["disconnecting", "disconnected", "error"],
  disconnecting: ["disconnected", "error"],
  disconnected: ["available"],
  error: ["available", "disconnected"],
};

/**
 * Whether moving from `from` to `to` is a valid lifecycle transition.
 * A state "transitioning" to itself is not considered valid — callers
 * should treat repeated identical states as a no-op, not a transition.
 */
export function isValidTransition(from: ConnectionState, to: ConnectionState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface ConnectionStateChange {
  readonly portId: string;
  readonly from: ConnectionState;
  readonly to: ConnectionState;
}
