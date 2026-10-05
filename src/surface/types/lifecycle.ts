import type { ConnectionState } from "../../core/types/lifecycle.js";

/**
 * A Control Surface's own lifecycle: attach/detach as one aggregate state
 * over however many ports and however much device setup a profile
 * declares, instead of a caller tracking each composed port's own
 * `ConnectionState` (`docs/contracts/discovery-lifecycle.md`) by hand —
 * exactly what webseq's `useMidiControls.ts` currently hand-rolls for its
 * one hardcoded device (a bundle of input/output/unbinds torn down
 * together).
 *
 * Named attach/detach, not connect/disconnect, to keep this vocabulary
 * distinct from the per-port state it's built on: nothing here is a port,
 * and a surface can be `attaching` while every one of its ports is
 * already `connected` (e.g. device setup is still in flight).
 */

export type SurfaceLifecycleState = "detached" | "attaching" | "attached" | "detaching" | "error";

export const SURFACE_LIFECYCLE_STATES: readonly SurfaceLifecycleState[] = [
  "detached",
  "attaching",
  "attached",
  "detaching",
  "error",
];

export function isSurfaceLifecycleState(value: unknown): value is SurfaceLifecycleState {
  return typeof value === "string" && (SURFACE_LIFECYCLE_STATES as readonly string[]).includes(value);
}

/**
 *   detached -> attaching -> attached -> detaching -> detached
 *   attaching -> detaching            (give up before fully attached, e.g.
 *                                       a required port never became
 *                                       available; still tears down
 *                                       whatever did connect)
 *   attaching | attached | detaching -> error
 *   error -> detached                  (after detach()'s cleanup runs)
 */
const ALLOWED_TRANSITIONS: Readonly<Record<SurfaceLifecycleState, readonly SurfaceLifecycleState[]>> = {
  detached: ["attaching"],
  attaching: ["attached", "detaching", "error"],
  attached: ["detaching", "error"],
  detaching: ["detached", "error"],
  error: ["detached"],
};

/**
 * Whether moving from `from` to `to` is a valid surface lifecycle
 * transition. As with Core's own `isValidTransition`, a state never
 * "transitions" to itself.
 */
export function isValidSurfaceTransition(from: SurfaceLifecycleState, to: SurfaceLifecycleState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface SurfaceLifecycleChange {
  readonly from: SurfaceLifecycleState;
  readonly to: SurfaceLifecycleState;
}

/**
 * Whether a surface's required ports are all in a state attach() could
 * reasonably be called against. Deliberately not a fourth lifecycle state
 * of its own — "availability" is answered by inspecting the underlying
 * ports' own Core `ConnectionState` directly, the same facts
 * `docs/contracts/discovery-lifecycle.md` already defines, rather than
 * this layer duplicating or shadowing them with a parallel notion of
 * "available."
 */
export function isSurfaceAttachable(requiredPortStates: readonly ConnectionState[]): boolean {
  return requiredPortStates.every((state) => state === "available" || state === "connected");
}
