import type { DevicePortProfile } from "../types/port.js";
import type { ProtocolBinding } from "../composition/types/binding.js";
import type { ProtocolFamily } from "../composition/types/protocol.js";
import type { ProfileDiagnostic } from "./types/diagnostic.js";

/**
 * Validates a composition's own inputs *before* (or instead of)
 * `composeDeviceProfile()` — unlike `validateDeviceProfile`, these are
 * already-typed TypeScript values (a caller composing a profile is in TS,
 * not loading untrusted JSON), but TypeScript's types can't catch a
 * `protocolId` string that happens not to match anything in the registry,
 * or two bindings that collide. Exactly the three cases
 * `docs/contracts/protocol-composition.md` named as deferred here.
 */
export function validateProtocolBindings(
  bindings: readonly ProtocolBinding[],
  protocols: ReadonlyMap<string, ProtocolFamily>,
  ports: readonly DevicePortProfile[],
): readonly ProfileDiagnostic[] {
  const diagnostics: ProfileDiagnostic[] = [];
  const portIds = new Set(ports.map((port) => port.id));
  const seenBindingIds = new Set<string>();

  bindings.forEach((binding, index) => {
    const path = `protocolBindings[${index}]`;

    if (seenBindingIds.has(binding.id)) {
      diagnostics.push({ severity: "error", code: "duplicate-binding-id", path: `${path}.id`, message: `Duplicate protocol binding id "${binding.id}".` });
    }
    seenBindingIds.add(binding.id);

    if (!protocols.has(binding.protocolId)) {
      diagnostics.push({
        severity: "error",
        code: "unresolved-protocol-reference",
        path: `${path}.protocolId`,
        message: `Binding "${binding.id}" references protocolId "${binding.protocolId}", which isn't in the supplied protocol registry.`,
      });
    }

    if (!portIds.has(binding.portId)) {
      diagnostics.push({
        severity: "error",
        code: "dangling-port-reference",
        path: `${path}.portId`,
        message: `Binding "${binding.id}" references portId "${binding.portId}", which isn't declared in ports.`,
      });
    }
  });

  return diagnostics;
}
