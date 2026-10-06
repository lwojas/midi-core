import { isPortType } from "../../core/types/identity.js";
import { isMidiMessageType } from "../../core/types/message.js";
import { isControlKind, isControlValueMode, isFeedbackKind } from "../types/control.js";
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
 * understand, and a `sysex` marked `required` with no manufacturer id — the
 * "rather than invented" case named directly in the ticket. See
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
  diagnostics.push(...checkLayout(profile.layout, controlIds));
  diagnostics.push(...checkSysEx(profile.sysex));
  diagnostics.push(...checkSetup(profile.setup, profile.ports));
  diagnostics.push(...checkModes(profile.modes, profile.ports, controlIds));

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

    if (control.feedbackPortId !== undefined && (typeof control.feedbackPortId !== "string" || !portIds.has(control.feedbackPortId))) {
      diagnostics.push({
        severity: "error",
        code: "dangling-port-reference",
        path: `${path}.feedbackPortId`,
        message: `Control "${control.id}" references feedbackPortId ${JSON.stringify(control.feedbackPortId)}, which isn't declared in ports.`,
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

    // An RGB LED is driven by a SysEx message built from this prefix (ECS-95), so a missing or malformed one would silently send nothing.
    if (isRecord(control.feedback) && control.feedback.kind === "rgb-led") {
      const prefix = control.feedback.rgbSysExPrefix;
      const valid = Array.isArray(prefix) && prefix.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 0x7f);
      if (!valid) {
        diagnostics.push({
          severity: "error",
          code: "invalid-rgb-prefix",
          path: `${path}.feedback.rgbSysExPrefix`,
          message: "An rgb-led feedback needs rgbSysExPrefix: the SysEx bytes before the LED index, each 0-127.",
        });
      }
    }
  });

  return diagnostics;
}

/**
 * ECS-90: a layout's control ids must name controls on this profile. An unknown mode, page or transport name is
 * not checked here: the surface decides what a mode is, and the configuration reports any role it cannot bind.
 */
