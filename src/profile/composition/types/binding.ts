/**
 * Binds one `ProtocolFamily` onto one of a device's ports. The binding,
 * not the protocol, decides which port a protocol's controls/messages run
 * on — the same protocol can be bound to different ports on different
 * devices (or, rarely, to two different ports on one device), so the port
 * choice belongs here, not on `ProtocolFamily` itself.
 */
export interface ProtocolBinding {
  /** Binding-scoped id, prefixed onto composed control ids so two bindings of the same protocol don't collide. */
  readonly id: string;
  /** The `ProtocolFamily.id` this binding resolves, against whatever protocol registry the caller supplies to `compose*`. */
  readonly protocolId: string;
  /** The `DevicePortProfile.id` this protocol runs on for this device. */
  readonly portId: string;
}
