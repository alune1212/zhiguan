import { ERROR_MESSAGES } from './constants';
import type { ExportError, ExportResult } from './types';

export function exportError(code: ExportError['code']): ExportError {
  return { code, message: ERROR_MESSAGES[code] };
}

export function fail<T>(code: ExportError['code']): ExportResult<T> {
  return { ok: false, error: exportError(code) };
}

export function success<T>(value: T): ExportResult<T> {
  return { ok: true, value };
}

export function isExportError(value: unknown): value is ExportError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof (value as { code?: unknown }).code === 'string' &&
    (value as { code: string }).code in ERROR_MESSAGES
  );
}
