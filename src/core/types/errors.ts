/**
 * Transport-level errors. These describe failures in talking to a MIDI
 * port over the transport — not application- or device-specific failures.
 */

export type MidiTransportErrorCode =
  | "permission-denied"
  | "device-unavailable"
  | "connection-failed"
  | "send-failed"
  | "unknown";

export const MIDI_TRANSPORT_ERROR_CODES: readonly MidiTransportErrorCode[] = [
  "permission-denied",
  "device-unavailable",
  "connection-failed",
  "send-failed",
  "unknown",
];

export function isMidiTransportErrorCode(value: unknown): value is MidiTransportErrorCode {
  return (
    typeof value === "string" &&
    (MIDI_TRANSPORT_ERROR_CODES as readonly string[]).includes(value)
  );
}

export interface MidiTransportError {
  readonly code: MidiTransportErrorCode;
  readonly message: string;
  /** The port this error relates to, when it's port-specific. */
  readonly portId?: string;
  /** The underlying error/exception from the transport, if any. */
  readonly cause?: unknown;
}
