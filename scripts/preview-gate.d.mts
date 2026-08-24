import type { PreviewServer } from "vite";

export declare class PreviewArtifactGateError extends Error {
  readonly code: "artifact-preview-gate-failed";
}

export declare function assertPreviewArtifact(rootDir: string): unknown;

export declare function createArtifactPreviewPlugin(): {
  readonly name: "zhiguan-artifact-preview-gate";
  configurePreviewServer(server: PreviewServer): void;
};
