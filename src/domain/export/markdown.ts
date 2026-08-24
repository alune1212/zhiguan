import { MARKDOWN_FORMAT_NAME, MARKDOWN_FORMAT_VERSION, NOTICE_CODES, RESULT_FORMULA_IDS } from './constants';
import { fail, success } from './errors';
import { assertSnapshotFresh, EXPORT_LIMITS } from './snapshot';
import { canonicalJsonStringify, parseJsonExport, toJsonWireSnapshot } from './json';
import { longestRun, normalizeLineEndings, preflightUnicode, utf8Bytes } from './unicode';
import type { ExportResult, SerializedExport, TimeContext, ExportSnapshotV1 } from './types';
import { validateWireSnapshot } from './validator';

export interface SerializeMarkdownOptions {
  file_generated_at?: TimeContext;
  current_session_revision?: number;
  currentSessionRevision?: number;
}

function encodeMarkdownScalar(code: number): string {
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
  ) return `\\u{${code.toString(16).toUpperCase()}}`;
  return String.fromCodePoint(code);
}

/**
 * Encode text for the inert Markdown payload. This local implementation uses
 * UTF-16 surrogate ranges only for surrogate validation; ordinary BMP values
 * such as fullwidth punctuation and CJK text must remain valid scalars.
 */
function encodeMarkdownText(value: string): string {
  const normalized = normalizeLineEndings(value);
  let result = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const codeUnit = normalized.charCodeAt(index);
    let code = codeUnit;
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const low = normalized.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) throw new Error('invalid-unicode');
      code = 0x10000 + ((codeUnit - 0xd800) << 10) + (low - 0xdc00);
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new Error('invalid-unicode');
    }
    if (code === 0) throw new Error('invalid-unicode');
    result += encodeMarkdownScalar(code);
  }
  return result;
}

function isVisibleEscapeRestrictedScalar(code: number): boolean {
  return (
    code === 0 ||
    (code < 0x20 && code !== 0x0a) ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x2028 && code <= 0x2029) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0x200e ||
    code === 0x200f
  );
}

function decodeMarkdownText(value: string): ExportResult<string> {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== '\\') {
      const codeUnit = value.charCodeAt(index);
      if (isVisibleEscapeRestrictedScalar(codeUnit)) return fail('export-invalid-unicode');
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const low = value.charCodeAt(index + 1);
        if (low < 0xdc00 || low > 0xdfff) return fail('export-invalid-unicode');
        result += value.slice(index, index + 2);
        index += 1;
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
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
    if (scalar > 0x10ffff || (scalar >= 0xd800 && scalar <= 0xdfff) || scalar === 0) return fail('export-invalid-unicode');
    result += String.fromCodePoint(scalar);
    index = end;
  }
  return success(result);
}

function mapTextValues(value: unknown, map: (text: string) => string): unknown {
  if (Array.isArray(value)) return value.map((item) => mapTextValues(item, map));
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;

  // Recognize a text value at the record level before iterating its keys.
  // Otherwise a `kind` key encountered first can map `text`, and the later
  // ordinary `text` branch can overwrite it with the raw value.  Key order is
  // part of the wire contract and must not change the escaping semantics.
  if (record.kind === 'text' && typeof record.text === 'string') {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      copy[key] = key === 'text' ? map(record.text) : mapTextValues(item, map);
    }
    return copy;
  }

  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    copy[key] = mapTextValues(item, map);
  }
  return copy;
}

function encodeUserTextInWire(wire: Record<string, unknown>): Record<string, unknown> {
  return mapTextValues(wire, encodeMarkdownText) as Record<string, unknown>;
}

function decodeUserTextInWire(wire: Record<string, unknown>): ExportResult<Record<string, unknown>> {
  try {
    const decoded = mapTextValues(wire, (text) => {
      const value = decodeMarkdownText(text);
      if (!value.ok) throw new Error(value.error.code);
      return value.value;
    }) as Record<string, unknown>;
    return success(decoded);
  } catch {
    return fail('export-invalid-unicode');
  }
}

function fileStem(snapshot: ExportSnapshotV1): string {
  const instant = snapshot.snapshot_captured_at.occurred_at_utc.replace(/[-:]/g, '');
  const match = /^(\d{8})T(\d{6})/.exec(instant);
  if (!match) throw new Error('invalid-captured-time');
  return `zhiguan-purchase-decision-${match[1]}T${match[2]}Z`;
}

