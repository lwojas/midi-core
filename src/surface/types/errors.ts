import type { MidiTransportError } from "../../core/types/errors.js";

/**
 * Surface-level failures, reported in the surface's own terms rather than
 * widening `MidiTransportError` (`docs/contracts/discovery-lifecycle.md`)
 * to cover them — the same stance that contract already takes ("device- or
 * application-level failures are out of scope for Core and are reported by
 * higher layers in their own terms"). A transport failure that caused a
 * surface failure is carried as `cause`, not re-encoded.
 */

export type SurfaceErrorCode =
  | "port-unavailable"
  | "handshake-unsupported"
  | "handshake-failed"
  | "unknown";

export const SURFACE_ERROR_CODES: readonly SurfaceErrorCode[] = [
  "port-unavailable",
  "handshake-unsupported",
  "handshake-failed",
  "unknown",
];

export function isSurfaceErrorCode(value: unknown): value is SurfaceErrorCode {
  return typeof value === "string" && (SURFACE_ERROR_CODES as readonly string[]).includes(value);
}

export interface SurfaceError {
  readonly code: SurfaceErrorCode;
  readonly message: string;
  /** The underlying transport error or thrown value, when there is one. */
  readonly cause?: MidiTransportError | unknown;
}
