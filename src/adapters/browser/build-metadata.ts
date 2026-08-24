import type { ApplicationBuild } from "../../domain/export/types";

export const APPLICATION_BUILD_META = Object.freeze({
  app_version: "application-build-app-version",
  git_commit_sha: "application-build-git-commit-sha",
  artifact_manifest_sha256: "artifact-manifest-sha256",
  config_version: "application-build-config-version",
} as const);

const EXACT_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const GIT_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ZERO_GIT_SHA = "0".repeat(40);
const ZERO_SHA256 = "0".repeat(64);
const CONFIG_VERSION = "research-static-config@1.0.0";

interface MetaElementLike {
  getAttribute(name: string): string | null;
}

interface BuildMetadataDocument {
  querySelectorAll(selector: string): ArrayLike<MetaElementLike>;
}

export type BuildIdentityStatus = "verified" | "unverified";

export interface BuildIdentityGate {
  readonly status: BuildIdentityStatus;
  readonly applicationBuild: Readonly<ApplicationBuild> | null;
  readonly canStartSession: boolean;
  readonly canExport: boolean;
  readonly reason: "none" | "application-build-metadata-invalid";
}

export class ApplicationBuildMetadataError extends Error {
  readonly code: "application-build-metadata-invalid";

  constructor() {
    super("application-build-metadata-invalid");
    this.name = "ApplicationBuildMetadataError";
    this.code = "application-build-metadata-invalid";
  }
}

function fail(): never {
  throw new ApplicationBuildMetadataError();
}

function readUniqueMeta(documentLike: BuildMetadataDocument, name: string): string {
  const elements = documentLike.querySelectorAll(`meta[name="${name}"]`);
  if (elements.length !== 1) fail();
  const value = elements[0]?.getAttribute("content");
  if (value === null || value.trim() !== value || value.length === 0) fail();
  return value;
}

/**
 * Read the four fixed build fields from the already-loaded document. This
 * adapter never fetches a manifest and rejects placeholder or duplicate
 * carriers before a session can start or an export can be frozen.
 */
export function readApplicationBuild(
  documentLike: BuildMetadataDocument = document,
): Readonly<ApplicationBuild> {
  const appVersion = readUniqueMeta(
    documentLike,
    APPLICATION_BUILD_META.app_version,
  );
  const gitCommitSha = readUniqueMeta(
    documentLike,
    APPLICATION_BUILD_META.git_commit_sha,
  );
  const artifactManifestSha256 = readUniqueMeta(
    documentLike,
    APPLICATION_BUILD_META.artifact_manifest_sha256,
  );
  const configVersion = readUniqueMeta(
    documentLike,
    APPLICATION_BUILD_META.config_version,
  );

  if (
    !EXACT_SEMVER.test(appVersion) ||
    !GIT_SHA.test(gitCommitSha) ||
    gitCommitSha === ZERO_GIT_SHA ||
    !SHA256.test(artifactManifestSha256) ||
    artifactManifestSha256 === ZERO_SHA256 ||
    configVersion !== CONFIG_VERSION
  ) {
    fail();
  }

  return Object.freeze({
    app_version: appVersion,
    git_commit_sha: gitCommitSha,
    artifact_manifest_sha256: artifactManifestSha256,
    config_version: configVersion,
  });
}

/**
 * Central fail-closed identity gate for the application and export layers.
 * Development preview may render around this gate, but session/export callers
 * can use the same `canStartSession`/`canExport` decision without parsing DOM
 * carriers or inventing a dirty-build fallback.
 */
export function getBuildIdentityGate(
  documentLike: BuildMetadataDocument = document,
): Readonly<BuildIdentityGate> {
  try {
    const applicationBuild = readApplicationBuild(documentLike);
    return Object.freeze({
      status: "verified" as const,
      applicationBuild,
      canStartSession: true,
      canExport: true,
      reason: "none" as const,
    });
  } catch {
    return Object.freeze({
      status: "unverified" as const,
      applicationBuild: null,
      canStartSession: false,
      canExport: false,
      reason: "application-build-metadata-invalid" as const,
    });
  }
}

export function requireVerifiedBuildIdentity(
  documentLike: BuildMetadataDocument = document,
): Readonly<ApplicationBuild> {
  const gate = getBuildIdentityGate(documentLike);
  if (!gate.canStartSession || gate.applicationBuild === null) fail();
  return gate.applicationBuild;
}
