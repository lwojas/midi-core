import { DEVICE_OVERRIDES_SCHEMA_VERSION } from "../types/overrides.js";
import type { DeviceProfile } from "../types/profile.js";
import type { ProfileDiagnostic } from "./types/diagnostic.js";

/**
 * Validates a `DeviceOverrides` **document** against the `DeviceProfile` it claims to apply to (ECS-137) —
 * deliberately typed `unknown` for `overrides`, the same "checking data that hasn't been trusted yet" stance
 * `validateDeviceProfile()` already takes.
 *
 * Version-check logic only, per the ECS-136 architecture gate's own scope split: this confirms the overrides
 * document is well-formed and was authored against *this* profile (`profileId`) and *this* profile schema version
 * (`profileSchemaVersion`), flagging staleness rather than silently applying overrides authored against a profile
 * shape that's since changed. It does not reach into `layoutOverrides`/`bindingOverrides`' own contents — validating
 * those against the profile's actual controls/bindings is ECS-142's job, once that schema is defined.
 */
export function validateDeviceOverrides(profile: DeviceProfile, overrides: unknown): readonly ProfileDiagnostic[] {
  if (!isRecord(overrides)) {
    return [{ severity: "error", code: "invalid-overrides", path: "", message: "Overrides document is not an object." }];
  }

  const diagnostics: ProfileDiagnostic[] = [];

  if (typeof overrides.schemaVersion !== "string") {
    diagnostics.push({ severity: "error", code: "invalid-overrides", path: "schemaVersion", message: "schemaVersion must be a string." });
  } else if (overrides.schemaVersion !== DEVICE_OVERRIDES_SCHEMA_VERSION) {
    diagnostics.push({
      severity: "error",
      code: "unsupported-overrides-schema-version",
      path: "schemaVersion",
      message: `Unsupported overrides schemaVersion "${overrides.schemaVersion}" — this version of midi-core understands "${DEVICE_OVERRIDES_SCHEMA_VERSION}".`,
    });
  }

  if (typeof overrides.profileId !== "string") {
    diagnostics.push({ severity: "error", code: "invalid-overrides", path: "profileId", message: "profileId must be a string." });
  } else if (overrides.profileId !== profile.identity.id) {
    diagnostics.push({
      severity: "error",
      code: "overrides-profile-mismatch",
      path: "profileId",
      message: `Overrides were authored for profile "${overrides.profileId}", not the supplied profile "${profile.identity.id}".`,
    });
  }

  if (typeof overrides.profileSchemaVersion !== "string") {
    diagnostics.push({ severity: "error", code: "invalid-overrides", path: "profileSchemaVersion", message: "profileSchemaVersion must be a string." });
  } else if (overrides.profileSchemaVersion !== profile.schemaVersion) {
    diagnostics.push({
      severity: "warning",
      code: "overrides-stale-profile-schema",
      path: "profileSchemaVersion",
      message: `Overrides were authored against profile schemaVersion "${overrides.profileSchemaVersion}", but the supplied profile is now "${profile.schemaVersion}" — re-validate layoutOverrides/bindingOverrides (ECS-142) before applying.`,
    });
  }

  return diagnostics;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
