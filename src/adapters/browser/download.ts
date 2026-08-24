import { fail, success } from '../../domain/export/errors';
import { isUnicodeScalarSequence, utf8Bytes } from '../../domain/export/unicode';
import type { DownloadFormat, DownloadState, ExportResult } from '../../domain/export/types';
import {
  byteLengthMatchesBlob,
  cleanupDownloadResource,
  detachDownloadAnchor,
  markCleanupBlocked,
  type DownloadEnvironment,
  type InternalDownloadResource,
  registerDownloadResource,
} from './download-lifecycle';

export interface DownloadRequestOptions {
  format: DownloadFormat;
  text: string;
  file_name: string;
  mime: 'application/json' | 'text/markdown;charset=UTF-8;variant=GFM';
  /** Must be true when called synchronously from the explicit user action. */
  explicit_user_action?: boolean;
  explicitUserAction?: boolean;
  environment?: DownloadEnvironment;
}

export interface DownloadRequest {
  state: DownloadState;
  cleanup_result: ExportResult<void> | null;
  cleanup: () => ExportResult<void>;
  /** These references are cleared by cleanup; they are never logged or persisted. */
  blob: Blob | null;
  object_url: string | null;
}

const FILENAME = {
  json: /^zhiguan-purchase-decision-\d{8}T\d{6}Z\.json$/,
  markdown: /^zhiguan-purchase-decision-\d{8}T\d{6}Z\.md$/,
};

function bindTimer(timer: typeof setTimeout, owner: Window | undefined): typeof setTimeout {
  return ((callback: () => void, delay?: number) => owner
    ? owner.setTimeout(callback, delay)
    : timer(callback, delay)) as typeof setTimeout;
}

function runtimeEnvironment(environment: DownloadEnvironment | undefined): Required<DownloadEnvironment> {
  const value = environment ?? {};
  const resolvedWindow = value.window ?? (typeof window === 'undefined' ? undefined : window);
  const providedTimer = value.setTimeout;
  const windowTimer = resolvedWindow && typeof resolvedWindow.setTimeout === 'function'
    ? resolvedWindow.setTimeout
    : undefined;
  const timer = providedTimer
    ? (windowTimer && providedTimer === windowTimer ? bindTimer(providedTimer, resolvedWindow) : providedTimer)
    : windowTimer
      ? bindTimer(windowTimer as typeof setTimeout, resolvedWindow)
      : typeof globalThis.setTimeout === 'function'
        ? bindTimer(globalThis.setTimeout, undefined)
        : undefined;
  return {
    document: value.document ?? (typeof document === 'undefined' ? undefined : document),
    window: resolvedWindow,
    URL: value.URL ?? (typeof URL === 'undefined' ? undefined : URL),
    Blob: value.Blob ?? (typeof Blob === 'undefined' ? undefined : Blob),
    setTimeout: timer,
  } as Required<DownloadEnvironment>;
}

function removePagehideListener(environment: Required<DownloadEnvironment>, handler: (() => void) | undefined): boolean {
  if (!environment.window || !handler) return true;
  try {
    if (typeof environment.window.removeEventListener !== 'function') return false;
    environment.window.removeEventListener('pagehide', handler);
    return true;
  } catch {
    return false;
  }
}

