import { describe, expect, it } from "vitest";
import { DEVICE_PROFILE_SCHEMA_VERSION, type DeviceProfile } from "../types/profile.js";
import { DEVICE_OVERRIDES_SCHEMA_VERSION, type DeviceOverrides } from "../types/overrides.js";
import { validateDeviceOverrides } from "./validate-overrides.js";

function profile(): DeviceProfile {
  return {
    schemaVersion: DEVICE_PROFILE_SCHEMA_VERSION,
    identity: { id: "test.fixture", manufacturer: "Test Fixture Co.", model: "Fixture Device" },
    ports: [],
    controls: [],
  };
}

function overrides(): DeviceOverrides {
  return {
    schemaVersion: DEVICE_OVERRIDES_SCHEMA_VERSION,
    profileId: "test.fixture",
    profileSchemaVersion: DEVICE_PROFILE_SCHEMA_VERSION,
  };
}

describe("validateDeviceOverrides", () => {
  it("returns no diagnostics for a well-formed, matching overrides document", () => {
    expect(validateDeviceOverrides(profile(), overrides())).toEqual([]);
  });

  it("rejects a non-object document", () => {
    expect(validateDeviceOverrides(profile(), null)).toEqual([
      { severity: "error", code: "invalid-overrides", path: "", message: expect.any(String) },
    ]);
  });

  it("flags a missing/non-string schemaVersion", () => {
    const broken = { ...overrides(), schemaVersion: undefined };
    expect(validateDeviceOverrides(profile(), broken)).toContainEqual(
      expect.objectContaining({ code: "invalid-overrides", path: "schemaVersion" }),
    );
  });

  it("flags an unsupported overrides schemaVersion", () => {
    const broken = { ...overrides(), schemaVersion: "99.0" };
    expect(validateDeviceOverrides(profile(), broken)).toContainEqual(
      expect.objectContaining({ code: "unsupported-overrides-schema-version", path: "schemaVersion", severity: "error" }),
    );
  });

  it("flags a profileId that doesn't match the supplied profile", () => {
    const broken = { ...overrides(), profileId: "someone-else.device" };
    expect(validateDeviceOverrides(profile(), broken)).toContainEqual(
      expect.objectContaining({ code: "overrides-profile-mismatch", path: "profileId", severity: "error" }),
    );
  });

  it("warns (not errors) when profileSchemaVersion is stale relative to the supplied profile", () => {
    const broken = { ...overrides(), profileSchemaVersion: "0.9" };
    expect(validateDeviceOverrides(profile(), broken)).toContainEqual(
      expect.objectContaining({ code: "overrides-stale-profile-schema", path: "profileSchemaVersion", severity: "warning" }),
    );
  });

  it("flags a missing/non-string profileId and profileSchemaVersion", () => {
    expect(validateDeviceOverrides(profile(), { ...overrides(), profileId: 1 })).toContainEqual(
      expect.objectContaining({ code: "invalid-overrides", path: "profileId" }),
    );
    expect(validateDeviceOverrides(profile(), { ...overrides(), profileSchemaVersion: 1 })).toContainEqual(
      expect.objectContaining({ code: "invalid-overrides", path: "profileSchemaVersion" }),
    );
  });

  it("does not inspect layoutOverrides/bindingOverrides contents -- out of scope per the ECS-136 gate's own split", () => {
    const withOverrideData = { ...overrides(), layoutOverrides: { anything: "goes" }, bindingOverrides: 42 };
    expect(validateDeviceOverrides(profile(), withOverrideData)).toEqual([]);
  });
});
