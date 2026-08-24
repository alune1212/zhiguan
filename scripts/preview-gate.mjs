import { buildArtifactManifest } from "./build-manifest.mjs";

export class PreviewArtifactGateError extends Error {
  constructor() {
    super("artifact-preview-gate-failed");
    this.name = "PreviewArtifactGateError";
    this.code = "artifact-preview-gate-failed";
  }
}

/**
 * The package scripts perform this check as well, but direct `vite preview`
 * must not be able to bypass the same release/clean/matching-artifact gate.
 * Do not expose the underlying manifest error, which may contain paths.
 */
export function assertPreviewArtifact(rootDir) {
  try {
    return buildArtifactManifest({ rootDir, check: true });
  } catch (error) {
    if (error instanceof PreviewArtifactGateError) throw error;
    throw new PreviewArtifactGateError();
  }
}

export function createArtifactPreviewPlugin() {
  return {
    name: "zhiguan-artifact-preview-gate",
    configurePreviewServer(server) {
      assertPreviewArtifact(server.config.root);
    },
  };
}
