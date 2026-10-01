export type { DeviceIdentity } from "./types/identity.js";

export type { DevicePortProfile } from "./types/port.js";

export type {
  ControlChangeAddress,
  NoteAddress,
  PitchBendAddress,
  ProgramChangeAddress,
  ChannelPressureAddress,
  PolyPressureAddress,
  ControlSurfaceAddress,
  ControlAddress,
  ControlKind,
  ControlValueMode,
  FeedbackKind,
  ControlFeedback,
  PhysicalControl,
} from "./types/control.js";
export {
  CONTROL_KINDS,
  isControlKind,
  CONTROL_VALUE_MODES,
  isControlValueMode,
  FEEDBACK_KINDS,
  isFeedbackKind,
} from "./types/control.js";

export type { GridCell, ControlGrid } from "./types/grid.js";

export type { DeviceSysExProfile } from "./types/sysex.js";

export type { HandshakeDirection, HandshakeStep, DeviceHandshake } from "./types/handshake.js";
export { HANDSHAKE_DIRECTIONS, isHandshakeDirection } from "./types/handshake.js";

export type { DeviceProfile } from "./types/profile.js";
export { DEVICE_PROFILE_SCHEMA_VERSION } from "./types/profile.js";