export function requestBrowserDownload(options: DownloadRequestOptions): ExportResult<DownloadRequest> {
  const explicitlyActivated = options.explicit_user_action ?? options.explicitUserAction ?? false;
  if (!explicitlyActivated) return fail('export-download-request-failed');
  if (!isUnicodeScalarSequence(options.text)) return fail('export-invalid-unicode');
  const textBytes = utf8Bytes(options.text);
  if (textBytes === 0) return fail('export-invalid-unicode');
  if (textBytes > 1024 * 1024) return fail('export-resource-limit-exceeded');
  if (options.format !== 'json' && options.format !== 'markdown') return fail('export-schema-mismatch');
  if (options.mime !== (options.format === 'json' ? 'application/json' : 'text/markdown;charset=UTF-8;variant=GFM')) return fail('export-schema-mismatch');
  if (!FILENAME[options.format].test(options.file_name)) return fail('export-download-request-failed');

  const environment = runtimeEnvironment(options.environment);
  const DocumentConstructor = environment.document;
  const BlobConstructor = environment.Blob;
  const urlApi = environment.URL;
  if (!DocumentConstructor || !BlobConstructor || !urlApi || typeof urlApi.createObjectURL !== 'function' || typeof urlApi.revokeObjectURL !== 'function') return fail('export-unsupported-browser');

  let blob: Blob;
  try {
    blob = new BlobConstructor([options.text], { type: options.mime });
  } catch {
    return fail('export-blob-creation-failed');
  }
  if (!byteLengthMatchesBlob(options.text, blob) || blob.size > 1024 * 1024) return fail('export-resource-limit-exceeded');

  let objectUrl: string | null = null;
  try {
    objectUrl = urlApi.createObjectURL(blob);
    if (typeof objectUrl !== 'string' || objectUrl.length === 0) throw new Error('url');
  } catch {
    if (objectUrl !== null) {
      try {
        urlApi.revokeObjectURL(objectUrl);
      } catch {
        markCleanupBlocked();
        return fail('export-resource-cleanup-failed');
      }
    }
    return fail('export-blob-creation-failed');
  }
  if (objectUrl === null) return fail('export-blob-creation-failed');

  let anchor: HTMLAnchorElement;
  try {
    anchor = DocumentConstructor.createElement('a');
    anchor.href = objectUrl;
    anchor.download = options.file_name;
    anchor.rel = 'noopener';
  } catch {
    try {
      urlApi.revokeObjectURL(objectUrl);
    } catch {
      markCleanupBlocked();
      return fail('export-resource-cleanup-failed');
    }
    return fail('export-download-request-failed');
  }

  const request: DownloadRequest = {
    state: 'generating',
    cleanup_result: null,
    cleanup: () => success(undefined),
    blob,
    object_url: objectUrl,
  };
  let cleaned = false;
  const resource: InternalDownloadResource = {
    anchor,
    blob,
    object_url: objectUrl,
    url_api: urlApi,
    cleanup: () => {
      if (cleaned) {
        const previous = request.cleanup_result ?? success(undefined);
        if (!previous.ok) request.state = 'failed';
        return previous;
      }
      cleaned = true;
      let result = cleanupDownloadResource(resource);
      request.cleanup_result = result;
      request.blob = null;
      request.object_url = null;
      if (!removePagehideListener(environment, pagehideHandler)) {
        markCleanupBlocked();
        result = fail('export-resource-cleanup-failed');
        request.cleanup_result = result;
      }
      if (!result.ok) request.state = 'failed';
      return result;
    },
  };
  const pagehideHandler = () => {
    request.cleanup();
  };
  resource.pagehide_cleanup = pagehideHandler;
  request.cleanup = resource.cleanup;

  // Register before click so a second explicit action cannot leave the prior
  // object URL alive. No user content enters this adapter's error surface.
  const registered = registerDownloadResource(resource);
  if (!registered.ok) {
    request.cleanup();
    return registered;
  }
  try {
    if (!environment.window || typeof environment.window.addEventListener !== 'function' || typeof anchor.click !== 'function') throw new Error('download-api');
    environment.window?.addEventListener('pagehide', pagehideHandler, { once: true });
    // This is intentionally synchronous: callers must invoke us from the
    // format's explicit user activation, as required by ADR-0003.
    anchor.click();
    const detached = detachDownloadAnchor(resource);
    if (!detached.ok) {
      request.state = 'failed';
      const cleaned = request.cleanup();
      return cleaned.ok ? detached : cleaned;
    }
    request.state = 'download-requested';
  } catch {
    const cleanedResult = request.cleanup();
    request.state = 'failed';
    return cleanedResult.ok ? fail('export-download-request-failed') : cleanedResult;
  }
  try {
    if (typeof environment.setTimeout !== 'function') throw new Error('timer-api');
    environment.setTimeout(() => {
      request.cleanup();
    }, 0);
  } catch {
    const cleanedResult = request.cleanup();
    request.state = 'failed';
    return cleanedResult.ok ? fail('export-download-request-failed') : cleanedResult;
  }
  return success(request);
}

export const downloadText = requestBrowserDownload;
export const requestDownload = requestBrowserDownload;