function summary(wire: Record<string, unknown>): string[] {
  const inputs = Array.isArray(wire.inputs) ? wire.inputs as Array<Record<string, unknown>> : [];
  const results = Array.isArray(wire.results) ? wire.results as Array<Record<string, unknown>> : [];
  const availableInputs = inputs.filter((input) => input.availability === 'available').map((input) => String(input.field_id));
  const unavailableResults = results.filter((result) => result.availability === 'unavailable').map((result) => String(result.formula_id));
  return [
    '# 值观购买决策会话快照',
    '',
    '## 文件范围与敏感提示',
    '',
    `- \`format_name\`: \`${MARKDOWN_FORMAT_NAME}\``,
    `- \`format_version\`: \`${MARKDOWN_FORMAT_VERSION}\``,
    '- 当前会话当前快照；文件下载后由浏览器和设备控制。',
    '- 原型不会把文件当作备份、分享或财务建议。',
    '',
    '## 版本与时间',
    '',
    `- ` + '`schema_name`' + `: ${String(wire.schema_name)}`,
    `- ` + '`schema_version`' + `: ${String(wire.schema_version)}`,
    `- ` + '`snapshot_revision`' + `: ${String(wire.snapshot_revision)}`,
    `- ` + '`snapshot_captured_at`' + `: ${String((wire.snapshot_captured_at as Record<string, unknown>).occurred_at_utc)}`,
    `- ` + '`file_generated_at`' + `: ${String((wire.file_generated_at as Record<string, unknown>).occurred_at_utc)}`,
    '',
    '## 状态与字段字典',
    '',
    `- 可用输入字段：${availableInputs.length > 0 ? availableInputs.map((id) => `\`${id}\``).join('、') : '未提供'}`,
    `- 数据不足结果：${unavailableResults.length > 0 ? unavailableResults.map((id) => `\`${id}\``).join('、') : '无'}`,
    `- 字典数组：${NOTICE_CODES.length + 4} 组固定数组，完整内容见语义载荷。`,
    '',
    '## 比较上下文',
    '',
    '| 字段 | 值 |',
    '| --- | --- |',
    `| period_ref | ${wire.comparison_context && (wire.comparison_context as Record<string, unknown>).period_ref ? '已提供' : '未提供'} |`,
    `| currency_code | ${String((wire.comparison_context as Record<string, unknown>).currency_code ?? '未提供')} |`,
    `| tax_basis | ${String((wire.comparison_context as Record<string, unknown>).tax_basis ?? '未提供')} |`,
    '',
    '## 当前输入',
    '',
    '每个固定输入均保留字段 ID、可用性、来源、证据状态、单位、周期、税口径、假设与限制。完整值见下方字面语义载荷。',
    '',
    '## 当前结果与依据',
    '',
    `固定结果顺序：${RESULT_FORMULA_IDS.map((id) => `\`${id}\``).join('、')}。精确值、展示值、公式、原因和修订语义见下方字面语义载荷。`,
    '',
    '## 价值期待与决定',
    '',
    '用户自由文本只在下方字面代码块中呈现，未进入标题、表格、链接或 HTML。',
    '',
    '## 复盘',
    '',
    '复盘条件或日期若已确认，会在语义载荷中保留；未提供时明确为 null。',
    '',
    '## 本次会话已确认修订',
    '',
    Array.isArray(wire.confirmed_revisions) && wire.confirmed_revisions.length > 0 ? `共 ${wire.confirmed_revisions.length} 条已确认修订。` : '无已确认修订。',
    '',
    '## 假设/限制',
    '',
    '规则内核的假设和限制按稳定代码保留；导出不添加或改写财务结论。',
    '',
    '## 下载后边界',
    '',
    '页面只表示已发起下载请求；最终是否保存、文件名和位置由浏览器与设备决定。',
  ];
}

function findPayload(text: string): ExportResult<string> {
  const lines = text.split('\n');
  for (let start = 0; start < lines.length; start += 1) {
    const opening = /^(\`{3,})json$/.exec(lines[start]);
    if (!opening) continue;
    const fence = opening[1];
    for (let end = start + 1; end < lines.length; end += 1) {
      if (lines[end] === fence) return success(lines.slice(start + 1, end).join('\n'));
    }
    return fail('export-schema-mismatch');
  }
  return fail('export-schema-mismatch');
}

const REQUIRED_HEADINGS = [
  '## 文件范围与敏感提示',
  '## 版本与时间',
  '## 状态与字段字典',
  '## 比较上下文',
  '## 当前输入',
  '## 当前结果与依据',
  '## 价值期待与决定',
  '## 复盘',
  '## 本次会话已确认修订',
  '## 假设/限制',
  '## 下载后边界',
  '## 完整语义载荷（字面代码块）',
] as const;

function markdownStructureIsSafe(text: string): boolean {
  const lines = text.split('\n');
  let payloadStart = -1;
  let payloadEnd = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\`{3,}json$/.test(lines[index])) {
      payloadStart = index;
      const fence = lines[index].match(/^(\`{3,})json$/)?.[1];
      payloadEnd = fence ? lines.indexOf(fence, index + 1) : -1;
      break;
    }
  }
  if (payloadStart < 0 || payloadEnd < 0) return false;
  const openingFence = lines[payloadStart].match(/^(\`{3,})json$/)?.[1];
  if (!openingFence) return false;
  const payload = lines.slice(payloadStart + 1, payloadEnd).join('\n');
  if (openingFence.length <= longestRun(payload, '`') || openingFence.length <= longestRun(payload, '~')) return false;
  let cursor = -1;
  for (const heading of REQUIRED_HEADINGS) {
    const found = lines.indexOf(heading);
    if (found <= cursor) return false;
    cursor = found;
  }
  const outside = lines.filter((_, index) => index < payloadStart || index > payloadEnd).join('\n');
  if (/<\/?[A-Za-z!][^>]*>/.test(outside) || /!?(?:\[[^\]]*\])\([^)]*\)/.test(outside) || /\bhttps?:\/\//i.test(outside)) return false;
  return true;
}

