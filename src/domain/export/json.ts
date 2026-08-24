import { HISTORY_SCOPE, JSON_FORMAT_VERSION, SCHEMA_NAME, SCHEMA_VERSION, SNAPSHOT_SCOPE } from './constants';
import { fail, success } from './errors';
import { assertSnapshotFresh, EXPORT_LIMITS } from './snapshot';
import { preflightUnicode, utf8Bytes } from './unicode';
import { parseJsonWithUniqueKeys, validateWireSnapshot } from './validator';
import type { ExportResult, ExportSnapshotV1, SerializedExport, TimeContext } from './types';

function jsonString(value: string): string {
  let result = '"';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index) as number;
    if (code > 0xffff) index += 1;
    switch (code) {
      case 0x08:
      case 0x09:
      case 0x0a:
      case 0x0c:
      case 0x0d:
        result += `\\u${code.toString(16).padStart(4, '0').toUpperCase()}`;
        break;
      case 0x22:
        result += '\\"';
        break;
      case 0x5c:
        result += '\\\\';
        break;
      default:
        if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || (code >= 0x2028 && code <= 0x2029) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0x200e || code === 0x200f) {
          result += `\\u${code.toString(16).padStart(4, '0').toUpperCase()}`;
        } else {
          result += String.fromCodePoint(code);
        }
    }
  }
  return `${result}"`;
}

export function canonicalJsonStringify(value: unknown, indent = 0): string {
  return renderJson(value, Math.floor(indent / 2));
}

function renderJson(value: unknown, level: number): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return jsonString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite-number');
    return String(value);
  }
  if (typeof value === 'bigint' || typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') throw new Error('unsupported-json-value');
  if (Array.isArray(value)) {
    if (value.some((item) => item === undefined)) throw new Error('undefined-array-value');
    const items = value.map((item) => renderJson(item, level + 1));
    if (items.length === 0) return '[]';
    const pad = ' '.repeat((level + 1) * 2);
    const closePad = ' '.repeat(level * 2);
    return `[\n${items.map((item) => `${pad}${item}`).join(',\n')}\n${closePad}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.some(([, item]) => item === undefined)) throw new Error('undefined-object-value');
    if (entries.length === 0) return '{}';
    const pad = ' '.repeat((level + 1) * 2);
    const closePad = ' '.repeat(level * 2);
    const items = entries.map(([key, item]) => `${pad}${jsonString(key)}: ${renderJson(item, level + 1)}`);
    return `{\n${items.join(',\n')}\n${closePad}}`;
  }
  throw new Error('unsupported-json-value');
}

export function toJsonWireSnapshot(snapshot: ExportSnapshotV1, fileGeneratedAt: TimeContext): Record<string, unknown> {
  return {
    schema_name: SCHEMA_NAME,
    schema_version: SCHEMA_VERSION,
    format_name: 'json',
    format_version: JSON_FORMAT_VERSION,
    snapshot_scope: SNAPSHOT_SCOPE,
    history_scope: HISTORY_SCOPE,
    snapshot_revision: snapshot.snapshot_revision,
    snapshot_captured_at: snapshot.snapshot_captured_at,
    file_generated_at: fileGeneratedAt,
    application_build: snapshot.application_build,
    ruleset: snapshot.ruleset,
    currency_table: snapshot.currency_table,
    dictionaries: snapshot.dictionaries,
    comparison_context: snapshot.comparison_context,
    inputs: snapshot.inputs,
    results: snapshot.results,
    decision: snapshot.decision,
    review: snapshot.review,
    confirmed_revisions: snapshot.confirmed_revisions,
    notices: snapshot.notices,
  };
}

function fileStem(snapshot: ExportSnapshotV1): string {
  const instant = snapshot.snapshot_captured_at.occurred_at_utc;
  const match = /^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})/.exec(instant.replace(/[-:]/g, ''));
  if (!match) throw new Error('invalid-captured-time');
  return `zhiguan-purchase-decision-${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6]}Z`;
}

export interface SerializeJsonOptions {
  file_generated_at?: TimeContext;
  current_session_revision?: number;
  currentSessionRevision?: number;
}

export function serializeJsonSnapshot(snapshot: ExportSnapshotV1, options: SerializeJsonOptions = {}): ExportResult<SerializedExport> {
  if (snapshot.lifecycle === 'stale') return fail('export-snapshot-stale');
  const currentRevision = options.current_session_revision ?? options.currentSessionRevision;
  if (currentRevision !== undefined) {
    const fresh = assertSnapshotFresh(snapshot, currentRevision);
    if (!fresh.ok) return fresh;
  }
  const fileGeneratedAt = options.file_generated_at;
  if (!fileGeneratedAt) return fail('export-required-metadata-missing');
  try {
    const wire = toJsonWireSnapshot(snapshot, fileGeneratedAt);
    const unicode = preflightUnicode(wire);
    if (!unicode.ok) return unicode;
    const validation = validateWireSnapshot(wire);
    if (!validation.ok) return validation;
    const text = `${canonicalJsonStringify(wire, 0)}\n`;
    const bytes = utf8Bytes(text);
    if (bytes === 0 || bytes > EXPORT_LIMITS.format_utf8_bytes) return fail('export-resource-limit-exceeded');
    const roundTrip = parseJsonWithUniqueKeys(text);
    if (!roundTrip.ok) return roundTrip;
    const roundTripValidation = validateWireSnapshot(roundTrip.value);
    if (!roundTripValidation.ok) return roundTripValidation;
    return success({
      format: 'json',
      mime: 'application/json',
      file_name: `${fileStem(snapshot)}.json`,
      text,
      bytes,
      snapshot_revision: snapshot.snapshot_revision,
      snapshot_captured_at: snapshot.snapshot_captured_at,
    });
  } catch {
    return fail('export-serialization-failed');
  }
}

export const serializeJSON = serializeJsonSnapshot;
export const serializeJson = serializeJsonSnapshot;

function containsShortControlEscape(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\\') continue;
    let slashCount = 0;
    while (index + slashCount < text.length && text[index + slashCount] === '\\') slashCount += 1;
    const escaped = text[index + slashCount];
    if (slashCount % 2 === 1 && ['b', 't', 'n', 'f', 'r'].includes(escaped ?? '')) return true;
    index += slashCount - 1;
  }
  return false;
}

export function parseJsonExport(text: string): ExportResult<Record<string, unknown>> {
  if (text.charCodeAt(0) === 0xfeff || /\r/.test(text) || !text.endsWith('\n') || text.endsWith('\n\n') || containsShortControlEscape(text)) return fail('export-schema-mismatch');
  const parsed = parseJsonWithUniqueKeys(text);
  if (!parsed.ok) return parsed;
  const validation = validateWireSnapshot(parsed.value);
  if (!validation.ok) return validation;
  return success(parsed.value as Record<string, unknown>);
}
