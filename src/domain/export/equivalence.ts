import { fail, success } from './errors';
import { decodeMarkdownSnapshot } from './markdown';
import { parseJsonExport } from './json';
import type { ExportResult, SerializedExport } from './types';

function parseJsonInput(value: string | SerializedExport): ExportResult<Record<string, unknown>> {
  return parseJsonExport(typeof value === 'string' ? value : value.text);
}

function parseMarkdownInput(value: string | SerializedExport): ExportResult<Record<string, unknown>> {
  return decodeMarkdownSnapshot(typeof value === 'string' ? value : value.text);
}

function semanticProjection(value: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  delete clone.format_name;
  delete clone.format_version;
  delete clone.file_generated_at;
  return clone;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }
  if (typeof left === 'object' && typeof right === 'object') {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => key in rightRecord && deepEqual(leftRecord[key], rightRecord[key]));
  }
  return false;
}

export function compareJsonMarkdownSemantics(
  json: string | SerializedExport,
  markdown: string | SerializedExport,
): ExportResult<void> {
  const parsedJson = parseJsonInput(json);
  if (!parsedJson.ok) return parsedJson;
  const parsedMarkdown = parseMarkdownInput(markdown);
  if (!parsedMarkdown.ok) return parsedMarkdown;
  if (parsedJson.value.snapshot_revision !== parsedMarkdown.value.snapshot_revision || !deepEqual(parsedJson.value.snapshot_captured_at, parsedMarkdown.value.snapshot_captured_at)) return fail('export-contract-breach');
  return deepEqual(semanticProjection(parsedJson.value), semanticProjection(parsedMarkdown.value)) ? success(undefined) : fail('export-contract-breach');
}

export const assertCrossFormatEquivalent = compareJsonMarkdownSemantics;
export const compareCrossFormatSemantics = compareJsonMarkdownSemantics;
