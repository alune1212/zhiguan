import { describe, expect, it } from "vitest";

import {
  APPLICATION_BUILD_META,
  ApplicationBuildMetadataError,
  getBuildIdentityGate,
  readApplicationBuild,
  requireVerifiedBuildIdentity,
} from "../../../src/adapters/browser/build-metadata";

const VALID_VALUES = Object.freeze({
  [APPLICATION_BUILD_META.app_version]: "0.1.0",
  [APPLICATION_BUILD_META.git_commit_sha]: "a".repeat(40),
  [APPLICATION_BUILD_META.artifact_manifest_sha256]: "b".repeat(64),
  [APPLICATION_BUILD_META.config_version]: "research-static-config@1.0.0",
});

function metadataDocument(
  values: Readonly<Record<string, string | readonly string[]>> = VALID_VALUES,
) {
  return {
    querySelectorAll(selector: string) {
      const match = /^meta\[name="(.+)"\]$/u.exec(selector);
      const raw = match ? values[match[1]] : undefined;
      const contents = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
      return contents.map((content) => ({
        getAttribute: (name: string) => (name === "content" ? content : null),
      }));
    },
  };
}

describe("application build metadata adapter", () => {
  it("reads one valid fixed carrier without network access", () => {
    expect(readApplicationBuild(metadataDocument())).toEqual({
      app_version: "0.1.0",
      git_commit_sha: "a".repeat(40),
      artifact_manifest_sha256: "b".repeat(64),
      config_version: "research-static-config@1.0.0",
    });
  });

  it("exposes one centralized verified identity gate for session and export callers", () => {
    const gate = getBuildIdentityGate(metadataDocument());
    expect(gate).toEqual({
      status: "verified",
      applicationBuild: {
        app_version: "0.1.0",
        git_commit_sha: "a".repeat(40),
        artifact_manifest_sha256: "b".repeat(64),
        config_version: "research-static-config@1.0.0",
      },
      canStartSession: true,
      canExport: true,
      reason: "none",
    });
    expect(requireVerifiedBuildIdentity(metadataDocument())).toEqual(gate.applicationBuild);
  });

  it("rejects missing, duplicate, placeholder or malformed metadata", () => {
    const invalidCases = [
      { ...VALID_VALUES, [APPLICATION_BUILD_META.app_version]: [] },
      { ...VALID_VALUES, [APPLICATION_BUILD_META.app_version]: ["0.1.0", "0.1.0"] },
      { ...VALID_VALUES, [APPLICATION_BUILD_META.git_commit_sha]: "0".repeat(40) },
      { ...VALID_VALUES, [APPLICATION_BUILD_META.artifact_manifest_sha256]: "0".repeat(64) },
      { ...VALID_VALUES, [APPLICATION_BUILD_META.config_version]: "other@1.0.0" },
    ];

    for (const values of invalidCases) {
      expect(() => readApplicationBuild(metadataDocument(values))).toThrow(
        ApplicationBuildMetadataError,
      );
      expect(getBuildIdentityGate(metadataDocument(values))).toEqual({
        status: "unverified",
        applicationBuild: null,
        canStartSession: false,
        canExport: false,
        reason: "application-build-metadata-invalid",
      });
      expect(() => requireVerifiedBuildIdentity(metadataDocument(values))).toThrow(
        ApplicationBuildMetadataError,
      );
    }
  });
});
