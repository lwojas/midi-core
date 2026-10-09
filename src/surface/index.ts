export type { SurfaceLifecycleState, SurfaceLifecycleChange } from "./types/lifecycle.js";
export {
  SURFACE_LIFECYCLE_STATES,
  isSurfaceLifecycleState,
  isValidSurfaceTransition,
  isSurfaceAttachable,
} from "./types/lifecycle.js";

export type { SurfaceErrorCode, SurfaceError } from "./types/errors.js";
export { SURFACE_ERROR_CODES, isSurfaceErrorCode } from "./types/errors.js";

export type { ControlSurface } from "./types/runtime.js";

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
  ModifierCondition,
  ControlBinding,
  NavigationBinding,
  WindowedControlBinding,
  DisplayBinding,
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

export { bindSelectionModePolicy } from "./selection-policy.js";

export type { WindowedControl } from "./windowed-control.js";
export { createWindowedControl } from "./windowed-control.js";

export { generateControlMappings, toMidiTarget, toMidiSource } from "./generate.js";

export { buildDisplayMessage } from "./display-binding.js";

export type { EventFeedbackEncoder } from "./event-feedback.js";
export { bindEventFeedback } from "./event-feedback.js";

export { bindActionTrigger } from "./action-binding.js";

export { switchMode } from "./mode-switching.js";

export { runDeviceSetup, DEFAULT_SETUP_TIMEOUT_MS } from "./setup.js";

export type { ControlSurfaceDeps } from "./runtime.js";
export { createControlSurface } from "./runtime.js";
