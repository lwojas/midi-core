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

export type {
  SurfaceModeId,
  GridOffset,
  SurfaceNavigationState,
  SurfaceNavigationChange,
  SurfaceNavigation,
} from "./types/navigation.js";

export type {
  ControlRole,
  ControlIdResolution,
  NavigationAction,
  ControlBinding,
  NavigationBinding,
  ModeBinding,
  SurfaceModeHooks,
  SurfaceModeDefinition,
  SurfaceBindingTable,
} from "./types/bindings.js";
export { resolveControlId } from "./types/bindings.js";

export type { GeneratedBinding, GenerateControlMappings } from "./types/generation.js";

export { createSurfaceNavigation } from "./navigation.js";

export type { SurfacePorts, BindSurfaceModeDeps, SurfaceModeTeardown } from "./bindings.js";
export { bindSurfaceMode, bindActiveMode } from "./bindings.js";

export { generateControlMappings, toMidiTarget } from "./generate.js";

export type { EventFeedbackEncoder } from "./event-feedback.js";
export { bindEventFeedback } from "./event-feedback.js";