export function serializeMarkdownSnapshot(snapshot: ExportSnapshotV1, options: SerializeMarkdownOptions = {}): ExportResult<SerializedExport> {
  if (snapshot.lifecycle === 'stale') return fail('export-snapshot-stale');
  const currentRevision = options.current_session_revision ?? options.currentSessionRevision;
  if (currentRevision !== undefined) {
    const fresh = assertSnapshotFresh(snapshot, currentRevision);
    if (!fresh.ok) return fresh;
  }
  try {
    const fileGeneratedAt = options.file_generated_at;
    if (!fileGeneratedAt) return fail('export-required-metadata-missing');
    const wire = toJsonWireSnapshot(snapshot, fileGeneratedAt);
    const unicode = preflightUnicode(wire);
    if (!unicode.ok) return unicode;
    const validation = validateWireSnapshot(wire);
    if (!validation.ok) return validation;
    const payload = canonicalJsonStringify(encodeUserTextInWire(wire), 0);
    const fenceLength = Math.max(3, longestRun(payload, '`') + 1, longestRun(payload, '~') + 1);
    const fence = '`'.repeat(fenceLength);
    const lines = summary(wire);
    lines.push('', '## 完整语义载荷（字面代码块）', '', `${fence}json`, payload, fence, '');
    const text = lines.join('\n');
    if (!markdownStructureIsSafe(text)) return fail('export-contract-breach');
    const bytes = utf8Bytes(text);
    if (bytes === 0 || bytes > EXPORT_LIMITS.format_utf8_bytes) return fail('export-resource-limit-exceeded');
    return success({
      format: 'markdown',
      mime: 'text/markdown;charset=UTF-8;variant=GFM',
      file_name: `${fileStem(snapshot)}.md`,
      text,
      bytes,
      snapshot_revision: snapshot.snapshot_revision,
      snapshot_captured_at: snapshot.snapshot_captured_at,
    });
  } catch {
    return fail('export-serialization-failed');
  }
}

export const serializeMarkdown = serializeMarkdownSnapshot;
export const serializeGfmMarkdown = serializeMarkdownSnapshot;

export function decodeMarkdownSnapshot(text: string): ExportResult<Record<string, unknown>> {
  if (text.charCodeAt(0) === 0xfeff || /\r/.test(text) || !text.endsWith('\n') || text.endsWith('\n\n')) return fail('export-schema-mismatch');
  if (!markdownStructureIsSafe(text)) return fail('export-contract-breach');
  const payload = findPayload(text);
  if (!payload.ok) return payload;
  // The payload is a JSON object inside a fenced block, so the block itself
  // owns the terminal LF required by the outer Markdown file.
  const parsed = parseJsonExport(`${payload.value}\n`);
  if (!parsed.ok) return parsed;
  const decoded = decodeUserTextInWire(parsed.value);
  if (!decoded.ok) return decoded;
  const validation = validateWireSnapshot(decoded.value);
  if (!validation.ok) return validation;
  return success(decoded.value);
}
