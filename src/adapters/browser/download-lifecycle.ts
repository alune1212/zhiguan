import { fail, success } from '../../domain/export/errors';
import { utf8Bytes } from '../../domain/export/unicode';
import type { ExportResult } from '../../domain/export/types';

export interface DownloadEnvironment {
  document?: Document;
  window?: Window;
  URL?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  Blob?: typeof Blob;
  setTimeout?: typeof setTimeout;
}

export interface DownloadResource {
  anchor: HTMLAnchorElement | null;
  blob: Blob | null;
  object_url: string | null;
  cleanup: () => ExportResult<void>;
}

/** Internal extension keeps the lifecycle object free of user data. */
export type InternalDownloadResource = DownloadResource & {
  url_api?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  pagehide_cleanup?: () => void;
};

let activeResource: DownloadResource | null = null;
let cleanupBlocked = false;

/** Mark the adapter unavailable after any lifecycle cleanup exception. */
export function markCleanupBlocked(): void {
  cleanupBlocked = true;
}

function removeAnchor(anchor: HTMLAnchorElement | null): boolean {
  if (!anchor) return true;
  try {
    anchor.remove();
    return true;
  } catch {
    // Never expose the DOM exception or any user content in the error surface.
    return false;
  }
}

/** Detach the transient anchor immediately after a successful synchronous click. */
export function detachDownloadAnchor(resource: InternalDownloadResource): ExportResult<void> {
  if (!resource.anchor) return success(undefined);
  if (!removeAnchor(resource.anchor)) {
    cleanupBlocked = true;
    return fail('export-resource-cleanup-failed');
  }
  resource.anchor = null;
  return success(undefined);
}

export function cleanupDownloadResource(resource: InternalDownloadResource): ExportResult<void> {
  let failed = !removeAnchor(resource.anchor);
  if (resource.object_url) {
    try {
      // URL is captured by the adapter; no global URL lookup occurs here.
      if (!resource.url_api) throw new Error('missing-url-api');
      resource.url_api.revokeObjectURL(resource.object_url);
    } catch {
      failed = true;
    }
  }
  resource.anchor = null;
  resource.blob = null;
  resource.object_url = null;
  if (activeResource === resource) activeResource = null;
  if (failed) {
    markCleanupBlocked();
    return fail('export-resource-cleanup-failed');
  }
  return success(undefined);
}

export function registerDownloadResource(resource: InternalDownloadResource): ExportResult<void> {
  if (cleanupBlocked) return fail('export-resource-cleanup-failed');
  if (activeResource) {
    const previous = activeResource as InternalDownloadResource;
    const cleaned = previous.cleanup();
    if (!cleaned.ok) return cleaned;
  }
  activeResource = resource;
  return success(undefined);
}

export function clearCleanupBlock(): void {
  cleanupBlocked = false;
}

export function currentDownloadResource(): DownloadResource | null {
  return activeResource;
}

export function byteLengthMatchesBlob(text: string, blob: Blob): boolean {
  return utf8Bytes(text) === blob.size;
}
