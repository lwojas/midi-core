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
  RelativeEncoding,
  FeedbackKind,
  ControlFeedback,
  PhysicalControl,
} from "./types/control.js";
export {
  CONTROL_KINDS,
  isControlKind,
  CONTROL_VALUE_MODES,
  isControlValueMode,
  RELATIVE_ENCODINGS,
  isRelativeEncoding,
  FEEDBACK_KINDS,
  isFeedbackKind,
} from "./types/control.js";

export type { GridCell, GridPaging, ControlGrid } from "./types/grid.js";

export type { DeviceSysExProfile } from "./types/sysex.js";

export type { DeviceSetupStep, DeviceSetup } from "./types/setup.js";

export type { ModeButtonRole, TransportRoles, DeviceLayout } from "./types/layout.js";

export type { DeviceProfile } from "./types/profile.js";
export { DEVICE_PROFILE_SCHEMA_VERSION } from "./types/profile.js";

export type { DisplayLineTemplate, DeviceDisplayDefinition } from "./types/display.js";

export type { DeviceOverrides } from "./types/overrides.js";
export { DEVICE_OVERRIDES_SCHEMA_VERSION } from "./types/overrides.js";

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

export {
  MOCK_SURFACE_DEVICE_IDENTITY,
  MOCK_SURFACE_DEVICE_PORTS,
  MOCK_SURFACE_KNOBS,
  MOCK_SURFACE_BUTTONS,
  MOCK_SURFACE_PADS,
  MOCK_SURFACE_CONTROLS,
  MOCK_SURFACE_STEP_GRID,
  MOCK_SURFACE_DEVICE_PROFILE,
} from "./generic/mock-surface-profile.js";

export {
  EXAMPLE_GRID_8X8_IDENTITY,
  EXAMPLE_GRID_8X8_PORTS,
  EXAMPLE_GRID_8X8_PADS,
  EXAMPLE_GRID_8X8_BUTTONS,
  EXAMPLE_GRID_8X8_CONTROLS,
  EXAMPLE_GRID_8X8_PAD_GRID,
  EXAMPLE_GRID_8X8_LAYOUT,
  EXAMPLE_GRID_8X8_PROFILE,
} from "./devices/example-grid-8x8.js";

export {
  LAUNCHPAD_MINI_MK3_IDENTITY,
  LAUNCHPAD_MINI_MK3_PORTS,
  LAUNCHPAD_MINI_MK3_PADS,
  LAUNCHPAD_MINI_MK3_TOP_ROW,
  LAUNCHPAD_MINI_MK3_SIDE_COLUMN,
  LAUNCHPAD_MINI_MK3_LOGO,
  LAUNCHPAD_MINI_MK3_CONTROLS,
  LAUNCHPAD_MINI_MK3_PAD_GRID,
  LAUNCHPAD_MINI_MK3_SYSEX,
  LAUNCHPAD_MINI_MK3_SETUP,
  LAUNCHPAD_MINI_MK3_LAYOUT,
  LAUNCHPAD_MINI_MK3_PROFILE,
} from "./devices/launchpad-mini-mk3.js";

export type { DiagnosticSeverity, ProfileDiagnosticCode, ProfileDiagnostic } from "./validation/types/diagnostic.js";

export { validateDeviceProfile } from "./validation/validate-profile.js";
export { validateProtocolBindings } from "./validation/validate-bindings.js";
export { validateDeviceOverrides } from "./validation/validate-overrides.js";
