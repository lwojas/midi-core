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

export type { ProtocolControlTemplate, ProtocolFamily } from "./composition/types/protocol.js";

export type { ProtocolBinding } from "./composition/types/binding.js";

export {
  composeProtocolControls,
  composeDeviceControls,
  composePortMessageTypes,
  composeDeviceProfile,
} from "./composition/compose.js";

export { GENERIC_MIDI_CHANNEL_VOICE_MESSAGE_TYPES, GENERIC_MIDI_PROTOCOL } from "./generic/protocol.js";

export {
  GENERIC_MIDI_DEVICE_IDENTITY,
  GENERIC_MIDI_DEVICE_PORTS,
  GENERIC_MIDI_DEVICE_PROTOCOL_BINDINGS,
  GENERIC_MIDI_DEVICE_PROFILE,
} from "./generic/device-profile.js";
