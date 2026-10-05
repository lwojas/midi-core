/**
 * Device setup: the messages a device needs before it behaves the way its
 * profile describes — switching into a programming/performance mode, or
 * identifying itself with a Device Inquiry and checking the reply. Every
 * step is data: either bytes to send, or bytes a reply must match. The
 * surface runs the declared steps on connect (`docs/contracts/device-setup.md`),
 * so no per-device code is needed to perform them.
 *
 * Bytes are plain numbers, not `MidiMessage`s, because a setup step is
 * often vendor SysEx that Core deliberately doesn't model field by field.
 * A step is exactly one of `send` or `expect`; validation enforces that.
 */

export interface DeviceSetupStep {
  readonly id: string;
  readonly description: string;
  /** Bytes to send exactly as written. SysEx includes its leading 0xF0 and trailing 0xF7. */
  readonly send?: readonly number[];
  /** Bytes a reply must match, in order. `null` matches any single byte (e.g. a firmware version). */
  readonly expect?: readonly (number | null)[];
}

export interface DeviceSetup {
  /** `DevicePortProfile.id` of an input port: where replies arrive. */
  readonly inputPortId: string;
  /** `DevicePortProfile.id` of an output port: where `send` steps go. */
  readonly outputPortId: string;
  /** How long an `expect` step waits for its reply. Omitted means the surface's default. */
  readonly timeoutMs?: number;
  readonly steps: readonly DeviceSetupStep[];
}