function checkLayout(value: unknown, controlIds: Set<string>): ProfileDiagnostic[] {
  if (value === undefined) return [];
  if (!isRecord(value)) {
    return [{ severity: "error", code: "invalid-layout", path: "layout", message: "layout must be an object when present." }];
  }

  const diagnostics: ProfileDiagnostic[] = [];

  const checkReference = (controlId: unknown, path: string) => {
    if (controlId === undefined) return;
    if (typeof controlId !== "string") {
      diagnostics.push({ severity: "error", code: "invalid-layout", path, message: "A layout control id must be a string." });
    } else if (!controlIds.has(controlId)) {
      diagnostics.push({
        severity: "error",
        code: "dangling-control-reference",
        path,
        message: `Layout references control "${controlId}", which isn't declared in controls.`,
      });
    }
  };

  if (value.modeButtons !== undefined) {
    if (!Array.isArray(value.modeButtons)) {
      diagnostics.push({ severity: "error", code: "invalid-layout", path: "layout.modeButtons", message: "layout.modeButtons must be an array." });
    } else {
      value.modeButtons.forEach((button, index) => {
        const path = `layout.modeButtons[${index}]`;
        if (!isRecord(button) || typeof button.mode !== "string") {
          diagnostics.push({ severity: "error", code: "invalid-layout", path, message: "A mode button needs a string controlId and mode." });
          return;
        }
        checkReference(button.controlId, `${path}.controlId`);
      });
    }
  }

  checkReference(value.pageLeft, "layout.pageLeft");
  checkReference(value.pageRight, "layout.pageRight");
  checkReference(value.pageUp, "layout.pageUp");
  checkReference(value.pageDown, "layout.pageDown");

  if (value.transport !== undefined) {
    if (!isRecord(value.transport)) {
      diagnostics.push({ severity: "error", code: "invalid-layout", path: "layout.transport", message: "layout.transport must be an object." });
    } else {
      for (const name of ["play", "stop", "record", "clear"] as const) checkReference(value.transport[name], `layout.transport.${name}`);
    }
  }

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

/**
 * ECS-96: a mode's messages must be real, and its send port must exist. The fader ports may be absent: a device
 * without them has the mode unavailable, not an invalid profile. Each fader port has to be listed in
 * `requiredPortIds`, so the mode's availability depends on it.
 */
function checkModes(value: unknown, ports: unknown, controlIds: ReadonlySet<string>): ProfileDiagnostic[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    return [{ severity: "error", code: "invalid-mode", path: "modes", message: "modes must be an array when present." }];
  }

  const diagnostics: ProfileDiagnostic[] = [];
  const declaredPorts = Array.isArray(ports) ? ports.filter(isRecord) : [];
  const seenIds = new Set<string>();
  // Fader mode ids and fader control ids are unique across the whole profile, since each names one mode or one control (ECS-100).
  const faderModeIds = new Set<string>();
  const faderControlIds = new Set<string>();

  // A port the device doesn't declare is fine when the mode is optional: the mode is simply unavailable. `mustExist`
  // is for the port every mode sends on. A declared port must still have the right type.
  const checkPort = (portId: unknown, expectedType: "input" | "output", path: string, mustExist: boolean) => {
    if (typeof portId !== "string") {
      diagnostics.push({ severity: "error", code: "invalid-mode", path, message: "A mode port reference must be a string." });
      return;
    }
    const port = declaredPorts.find((candidate) => candidate.id === portId);
    if (!port) {
      if (mustExist) {
        diagnostics.push({ severity: "error", code: "dangling-port-reference", path, message: `Mode references port "${portId}", which isn't declared in ports.` });
      }
    } else if (port.type !== expectedType) {
      diagnostics.push({ severity: "error", code: "invalid-mode", path, message: `Mode port "${portId}" must be an ${expectedType} port, but it is ${JSON.stringify(port.type)}.` });
    }
  };

  const checkMessage = (bytes: unknown, path: string) => {
    const valid =
      Array.isArray(bytes) &&
      bytes.length >= 2 &&
      bytes[0] === 0xf0 &&
      bytes[bytes.length - 1] === 0xf7 &&
      bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);
    if (!valid) {
      diagnostics.push({ severity: "error", code: "invalid-mode", path, message: "A mode message must be a complete SysEx message, from F0 to F7, with bytes 0-255." });
    }
  };

  value.forEach((mode, index) => {
    const path = `modes[${index}]`;
    if (!isRecord(mode) || typeof mode.id !== "string") {
      diagnostics.push({ severity: "error", code: "invalid-mode", path, message: "A mode must be an object with a string id." });
      return;
    }
    if (seenIds.has(mode.id)) {
      diagnostics.push({ severity: "error", code: "duplicate-mode-id", path: `${path}.id`, message: `Mode id "${mode.id}" is declared twice.` });
    }
    seenIds.add(mode.id);

    checkPort(mode.sendPortId, "output", `${path}.sendPortId`, true);
    const requiredPortIds: unknown[] = Array.isArray(mode.requiredPortIds) ? mode.requiredPortIds : [];
    if (!Array.isArray(mode.requiredPortIds)) {
      diagnostics.push({ severity: "error", code: "invalid-mode", path: `${path}.requiredPortIds`, message: "requiredPortIds must be an array of port ids." });
    } else {
      mode.requiredPortIds.forEach((portId, portIndex) => {
        if (typeof portId !== "string") {
          diagnostics.push({ severity: "error", code: "invalid-mode", path: `${path}.requiredPortIds[${portIndex}]`, message: "A required port id must be a string." });
        }
      });
    }

    if (!Array.isArray(mode.activate)) {
      diagnostics.push({ severity: "error", code: "invalid-mode", path: `${path}.activate`, message: "activate must be an array of SysEx messages." });
    } else {
      mode.activate.forEach((bytes, messageIndex) => checkMessage(bytes, `${path}.activate[${messageIndex}]`));
    }
    checkMessage(mode.showLayout, `${path}.showLayout`);
    if (mode.pageButtons !== undefined) {
      if (!isRecord(mode.pageButtons)) {
        diagnostics.push({ severity: "error", code: "invalid-mode", path: `${path}.pageButtons`, message: "pageButtons must be an object." });
      } else {
        for (const name of ["pageUp", "pageDown", "pageLeft", "pageRight"] as const) {
          const controlId = mode.pageButtons[name];
          if (controlId !== undefined && (typeof controlId !== "string" || !controlIds.has(controlId))) {
            diagnostics.push({ severity: "error", code: "dangling-control-reference", path: `${path}.pageButtons.${name}`, message: `Page button references control ${JSON.stringify(controlId)}, which isn't declared in controls.` });
          }
        }
      }
    }
    if (!Array.isArray(mode.bankPrefix) || mode.bankPrefix[0] !== 0xf0 || !mode.bankPrefix.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      diagnostics.push({ severity: "error", code: "invalid-mode", path: `${path}.bankPrefix`, message: "bankPrefix must start with F0 and hold bytes 0-255." });
    }
    const entryFields = ["index", "type", "controller", "colour"];
    const bankEntry: unknown[] = Array.isArray(mode.bankEntry) ? mode.bankEntry : [];
    if (!Array.isArray(mode.bankEntry) || bankEntry.length !== entryFields.length || !entryFields.every((field) => bankEntry.filter((f) => f === field).length === 1)) {
      diagnostics.push({ severity: "error", code: "invalid-mode", path: `${path}.bankEntry`, message: "bankEntry must list index, type, controller and colour, each once." });
    }
    const isDataByte = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 127;
    if (!isRecord(mode.bankTypes) || !isDataByte(mode.bankTypes.unipolar) || !isDataByte(mode.bankTypes.bipolar)) {
      diagnostics.push({ severity: "error", code: "invalid-mode", path: `${path}.bankTypes`, message: "bankTypes needs unipolar and bipolar, each a data byte from 0 to 127." });
    }
    if (typeof mode.resendBankOnPageTurn !== "boolean") {
      diagnostics.push({ severity: "error", code: "invalid-mode", path: `${path}.resendBankOnPageTurn`, message: "resendBankOnPageTurn must be true or false." });
    }
    if (mode.modeButtons !== undefined) {
      if (!Array.isArray(mode.modeButtons)) {
        diagnostics.push({ severity: "error", code: "invalid-mode", path: `${path}.modeButtons`, message: "modeButtons must be an array." });
      } else {
        mode.modeButtons.forEach((button, buttonIndex) => {
          const buttonPath = `${path}.modeButtons[${buttonIndex}]`;
          if (!isRecord(button) || typeof button.controlId !== "string" || typeof button.mode !== "string") {
            diagnostics.push({ severity: "error", code: "invalid-mode", path: buttonPath, message: "A mode button needs a string controlId and mode." });
          } else if (!controlIds.has(button.controlId)) {
            diagnostics.push({ severity: "error", code: "dangling-control-reference", path: `${buttonPath}.controlId`, message: `Mode button references control "${button.controlId}", which isn't declared in controls.` });
          }
        });
      }
    }
    if (!Array.isArray(mode.deactivate)) {
      diagnostics.push({ severity: "error", code: "invalid-mode", path: `${path}.deactivate`, message: "deactivate must be an array of SysEx messages." });
    } else {
      mode.deactivate.forEach((bytes, messageIndex) => checkMessage(bytes, `${path}.deactivate[${messageIndex}]`));
    }

    if (!isRecord(mode.faders)) {
      diagnostics.push({ severity: "error", code: "invalid-mode", path: `${path}.faders`, message: "A mode needs a faders description." });
      return;
    }
    const faders = mode.faders;
    checkPort(faders.inputPortId, "input", `${path}.faders.inputPortId`, false);
    checkPort(faders.feedbackPortId, "output", `${path}.faders.feedbackPortId`, false);
    for (const [name, portId] of [["inputPortId", faders.inputPortId], ["feedbackPortId", faders.feedbackPortId]] as const) {
      if (!requiredPortIds.includes(portId)) {
        diagnostics.push({ severity: "error", code: "invalid-mode", path: `${path}.faders.${name}`, message: `Fader port "${String(portId)}" must be listed in requiredPortIds, so the mode is unavailable without it.` });
      }
    }
    for (const [name, channel] of [["inputChannel", faders.inputChannel], ["feedbackChannel", faders.feedbackChannel]] as const) {
      if (!Number.isInteger(channel) || (channel as number) < 0 || (channel as number) > 15) {
        diagnostics.push({ severity: "error", code: "invalid-mode", path: `${path}.faders.${name}`, message: `${name} must be a channel from 0 to 15.` });
      }
    }
    if (!Array.isArray(faders.banks)) {
      diagnostics.push({ severity: "error", code: "invalid-mode", path: `${path}.faders.banks`, message: "faders.banks must be an array." });
      return;
    }
    const bankIds = new Set<string>();
    faders.banks.forEach((bank, bankIndex) => {
      const bankPath = `${path}.faders.banks[${bankIndex}]`;
      if (!isRecord(bank) || typeof bank.id !== "string" || typeof bank.bipolar !== "boolean") {
        diagnostics.push({ severity: "error", code: "invalid-mode", path: bankPath, message: "A fader bank needs a string id and a boolean bipolar." });
        return;
      }
      if (bankIds.has(bank.id)) {
        diagnostics.push({ severity: "error", code: "duplicate-mode-id", path: `${bankPath}.id`, message: `Fader bank id "${bank.id}" is declared twice in this mode.` });
      }
      bankIds.add(bank.id);
      if (typeof bank.modeId !== "string") {
        diagnostics.push({ severity: "error", code: "invalid-mode", path: `${bankPath}.modeId`, message: "A fader bank needs a string modeId." });
      } else if (faderModeIds.has(bank.modeId)) {
        diagnostics.push({ severity: "error", code: "duplicate-mode-id", path: `${bankPath}.modeId`, message: `Fader mode id "${bank.modeId}" is declared by two banks.` });
      } else {
        faderModeIds.add(bank.modeId);
      }
      if (!Number.isInteger(bank.colour) || (bank.colour as number) < 1 || (bank.colour as number) > 127) {
        diagnostics.push({ severity: "error", code: "invalid-mode", path: `${bankPath}.colour`, message: "A bank's colour is a palette entry from 1 to 127 (0 switches a fader off)." });
      }
      if (!Array.isArray(bank.controllers) || bank.controllers.length < 1 || bank.controllers.length > 8) {
        diagnostics.push({ severity: "error", code: "invalid-mode", path: `${bankPath}.controllers`, message: "A fader bank holds 1 to 8 faders, one CC each." });
        return;
      }
      const seen = new Set<number>();
      bank.controllers.forEach((controller, index) => {
        if (!Number.isInteger(controller) || (controller as number) < 0 || (controller as number) > 127 || seen.has(controller as number)) {
          diagnostics.push({ severity: "error", code: "invalid-mode", path: `${bankPath}.controllers[${index}]`, message: "Each fader's CC must be a distinct controller from 0 to 127." });
        }
        seen.add(controller as number);
      });
      if (!Array.isArray(bank.controlIds) || bank.controlIds.length !== bank.controllers.length) {
        diagnostics.push({ severity: "error", code: "invalid-mode", path: `${bankPath}.controlIds`, message: "A fader bank needs one control id per fader." });
        return;
      }
      bank.controlIds.forEach((controlId, index) => {
        const idPath = `${bankPath}.controlIds[${index}]`;
        if (typeof controlId !== "string" || !controlIds.has(controlId)) {
          diagnostics.push({ severity: "error", code: "dangling-control-reference", path: idPath, message: `Fader control ${JSON.stringify(controlId)} isn't declared in controls.` });
        } else if (faderControlIds.has(controlId)) {
          diagnostics.push({ severity: "error", code: "duplicate-control-id", path: idPath, message: `Fader control "${controlId}" is declared by two faders.` });
        } else {
          faderControlIds.add(controlId);
        }
      });
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

function checkSetup(value: unknown, ports: unknown): ProfileDiagnostic[] {
  if (value === undefined) return [];
  if (!isRecord(value) || typeof value.inputPortId !== "string" || typeof value.outputPortId !== "string" || !Array.isArray(value.steps)) {
    return [{ severity: "error", code: "invalid-setup", path: "setup", message: "setup must have string inputPortId/outputPortId and a steps array." }];
  }

  const diagnostics: ProfileDiagnostic[] = [];
  const declaredPorts = Array.isArray(ports) ? ports.filter(isRecord) : [];
  diagnostics.push(...checkSetupPort(declaredPorts, value.inputPortId, "input", "setup.inputPortId"));
  diagnostics.push(...checkSetupPort(declaredPorts, value.outputPortId, "output", "setup.outputPortId"));

  value.steps.forEach((step, index) => {
    diagnostics.push(...checkSetupStep(step, `setup.steps[${index}]`));
  });

  return diagnostics;
}

function checkSetupPort(ports: readonly Record<string, unknown>[], portId: string, expectedType: string, path: string): ProfileDiagnostic[] {
  const port = ports.find((candidate) => candidate.id === portId);
  if (!port) {
    return [{ severity: "error", code: "dangling-port-reference", path, message: `Setup references port "${portId}", which isn't declared in ports.` }];
  }
  if (port.type !== expectedType) {
    return [{ severity: "error", code: "setup-port-wrong-type", path, message: `Setup port "${portId}" must be an ${expectedType} port, but it is ${JSON.stringify(port.type)}.` }];
  }
  if (port.required !== true) {
    return [{ severity: "error", code: "setup-port-not-required", path, message: `Setup port "${portId}" must be required, so attach() connects it before setup runs.` }];
  }
  return [];
}

function checkSetupStep(value: unknown, path: string): ProfileDiagnostic[] {
  if (!isRecord(value) || typeof value.id !== "string") {
    return [{ severity: "error", code: "invalid-setup", path, message: "Setup step must be an object with a string id." }];
  }

  const diagnostics: ProfileDiagnostic[] = [];
  const hasSend = value.send !== undefined;
  const hasExpect = value.expect !== undefined;
  if (hasSend === hasExpect) {
    diagnostics.push({ severity: "error", code: "setup-step-needs-send-or-expect", path, message: `Setup step "${value.id}" must have exactly one of send or expect.` });
  }

  if (hasSend) {
    diagnostics.push(...checkBytes(value.send, `${path}.send`, false));
    if (Array.isArray(value.send) && value.send[0] === 0xf0 && value.send[value.send.length - 1] !== 0xf7) {
      diagnostics.push({ severity: "error", code: "setup-sysex-unterminated", path: `${path}.send`, message: `Setup step "${value.id}" starts a SysEx (0xF0) but does not end it with 0xF7.` });
    }
  }
  if (hasExpect) {
    diagnostics.push(...checkBytes(value.expect, `${path}.expect`, true));
  }

  if (typeof value.description !== "string" || value.description.trim() === "") {
    diagnostics.push({ severity: "warning", code: "setup-step-missing-description", path: `${path}.description`, message: "Setup step has no description." });
  }

  return diagnostics;
}

function checkBytes(value: unknown, path: string, allowWildcard: boolean): ProfileDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ severity: "error", code: "setup-byte-out-of-range", path, message: "Setup bytes must be a non-empty array." }];
  }
  const diagnostics: ProfileDiagnostic[] = [];
  value.forEach((byte, index) => {
    if (allowWildcard && byte === null) return;
    if (!Number.isInteger(byte) || (byte as number) < 0 || (byte as number) > 255) {
      diagnostics.push({
        severity: "error",
        code: "setup-byte-out-of-range",
        path: `${path}[${index}]`,
        message: `Byte ${JSON.stringify(byte)} is not an integer 0-255${allowWildcard ? " or null" : ""}.`,
      });
    }
  });
  return diagnostics;
}
