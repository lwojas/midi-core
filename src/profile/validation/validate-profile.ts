import { isPortType } from "../../core/types/identity.js";
import { isMidiMessageType } from "../../core/types/message.js";
import { isControlKind, isControlValueMode, isFeedbackKind } from "../types/control.js";
import { isHandshakeDirection } from "../types/handshake.js";
import { DEVICE_PROFILE_SCHEMA_VERSION } from "../types/profile.js";
import type { ProfileDiagnostic } from "./types/diagnostic.js";

/**
 * Validates a `DeviceProfile` **document** — deliberately typed `unknown`,
 * not `DeviceProfile`, since the whole point is checking data that hasn't
 * been trusted yet (loaded from JSON a profiler produced, or handwritten),
 * not re-checking something TypeScript already verified. Returns every
 * finding rather than stopping at the first one, and never throws — same
 * "report, don't guess" stance as the rest of this layer
 * (`resolveIncomingValue`/`buildFeedbackMessage` return `undefined` rather
 * than throwing for input they can't resolve).
 *
 * Checks exactly what `docs/contracts/device-profile.md` and
 * `protocol-composition.md` named as deliberately deferred here: dangling
 * `portId`/`controlId` references, out-of-bounds/duplicate grid cells,
 * duplicate ids, unknown enum values (`type`/`kind`/`valueMode`/
 * `direction`), a `schemaVersion` this version of midi-core doesn't
 * understand, and a `sysex`/`handshake` marked `required` but with
 * nothing in it to actually perform — the "rather than invented
 * handshakes" case named directly in the ticket. See
 * docs/contracts/profile-validation.md for what's deliberately still not
 * checked (field-level type/range correctness beyond what's needed to run
 * these checks, and anything semantic no contract document actually
 * specifies).
 */
