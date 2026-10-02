import { describe, expect, it } from "vitest";
import type { DevicePortProfile } from "../types/port.js";
import type { ProtocolBinding } from "../composition/types/binding.js";
import type { ProtocolFamily } from "../composition/types/protocol.js";
import { validateProtocolBindings } from "./validate-bindings.js";

const ports: DevicePortProfile[] = [{ id: "main-in", type: "input", role: "main", required: true, messageTypes: [] }];

const protocol: ProtocolFamily = { id: "fictional-protocol", name: "Fictional Protocol" };
const protocols = new Map<string, ProtocolFamily>([[protocol.id, protocol]]);

describe("validateProtocolBindings", () => {
  it("returns no diagnostics for a well-formed binding", () => {
    const binding: ProtocolBinding = { id: "binding-1", protocolId: protocol.id, portId: "main-in" };
    expect(validateProtocolBindings([binding], protocols, ports)).toEqual([]);
  });

  it("flags a binding referencing a protocol not in the registry", () => {
    const binding: ProtocolBinding = { id: "binding-1", protocolId: "does-not-exist", portId: "main-in" };
    expect(validateProtocolBindings([binding], protocols, ports)).toContainEqual(
      expect.objectContaining({ code: "unresolved-protocol-reference", path: "protocolBindings[0].protocolId" }),
    );
  });

  it("flags a binding referencing a port not in the device's ports", () => {
    const binding: ProtocolBinding = { id: "binding-1", protocolId: protocol.id, portId: "ghost-port" };
    expect(validateProtocolBindings([binding], protocols, ports)).toContainEqual(
      expect.objectContaining({ code: "dangling-port-reference", path: "protocolBindings[0].portId" }),
    );
  });

  it("flags duplicate binding ids", () => {
    const bindings: ProtocolBinding[] = [
      { id: "binding-1", protocolId: protocol.id, portId: "main-in" },
      { id: "binding-1", protocolId: protocol.id, portId: "main-in" },
    ];
    expect(validateProtocolBindings(bindings, protocols, ports)).toContainEqual(
      expect.objectContaining({ code: "duplicate-binding-id", path: "protocolBindings[1].id" }),
    );
  });
});
