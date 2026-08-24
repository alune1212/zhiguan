import { fail, success } from './errors';
import type { DownloadFormat, DownloadState, ExportError, ExportResult, ExportSnapshotV1 } from './types';

export function isDownloadFormat(value: unknown): value is DownloadFormat {
  return value === 'json' || value === 'markdown';
}

export interface FormatExportState {
  state: DownloadState;
  error: ExportError | null;
}

export interface ExportFormatStates {
  json: FormatExportState;
  markdown: FormatExportState;
}

export type ExportStateEvent =
  | { type: 'preview' }
  | { type: 'ready' }
  | { type: 'generate' }
  | { type: 'download-requested' }
  | { type: 'cancel' }
  | { type: 'fail'; error: ExportError }
  | { type: 'reset' };

export function createExportFormatStates(): ExportFormatStates {
  return {
    json: { state: 'idle', error: null },
    markdown: { state: 'idle', error: null },
  };
}

const TRANSITIONS: Record<DownloadState, Partial<Record<ExportStateEvent['type'], DownloadState>>> = {
  idle: { preview: 'previewing', reset: 'idle' },
  previewing: { ready: 'ready', cancel: 'cancelled', fail: 'failed', reset: 'idle' },
  ready: { generate: 'generating', cancel: 'cancelled', fail: 'failed', reset: 'idle' },
  generating: { 'download-requested': 'download-requested', fail: 'failed', cancel: 'cancelled', reset: 'idle' },
  'download-requested': { reset: 'idle', preview: 'previewing' },
  failed: { reset: 'idle', preview: 'previewing' },
  cancelled: { reset: 'idle', preview: 'previewing' },
};

export function transitionExportState(current: FormatExportState, event: ExportStateEvent): ExportResult<FormatExportState> {
  const transitions = current && typeof current === 'object' ? TRANSITIONS[current.state] : undefined;
  const next = transitions && event && typeof event === 'object' ? transitions[event.type] : undefined;
  if (!next) return fail('export-schema-mismatch');
  return success({
    state: next,
    error: event.type === 'fail' ? event.error : null,
  });
}

export function transitionFormat(
  states: ExportFormatStates,
  format: DownloadFormat,
  event: ExportStateEvent,
): ExportResult<ExportFormatStates> {
  if (!isDownloadFormat(format) || !states || typeof states !== 'object' || !states[format]) return fail('export-schema-mismatch');
  const next = transitionExportState(states[format], event);
  if (!next.ok) return next;
  return success({ ...states, [format]: next.value });
}

export function snapshotFilenameStem(snapshot: ExportSnapshotV1): string {
  const compact = snapshot.snapshot_captured_at.occurred_at_utc.replace(/[-:]/g, '');
  const match = /^(\d{8})T(\d{6})/.exec(compact);
  if (!match) throw new Error('invalid-captured-time');
  return `zhiguan-purchase-decision-${match[1]}T${match[2]}Z`;
}

export function suggestExportFileName(snapshot: ExportSnapshotV1, format: DownloadFormat): string {
  if (!isDownloadFormat(format)) throw new Error('export-schema-mismatch');
  return `${snapshotFilenameStem(snapshot)}.${format === 'json' ? 'json' : 'md'}`;
}