export function validateDeviceProfile(profile: unknown): readonly ProfileDiagnostic[] {
  if (!isRecord(profile)) {
    return [{ severity: "error", code: "invalid-document", path: "", message: "Profile is not an object." }];
  }

  const diagnostics: ProfileDiagnostic[] = [];

  diagnostics.push(...checkSchemaVersion(profile.schemaVersion));
  diagnostics.push(...checkIdentity(profile.identity));

  const portIds = new Set<string>();
  diagnostics.push(...checkPorts(profile.ports, portIds));

  const controlIds = new Set<string>();
  diagnostics.push(...checkControls(profile.controls, portIds, controlIds));

  diagnostics.push(...checkGrids(profile.grids, controlIds));
  diagnostics.push(...checkSysEx(profile.sysex));
  diagnostics.push(...checkHandshake(profile.handshake));

  return diagnostics;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkSchemaVersion(value: unknown): ProfileDiagnostic[] {
  if (typeof value !== "string") {
    return [{ severity: "error", code: "invalid-schema-version", path: "schemaVersion", message: "schemaVersion must be a string." }];
  }
  if (value !== DEVICE_PROFILE_SCHEMA_VERSION) {
    return [
      {
        severity: "error",
        code: "unsupported-schema-version",
        path: "schemaVersion",
        message: `Unsupported schemaVersion "${value}" — this version of midi-core understands "${DEVICE_PROFILE_SCHEMA_VERSION}".`,
      },
    ];
  }
  return [];
}

function checkIdentity(value: unknown): ProfileDiagnostic[] {
  if (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.manufacturer === "string" &&
    typeof value.model === "string"
  ) {
    return [];
  }
  return [
    {
      severity: "error",
      code: "invalid-identity",
      path: "identity",
      message: "identity must be an object with string id, manufacturer and model.",
    },
  ];
}

function checkPorts(value: unknown, portIds: Set<string>): ProfileDiagnostic[] {
  if (!Array.isArray(value)) {
    return [{ severity: "error", code: "invalid-port", path: "ports", message: "ports must be an array." }];
  }

  const diagnostics: ProfileDiagnostic[] = [];

  value.forEach((port, index) => {
    const path = `ports[${index}]`;
    if (!isRecord(port) || typeof port.id !== "string" || typeof port.role !== "string" || typeof port.required !== "boolean") {
      diagnostics.push({ severity: "error", code: "invalid-port", path, message: "Port must have string id/role and boolean required." });
      return;
    }

    if (portIds.has(port.id)) {
      diagnostics.push({ severity: "error", code: "duplicate-port-id", path: `${path}.id`, message: `Duplicate port id "${port.id}".` });
    }
    portIds.add(port.id);

    if (!isPortType(port.type)) {
      diagnostics.push({ severity: "error", code: "unknown-port-type", path: `${path}.type`, message: `Unknown port type ${JSON.stringify(port.type)}.` });
    }

    const messageTypes = Array.isArray(port.messageTypes) ? port.messageTypes : [];
    messageTypes.forEach((type, typeIndex) => {
      if (!isMidiMessageType(type)) {
        diagnostics.push({
          severity: "error",
          code: "unknown-message-type",
          path: `${path}.messageTypes[${typeIndex}]`,
          message: `Unknown message type ${JSON.stringify(type)}.`,
        });
      }
    });
  });

  return diagnostics;
}

function checkControls(value: unknown, portIds: Set<string>, controlIds: Set<string>): ProfileDiagnostic[] {
  if (!Array.isArray(value)) {
    return [{ severity: "error", code: "invalid-control", path: "controls", message: "controls must be an array." }];
  }

  const diagnostics: ProfileDiagnostic[] = [];

  value.forEach((control, index) => {
    const path = `controls[${index}]`;
    if (!isRecord(control) || typeof control.id !== "string" || typeof control.label !== "string" || typeof control.portId !== "string") {
      diagnostics.push({ severity: "error", code: "invalid-control", path, message: "Control must have string id/label/portId." });
      return;
    }

    if (controlIds.has(control.id)) {
      diagnostics.push({ severity: "error", code: "duplicate-control-id", path: `${path}.id`, message: `Duplicate control id "${control.id}".` });
    }
    controlIds.add(control.id);

    if (!isControlKind(control.kind)) {
      diagnostics.push({ severity: "error", code: "unknown-control-kind", path: `${path}.kind`, message: `Unknown control kind ${JSON.stringify(control.kind)}.` });
    }

    if (!portIds.has(control.portId)) {
      diagnostics.push({
        severity: "error",
        code: "dangling-port-reference",
        path: `${path}.portId`,
        message: `Control "${control.id}" references portId "${control.portId}", which isn't declared in ports.`,
      });
    }

    if (control.valueMode !== undefined && !isControlValueMode(control.valueMode)) {
      diagnostics.push({
        severity: "error",
        code: "unknown-control-value-mode",
        path: `${path}.valueMode`,
        message: `Unknown valueMode ${JSON.stringify(control.valueMode)}.`,
      });
    }

    if (isRecord(control.feedback) && !isFeedbackKind(control.feedback.kind)) {
      diagnostics.push({
        severity: "error",
        code: "unknown-feedback-kind",
        path: `${path}.feedback.kind`,
        message: `Unknown feedback kind ${JSON.stringify(control.feedback.kind)}.`,
      });
    }
  });

  return diagnostics;
}

function checkGrids(value: unknown, controlIds: Set<string>): ProfileDiagnostic[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    return [{ severity: "error", code: "invalid-grid", path: "grids", message: "grids must be an array when present." }];
  }

  const diagnostics: ProfileDiagnostic[] = [];
  const gridIds = new Set<string>();

  value.forEach((grid, gridIndex) => {
    const path = `grids[${gridIndex}]`;
    if (!isRecord(grid) || typeof grid.id !== "string" || typeof grid.rows !== "number" || typeof grid.columns !== "number" || !Array.isArray(grid.cells)) {
      diagnostics.push({ severity: "error", code: "invalid-grid", path, message: "Grid must have string id, numeric rows/columns and a cells array." });
      return;
    }

    if (gridIds.has(grid.id)) {
      diagnostics.push({ severity: "error", code: "duplicate-grid-id", path: `${path}.id`, message: `Duplicate grid id "${grid.id}".` });
    }
    gridIds.add(grid.id);

    const { rows, columns, cells } = grid;
    const seenCells = new Set<string>();
    cells.forEach((cell, cellIndex) => {
      const cellPath = `${path}.cells[${cellIndex}]`;
      if (!isRecord(cell) || typeof cell.row !== "number" || typeof cell.column !== "number" || typeof cell.controlId !== "string") {
        diagnostics.push({ severity: "error", code: "invalid-grid", path: cellPath, message: "Grid cell must have numeric row/column and string controlId." });
        return;
      }

      if (cell.row < 0 || cell.row >= rows || cell.column < 0 || cell.column >= columns) {
        diagnostics.push({
          severity: "error",
          code: "grid-cell-out-of-bounds",
          path: cellPath,
          message: `Cell (${cell.row}, ${cell.column}) is outside the grid's declared ${rows}x${columns} bounds.`,
        });
      }

      const cellKey = `${cell.row},${cell.column}`;
      if (seenCells.has(cellKey)) {
        diagnostics.push({ severity: "error", code: "duplicate-grid-cell", path: cellPath, message: `Duplicate cell at (${cell.row}, ${cell.column}).` });
      }
      seenCells.add(cellKey);

      if (!controlIds.has(cell.controlId)) {
        diagnostics.push({
          severity: "error",
          code: "dangling-control-reference",
          path: `${cellPath}.controlId`,
          message: `Grid cell references controlId "${cell.controlId}", which isn't declared in controls.`,
        });
      }
    });
  });

  return diagnostics;
}

function checkSysEx(value: unknown): ProfileDiagnostic[] {
  if (!isRecord(value)) return [];
  if (value.required === true && (!Array.isArray(value.manufacturerId) || value.manufacturerId.length === 0)) {
    return [
      {
        severity: "error",
        code: "sysex-required-no-manufacturer-id",
        path: "sysex.manufacturerId",
        message: "sysex.required is true but no manufacturerId is declared.",
      },
    ];
  }
  return [];
}

function checkHandshake(value: unknown): ProfileDiagnostic[] {
  if (!isRecord(value)) return [];

  const diagnostics: ProfileDiagnostic[] = [];
  const steps = Array.isArray(value.steps) ? value.steps : [];

  if (value.required === true && steps.length === 0) {
    diagnostics.push({
      severity: "error",
      code: "handshake-required-no-steps",
      path: "handshake.steps",
      message: "handshake.required is true but no steps are declared — report this rather than assuming none is needed.",
    });
  }

  steps.forEach((step, index) => {
    const path = `handshake.steps[${index}]`;
    if (!isRecord(step)) return;

    if (!isHandshakeDirection(step.direction)) {
      diagnostics.push({ severity: "error", code: "unknown-handshake-direction", path: `${path}.direction`, message: `Unknown handshake direction ${JSON.stringify(step.direction)}.` });
    }
    if (typeof step.description !== "string" || step.description.trim() === "") {
      diagnostics.push({ severity: "warning", code: "handshake-step-missing-description", path: `${path}.description`, message: "Handshake step has no description." });
    }
  });

  return diagnostics;
}
