import { MARKDOWN_FORMAT_NAME, MARKDOWN_FORMAT_VERSION } from './constants';
import { fail, success } from './errors';
import { assertSnapshotFresh } from './snapshot';
import { isDownloadFormat, suggestExportFileName } from './state';
import type { DownloadFormat, ExportResult, ExportSnapshotV1 } from './types';

export interface ExportPreview {
  format: DownloadFormat;
  format_name: 'json' | typeof MARKDOWN_FORMAT_NAME;
  format_version: '1.0.0' | typeof MARKDOWN_FORMAT_VERSION;
  file_name: string;
  snapshot_revision: number;
  snapshot_captured_at: ExportSnapshotV1['snapshot_captured_at'];
  snapshot_scope: ExportSnapshotV1['snapshot_scope'];
  history_scope: ExportSnapshotV1['history_scope'];
  included_field_ids: readonly string[];
  sensitive_field_ids: readonly string[];
  device_control_notice: 'browser-and-device-determine-final-save';
}

export function previewExport(snapshot: ExportSnapshotV1, format: DownloadFormat, currentSessionRevision?: number): ExportResult<ExportPreview> {
  if (!isDownloadFormat(format)) return fail('export-schema-mismatch');
  if (snapshot.lifecycle === 'stale') return fail('export-snapshot-stale');
  if (currentSessionRevision !== undefined) {
    const fresh = assertSnapshotFresh(snapshot, currentSessionRevision);
    if (!fresh.ok) return fresh;
  }
  const sensitive = snapshot.dictionaries.field_definitions.filter((entry) => entry.sensitive).map((entry) => entry.id);
  return success({
    format,
    format_name: format === 'json' ? 'json' : MARKDOWN_FORMAT_NAME,
    format_version: format === 'json' ? '1.0.0' : MARKDOWN_FORMAT_VERSION,
    file_name: suggestExportFileName(snapshot, format),
    snapshot_revision: snapshot.snapshot_revision,
    snapshot_captured_at: snapshot.snapshot_captured_at,
    snapshot_scope: snapshot.snapshot_scope,
    history_scope: snapshot.history_scope,
    included_field_ids: snapshot.inputs.map((input) => input.field_id),
    sensitive_field_ids: sensitive,
    device_control_notice: 'browser-and-device-determine-final-save',
  });
}

export function confirmExportPreview(preview: ExportPreview, confirmed: boolean): 'ready' | 'cancelled' {
  void preview;
  return confirmed ? 'ready' : 'cancelled';
}

export const createExportPreview = previewExport;
