export type { SurfaceLifecycleState, SurfaceLifecycleChange } from "./types/lifecycle.js";
export {
  SURFACE_LIFECYCLE_STATES,
  isSurfaceLifecycleState,
  isValidSurfaceTransition,
  isSurfaceAttachable,
} from "./types/lifecycle.js";

export type { SurfaceErrorCode, SurfaceError } from "./types/errors.js";
export { SURFACE_ERROR_CODES, isSurfaceErrorCode } from "./types/errors.js";

export type { HandshakeExecutor, ControlSurface } from "./types/runtime.js";
