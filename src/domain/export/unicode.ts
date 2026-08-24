import { fail, success } from './errors';
import type { ExportResult } from './types';

/** Normalize only line separators; validation is performed before TextEncoder. */
export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

/** Return false for NUL and lone UTF-16 surrogate code units. */
export function isUnicodeScalarSequence(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

export function preflightUnicode(value: unknown): ExportResult<void> {
  if (typeof value === 'string') {
    if (!isUnicodeScalarSequence(value)) return fail('export-invalid-unicode');
    return success(undefined);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = preflightUnicode(item);
      if (!result.ok) return result;
    }
    return success(undefined);
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      const keyResult = preflightUnicode(key);
      if (!keyResult.ok) return keyResult;
      const itemResult = preflightUnicode(item);
      if (!itemResult.ok) return itemResult;
    }
  }
  return success(undefined);
}

export function normalizeUnicodeTree<T>(value: T): T {
  if (typeof value === 'string') return normalizeLineEndings(value) as T;
  if (Array.isArray(value)) return value.map((item) => normalizeUnicodeTree(item)) as T;
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[normalizeLineEndings(key)] = normalizeUnicodeTree(item);
    }
    return result as T;
  }
  return value;
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Reversible, inert representation for user free text in Markdown code blocks.
 * LF stays a line break; all other structural/control characters are visible.
 */
export function encodeUnicodeVisibleEscape(value: string): string {
  const normalized = normalizeLineEndings(value);
  let result = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = normalized.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) throw new Error('invalid-unicode');
      const scalar = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
      result += encodeVisibleScalar(scalar);
      index += 1;
      continue;
    }
    if (code >= 0xdc00 || code === 0) throw new Error('invalid-unicode');
    result += encodeVisibleScalar(code);
  }
  return result;
}

function encodeVisibleScalar(code: number): string {
  if (code === 0x0a) return '\n';
  if (code === 0x09) return '\\t';
  if (code === 0x5c) return '\\\\';
  if (
    (code >= 0x00 && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x2028 && code <= 0x2029) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0x200e ||
    code === 0x200f
  ) {
    return `\\u{${code.toString(16).toUpperCase()}}`;
  }
  return String.fromCodePoint(code);
}

export function decodeUnicodeVisibleEscape(value: string): ExportResult<string> {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== '\\') {
      const code = value.charCodeAt(index);
      if (
        code === 0 ||
        (code < 0x20 && code !== 0x0a) ||
        (code >= 0x7f && code <= 0x9f) ||
        (code >= 0x2028 && code <= 0x2029) ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069) ||
        code === 0x200e ||
        code === 0x200f
      ) return fail('export-invalid-unicode');
      if (code >= 0xd800 && code <= 0xdbff) {
        const low = value.charCodeAt(index + 1);
        if (low < 0xdc00 || low > 0xdfff) return fail('export-invalid-unicode');
        result += value.slice(index, index + 2);
        index += 1;
      } else if (code >= 0xdc00 || code === 0) {
        return fail('export-invalid-unicode');
      } else {
        result += character;
      }
      continue;
    }
    if (index + 1 >= value.length) return fail('export-invalid-unicode');
    const next = value[index + 1];
    if (next === '\\') {
      result += '\\';
      index += 1;
      continue;
    }
    if (next === 't') {
      result += '\t';
      index += 1;
      continue;
    }
    if (next !== 'u' || value[index + 2] !== '{') return fail('export-invalid-unicode');
    const end = value.indexOf('}', index + 3);
    if (end === -1) return fail('export-invalid-unicode');
    const digits = value.slice(index + 3, end);
    if (!/^[0-9A-Fa-f]+$/.test(digits)) return fail('export-invalid-unicode');
    const scalar = Number.parseInt(digits, 16);
    if (scalar > 0x10ffff || (scalar >= 0xd800 && scalar <= 0xdfff) || scalar === 0) {
      return fail('export-invalid-unicode');
    }
    result += String.fromCodePoint(scalar);
    index = end;
  }
  return success(result);
}

export function longestRun(value: string, marker: '`' | '~'): number {
  let maximum = 0;
  const expression = marker === '`' ? /`+/g : /~+/g;
  for (const match of value.matchAll(expression)) maximum = Math.max(maximum, match[0].length);
  return maximum;
}
