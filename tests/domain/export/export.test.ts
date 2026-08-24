import { describe, expect, it } from 'vitest';
import { decodeMarkdownSnapshot, serializeMarkdownSnapshot } from '../../../src/domain/export/markdown';
import { compareJsonMarkdownSemantics } from '../../../src/domain/export/equivalence';
import { canonicalJsonStringify, parseJsonExport, serializeJsonSnapshot } from '../../../src/domain/export/json';
import { freezeExportSnapshot, markSnapshotStale } from '../../../src/domain/export/snapshot';
import { decodeUnicodeVisibleEscape, encodeUnicodeVisibleEscape } from '../../../src/domain/export/unicode';
import { parseJsonWithUniqueKeys } from '../../../src/domain/export/validator';
import { createExportFormatStates, suggestExportFileName, transitionFormat } from '../../../src/domain/export/state';
import { previewExport } from '../../../src/domain/export/preview';
import { FIXTURE_TIME, makeExportSource } from './helpers';

describe('ExportSnapshotV1 serializers', () => {
  it('freezes once and preserves JSON/Markdown semantic equivalence', () => {
    const frozen = freezeExportSnapshot(makeExportSource());
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    const fileGeneratedAt = { ...FIXTURE_TIME, occurred_at_utc: '2026-01-15T00:00:01.000Z' };
    const json = serializeJsonSnapshot(frozen.value, { file_generated_at: fileGeneratedAt });
    const markdown = serializeMarkdownSnapshot(frozen.value, { file_generated_at: fileGeneratedAt });
    expect(json.ok).toBe(true);
    expect(markdown.ok).toBe(true);
    if (!json.ok || !markdown.ok) return;
    expect(json.value.mime).toBe('application/json');
    expect(json.value.text.endsWith('\n')).toBe(true);
    expect(json.value.text).not.toContain('\r');
    expect(markdown.value.text.endsWith('\n')).toBe(true);
    expect(markdown.value.text).not.toContain('\r');
    expect(compareJsonMarkdownSemantics(json.value, markdown.value).ok).toBe(true);
    expect(parseJsonExport(json.value.text).ok).toBe(true);
    expect(parseJsonExport(json.value.text.slice(0, -1))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
    expect(decodeMarkdownSnapshot(markdown.value.text).ok).toBe(true);
  });

  it('keeps SYN-02/SYN-04-style unavailable and estimated states equivalent across formats', () => {
    const baseline = makeExportSource();
    const unavailableInputs = baseline.inputs.map((input) => input.field_id === 'work-hours'
      ? { ...input, availability: 'not-provided', value: null, source: null, evidence_status: null, unit: null, currency_code: null, currency_table_snapshot_id: null, period_ref: null, tax_basis: null, confirmed_at: null }
      : input);
    const unavailableResults = baseline.results.map((result) => ({
      ...result,
      availability: 'unavailable',
      exact_value: null,
      display_value: null,
      evidence_status: 'insufficient-data',
      reason_codes: ['missing-work-hours'],
      primary_reason_code: 'missing-work-hours',
      assumptions: [],
      limitations: [],
      rounding: null,
    }));
    const estimatedResults = baseline.results.map((result) => ({
      ...result,
      estimated_dependency_field_ids: result.dependency_field_ids.includes('work-hours') ? ['work-hours'] : [],
    }));
    const cases = [
      baseline,
      makeExportSource({ inputs: unavailableInputs, results: unavailableResults }),
      makeExportSource({ inputs: baseline.inputs.map((input) => input.field_id === 'work-hours' ? { ...input, evidence_status: 'estimated' } : input), results: estimatedResults }),
      makeExportSource({ inputs: baseline.inputs.map((input) => input.field_id === 'value-expectation' ? { ...input, value: { kind: 'text', text: '<script>alert(1)</script> [bad](https://example.invalid) <https://example.invalid> ~~~~~ ```', text_encoding: 'unicode-scalar-v1' } } : input) }),
    ];
    for (const [index, source] of cases.entries()) {
      const frozen = freezeExportSnapshot(source);
      expect(frozen.ok, `case ${index}`).toBe(true);
      if (!frozen.ok) continue;
      const json = serializeJsonSnapshot(frozen.value, { file_generated_at: FIXTURE_TIME });
      const markdown = serializeMarkdownSnapshot(frozen.value, { file_generated_at: FIXTURE_TIME });
      expect(json.ok).toBe(true);
      expect(markdown.ok).toBe(true);
      if (json.ok && markdown.ok) expect(compareJsonMarkdownSemantics(json.value, markdown.value)).toEqual({ ok: true, value: undefined });
    }
  });

  it('preserves a non-terminating exact rational as null decimal plus reduced rational', () => {
    const source = makeExportSource({
      results: makeExportSource().results.map((result) => result.formula_id === 'work-time-equivalent'
        ? {
          ...result,
          exact_value: { decimal: '128/11', rational: { numerator: '128', denominator: '11' }, unit: 'hour', currency_code: null },
          display_value: { text: '11.64 hour', decimal: '11.64', display_digits: 2, relation: 'rounded' },
          rounding: { mode: 'half-away-from-zero', display_digits: 2, rounded: true },
        }
        : result),
    });
    const frozen = freezeExportSnapshot(source);
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    expect(frozen.value.results[1].exact_value).toEqual({ decimal: null, rational: { numerator: '128', denominator: '11' }, unit: 'hour', currency_code: null });
    const json = serializeJsonSnapshot(frozen.value, { file_generated_at: FIXTURE_TIME });
    const markdown = serializeMarkdownSnapshot(frozen.value, { file_generated_at: FIXTURE_TIME });
    expect(json.ok).toBe(true);
    expect(markdown.ok).toBe(true);
    if (json.ok && markdown.ok) expect(compareJsonMarkdownSemantics(json.value, markdown.value)).toEqual({ ok: true, value: undefined });
  });

  it('keeps partial format failure independent and classifies cross-format drift as a contract breach', () => {
    const frozen = freezeExportSnapshot(makeExportSource());
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    const json = serializeJsonSnapshot(frozen.value, { file_generated_at: FIXTURE_TIME });
    const markdown = serializeMarkdownSnapshot(frozen.value, { file_generated_at: FIXTURE_TIME });
    expect(json.ok).toBe(true);
    expect(markdown.ok).toBe(true);
    if (!json.ok || !markdown.ok) return;
    const drifted = json.value.text.replace('"snapshot_revision": 1', '"snapshot_revision": 2');
    expect(compareJsonMarkdownSemantics(drifted, markdown.value)).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-contract-breach' }) });
    let states = createExportFormatStates();
    states = transitionFormat(states, 'json', { type: 'preview' }).value;
    states = transitionFormat(states, 'json', { type: 'ready' }).value;
    states = transitionFormat(states, 'json', { type: 'generate' }).value;
    states = transitionFormat(states, 'json', { type: 'download-requested' }).value;
    states = transitionFormat(states, 'markdown', { type: 'preview' }).value;
    states = transitionFormat(states, 'markdown', { type: 'fail', error: { code: 'export-contract-breach', message: 'stable' } }).value;
    expect(states.json.state).toBe('download-requested');
    expect(states.markdown.state).toBe('failed');
  });

  it('rejects invalid Unicode for the entire snapshot', () => {
    const invalid = makeExportSource({
      inputs: makeExportSource().inputs.map((input) => input.field_id === 'value-expectation' ? {
        ...input,
        value: { kind: 'text', text: 'bad\u0000text', text_encoding: 'unicode-scalar-v1' },
      } : input),
    });
    const frozen = freezeExportSnapshot(invalid);
    expect(frozen).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-invalid-unicode' }) });
  });

  it('marks a frozen snapshot stale after a confirmed revision', () => {
    const frozen = freezeExportSnapshot(makeExportSource());
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    markSnapshotStale(frozen.value);
    expect(serializeJsonSnapshot(frozen.value)).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-snapshot-stale' }) });
  });

  it('fails closed for conflicting revision aliases and abnormal lifecycle markers', () => {
    expect(freezeExportSnapshot(makeExportSource({ session_revision_start: 1, sessionRevisionStart: 2 }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
    expect(freezeExportSnapshot(makeExportSource({ session_revision: 2 }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
    expect(freezeExportSnapshot(makeExportSource({ pendingEdit: 'false' }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
    expect(freezeExportSnapshot(makeExportSource({ stale: true }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-pending-edit' }),
    });
    expect(freezeExportSnapshot(makeExportSource({ workflowStatus: 'pending-reconfirmation' }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-pending-edit' }),
    });
  });

  it('fails closed for nested alias conflicts before normalization', () => {
    const baseline = makeExportSource();
    const income = baseline.inputs.find((input) => input.field_id === 'income');
    if (!income || !income.value || income.value.kind !== 'money') throw new Error('fixture income');

    const equivalentMoney = {
      ...income,
      value: { ...income.value, minorUnits: income.value.minor_units },
    };
    const equivalent = freezeExportSnapshot(makeExportSource({
      inputs: baseline.inputs.map((input) => input.field_id === 'income' ? equivalentMoney : input),
    }));
    expect(equivalent.ok).toBe(true);

    const conflictingMoney = {
      ...income,
      value: { ...income.value, minorUnits: '1000001' },
    };
    expect(freezeExportSnapshot(makeExportSource({
      inputs: baseline.inputs.map((input) => input.field_id === 'income' ? conflictingMoney : input),
    }))).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-schema-mismatch' }) });

    const comparison = baseline.comparison_context;
    expect(freezeExportSnapshot(makeExportSource({
      comparison_context: { ...comparison, periodRef: comparison.period_ref },
    })).ok).toBe(true);
    expect(freezeExportSnapshot(makeExportSource({
      comparison_context: { ...comparison, periodRef: { ...comparison.period_ref, revision: 'other-period' } },
    }))).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-schema-mismatch' }) });

    const firstResult = baseline.results[0];
    expect(freezeExportSnapshot(makeExportSource({
      results: baseline.results.map((result, index) => index === 0 ? { ...result, generatedAt: result.generated_at } : result),
    })).ok).toBe(true);
    expect(freezeExportSnapshot(makeExportSource({
      results: baseline.results.map((result, index) => index === 0 ? {
        ...result,
        generatedAt: { ...firstResult.generated_at, occurred_at_utc: '2026-01-15T00:00:03.000Z' },
      } : result),
    }))).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-schema-mismatch' }) });

    expect(freezeExportSnapshot(makeExportSource({
      snapshotCapturedAt: baseline.snapshot_captured_at,
    })).ok).toBe(true);
    expect(freezeExportSnapshot(makeExportSource({
      snapshotCapturedAt: { ...baseline.snapshot_captured_at, recorded_at_utc: '2026-01-15T00:00:04.000Z' },
    }))).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-schema-mismatch' }) });
  });

  it('accepts only fixed rule notes and a consistent cost tax context', () => {
    const baseline = makeExportSource();
    const exact = freezeExportSnapshot(baseline);
    expect(exact.ok).toBe(true);

    const alteredLimitation = baseline.results.map((result) => result.formula_id === 'work-time-equivalent'
      ? { ...result, limitations: [{ id: 'work-time-equivalent.limitation-1', text: '<script>alert(1)</script>' }] }
      : result);
    expect(freezeExportSnapshot(makeExportSource({ results: alteredLimitation }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });

    const arbitraryAssumption = baseline.inputs.map((input) => input.field_id === 'value-expectation'
      ? { ...input, assumptions: [{ id: 'value-expectation.assumption-1', text: '用户自由文本' }] }
      : input);
    expect(freezeExportSnapshot(makeExportSource({ inputs: arbitraryAssumption }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });

    const wrongTaxBasis = baseline.inputs.map((input) => input.field_id === 'fixed-cost-total'
      ? { ...input, tax_basis: 'before-tax' as const }
      : input);
    expect(freezeExportSnapshot(makeExportSource({ inputs: wrongTaxBasis }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });

    const beforeTaxInputs = baseline.inputs.map((input) => {
      if (input.field_id === 'income' || input.field_id === 'fixed-cost-total') return { ...input, tax_basis: 'before-tax' as const };
      if (input.field_id === 'income-tax-basis') return { ...input, tax_basis: 'before-tax' as const, value: { kind: 'enum' as const, code: 'before-tax' } };
      return input;
    });
    const beforeTaxUnavailableResults = baseline.results.map((result) => ({
      ...result,
      availability: 'unavailable' as const,
      exact_value: null,
      display_value: null,
      tax_basis: 'before-tax' as const,
      evidence_status: 'insufficient-data' as const,
      reason_codes: ['tax-basis-not-after-tax'],
      primary_reason_code: 'tax-basis-not-after-tax',
      assumptions: [],
      limitations: [],
      rounding: null,
    }));
    expect(freezeExportSnapshot(makeExportSource({
      inputs: beforeTaxInputs,
      comparison_context: { ...baseline.comparison_context, tax_basis: 'before-tax' },
      results: beforeTaxUnavailableResults,
    })).ok).toBe(true);
  });

  it('rejects non-canonical revision sequence values and unknown runtime formats', () => {
    for (const sequence of ['0x1', '1e2', ' 1 ', '', '01', 0, 1.5]) {
      expect(freezeExportSnapshot(makeExportSource({ confirmed_revisions: [{ sequence }] }))).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'export-schema-mismatch' }),
      });
    }

    const frozen = freezeExportSnapshot(makeExportSource());
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    expect(previewExport(frozen.value, 'xml' as never)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
    expect(transitionFormat(createExportFormatStates(), 'xml' as never, { type: 'preview' })).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
    expect(() => suggestExportFileName(frozen.value, 'xml' as never)).toThrow('export-schema-mismatch');
  });

  it('requires an independent file generation time', () => {
    const frozen = freezeExportSnapshot(makeExportSource());
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    expect(serializeJsonSnapshot(frozen.value)).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-required-metadata-missing' }) });
    expect(serializeMarkdownSnapshot(frozen.value)).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-required-metadata-missing' }) });
    const generated = { ...FIXTURE_TIME, occurred_at_utc: '2026-01-15T00:00:02.000Z' };
    const json = serializeJsonSnapshot(frozen.value, { file_generated_at: generated });
    expect(json.ok).toBe(true);
    if (json.ok) expect(json.value.text).toContain('2026-01-15T00:00:02.000Z');
  });

  it('uses reversible visible Unicode escapes for hostile text', () => {
    const original = '反斜线\\\t\u0001\u202E\u2028\n```';
    const encoded = encodeUnicodeVisibleEscape(original);
    const decoded = decodeUnicodeVisibleEscape(encoded);
    expect(decoded).toEqual({ ok: true, value: original.replace(/\r\n?/g, '\n') });
  });

  it('maps Markdown text values once regardless of key order and round-trips hostile literals', () => {
    const original = 'C0\u0001 C1\u0085 bidi\u202E line\u2028 slash\\ tab\t LF\n <script>alert(1)</script> [url](https://example.invalid) <https://example.invalid>';
    const textValues = [
      { kind: 'text' as const, text: original, text_encoding: 'unicode-scalar-v1' as const },
      { text: original, text_encoding: 'unicode-scalar-v1' as const, kind: 'text' as const },
    ];
    for (const value of textValues) {
      const source = makeExportSource({
        inputs: makeExportSource().inputs.map((input) => input.field_id === 'value-expectation' ? { ...input, value } : input),
      });
      const frozen = freezeExportSnapshot(source);
      expect(frozen.ok).toBe(true);
      if (!frozen.ok) continue;
      const markdown = serializeMarkdownSnapshot(frozen.value, { file_generated_at: FIXTURE_TIME });
      expect(markdown.ok).toBe(true);
      if (!markdown.ok) continue;
      expect(markdown.value.text).toContain('<script>alert(1)</script>');
      expect(markdown.value.text).toContain('https://example.invalid');
      expect(markdown.value.text).toContain('\\u{1}');
      expect(markdown.value.text).toContain('\\u{85}');
      expect(markdown.value.text).toContain('\\u{202E}');
      expect(markdown.value.text).toContain('\\t');
      expect(markdown.value.text).toContain('\\\\');
      const decoded = decodeMarkdownSnapshot(markdown.value.text);
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) continue;
      const decodedInputs = decoded.value.inputs as Array<Record<string, unknown>>;
      const decodedExpectation = decodedInputs.find((input) => input.field_id === 'value-expectation');
      expect((decodedExpectation?.value as Record<string, unknown>).text).toBe(original);
    }
  });

  it('rejects non-canonical short JSON control escapes on decode', () => {
    const frozen = freezeExportSnapshot(makeExportSource({
      inputs: makeExportSource().inputs.map((input) => input.field_id === 'value-expectation'
        ? { ...input, value: { kind: 'text', text: 'line\n', text_encoding: 'unicode-scalar-v1' } }
        : input),
    }));
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    const json = serializeJsonSnapshot(frozen.value, { file_generated_at: FIXTURE_TIME });
    expect(json.ok).toBe(true);
    if (!json.ok) return;
    expect(json.value.text).toContain('\\u000A');
    expect(parseJsonExport(json.value.text.replace('\\u000A', '\\n'))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
  });

  it('uses canonical unicode escapes for JSON controls and sizes Markdown fences for both markers', () => {
    expect(canonicalJsonStringify('\b\t\n\f\r')).toBe('"\\u0008\\u0009\\u000A\\u000C\\u000D"');
    const frozen = freezeExportSnapshot(makeExportSource({
      inputs: makeExportSource().inputs.map((input) => input.field_id === 'value-expectation'
        ? { ...input, value: { kind: 'text', text: 'tilde ~~~~~ and backtick ```', text_encoding: 'unicode-scalar-v1' } }
        : input),
    }));
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    const markdown = serializeMarkdownSnapshot(frozen.value, { file_generated_at: FIXTURE_TIME });
    expect(markdown.ok).toBe(true);
    if (!markdown.ok) return;
    const opening = markdown.value.text.split('\n').find((line) => /^`{3,}json$/.test(line));
    expect(opening?.length ?? 0).toBeGreaterThan(5);
    expect(decodeMarkdownSnapshot(`<script>alert(1)</script>\n${markdown.value.text}`)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-contract-breach' }),
    });
  });

  it('rejects duplicate JSON keys instead of taking the last value', () => {
    expect(parseJsonWithUniqueKeys('{"a":1,"a":2}')).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-schema-mismatch' }) });
  });

  it('fails before loss at the revision limit', () => {
    const source = makeExportSource({
      confirmed_revisions: Array.from({ length: 51 }, (_, index) => ({ sequence: index + 1 })),
    });
    expect(freezeExportSnapshot(source)).toEqual({ ok: false, error: expect.objectContaining({ code: 'export-resource-limit-exceeded' }) });
  });

  it('keeps dictionaries self-describing and fixed', () => {
    const frozen = freezeExportSnapshot(makeExportSource());
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    expect(frozen.value.dictionaries.schema_fields[0]).toEqual({
      id: 'schema_name',
      label: '模式名称',
      definition: '固定的值观购买决策会话快照 schema 标识。',
    });
    expect(frozen.value.dictionaries.formula_definitions[0]).toMatchObject({
      id: 'income-rate',
      label: '收入时薪率',
      expression: '(I × Hd) / (S × Hn)',
    });

    const invalid = structuredClone(makeExportSource().dictionaries) as unknown as Record<string, unknown>;
    const fields = invalid.field_definitions as Array<Record<string, unknown>>;
    fields[0].text = fields[0].label;
    delete fields[0].label;
    expect(freezeExportSnapshot(makeExportSource({ dictionaries: invalid }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
  });

  it('fails closed instead of inventing result metadata', () => {
    const baseline = makeExportSource();
    const missingGeneratedAt = baseline.results.map((result) => ({ ...result })) as unknown as Array<Record<string, unknown>>;
    delete missingGeneratedAt[0].generated_at;
    expect(freezeExportSnapshot(makeExportSource({ results: missingGeneratedAt }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });

    const unknownAvailability = baseline.results.map((result) => ({ ...result })) as unknown as Array<Record<string, unknown>>;
    unknownAvailability[0].availability = 'pending';
    expect(freezeExportSnapshot(makeExportSource({ results: unknownAvailability }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });

    const missingRounding = baseline.results.map((result) => ({ ...result })) as unknown as Array<Record<string, unknown>>;
    delete missingRounding[0].rounding;
    expect(freezeExportSnapshot(makeExportSource({ results: missingRounding }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });

    const missingSource = makeExportSource().inputs.map((input) => ({ ...input })) as Array<Record<string, unknown>>;
    delete missingSource[0].source;
    expect(freezeExportSnapshot(makeExportSource({ inputs: missingSource }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
    const undefinedSource = makeExportSource().inputs.map((input) => input.field_id === 'comparison-period' ? { ...input, source: undefined } : input);
    expect(freezeExportSnapshot(makeExportSource({ inputs: undefinedSource }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });

    const missingRulesetRef = baseline.results.map((result) => ({ ...result })) as Array<Record<string, unknown>>;
    delete missingRulesetRef[0].ruleset_ref;
    expect(freezeExportSnapshot(makeExportSource({ results: missingRulesetRef }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });

    const contaminatedNotProvided = baseline.inputs.map((input) => input.field_id === 'fixed-cost-total'
      ? { ...input, availability: 'not-provided', value: null, source: null, evidence_status: null, confirmed_at: null }
      : input);
    expect(freezeExportSnapshot(makeExportSource({ inputs: contaminatedNotProvided }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });

    expect(freezeExportSnapshot(makeExportSource({ dictionaries: {} }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });

    const unavailableWithoutEvidence = baseline.results.map((result) => ({
      ...result,
      availability: 'unavailable' as const,
      exact_value: null,
      display_value: null,
      evidence_status: 'insufficient-data' as const,
      reason_codes: [],
      primary_reason_code: null,
      assumptions: [],
      limitations: [],
      rounding: null,
    }));
    expect(freezeExportSnapshot(makeExportSource({ results: unavailableWithoutEvidence }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
  });

  it('requires explicit currency minor units and strict build metadata', () => {
    const baseline = makeExportSource();
    const primitiveMoney = baseline.inputs.map((input) => input.field_id === 'income' ? { ...input, value: '10000', minor_unit: undefined } : input);
    expect(freezeExportSnapshot(makeExportSource({ inputs: primitiveMoney }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
    expect(freezeExportSnapshot(makeExportSource({ application_build: { ...baseline.application_build, app_version: 'v1.0.0' } }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
    expect(freezeExportSnapshot(makeExportSource({ application_build: { ...baseline.application_build, config_version: 'unknown' } }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
  });

  it('binds currency, comparison context, formula units, and note IDs', () => {
    const baseline = makeExportSource();
    const wrongContext = { ...baseline.comparison_context, currency_code: 'JPY' };
    expect(freezeExportSnapshot(makeExportSource({ comparison_context: wrongContext }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
    const wrongFormulaUnit = baseline.results.map((result) => result.formula_id === 'income-rate' ? { ...result, unit: 'JPY/hour', exact_value: { ...result.exact_value, unit: 'JPY/hour' } } : result);
    expect(freezeExportSnapshot(makeExportSource({ results: wrongFormulaUnit }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
    const wrongCurrencyMinorUnit = baseline.inputs.map((input) => input.field_id === 'income' ? {
      ...input,
      value: { kind: 'money', minor_units: '1000000', minor_unit: 0, currency_code: 'CNY' },
    } : input);
    expect(freezeExportSnapshot(makeExportSource({ inputs: wrongCurrencyMinorUnit }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
    const wrongNoteId = baseline.inputs.map((input) => input.field_id === 'value-expectation' ? {
      ...input,
      assumptions: [{ id: 'value-expectation.assumption-2', text: '固定规则说明' }],
    } : input);
    expect(freezeExportSnapshot(makeExportSource({ inputs: wrongNoteId }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
  });

  it('enforces the normalized UTF-8 free-text and snapshot size boundaries', () => {
    const baseline = makeExportSource();
    const baseDescriptionBytes = new TextEncoder().encode('合成完整覆盖。').byteLength;
    const atTextLimit = baseline.inputs.map((input) => input.field_id === 'value-expectation'
      ? { ...input, value: { kind: 'text', text: 'x'.repeat(64 * 1024 - baseDescriptionBytes), text_encoding: 'unicode-scalar-v1' } }
      : input);
    const atTextResult = freezeExportSnapshot(makeExportSource({ inputs: atTextLimit }));
    expect(atTextResult.ok).toBe(true);
    const overTextLimit = baseline.inputs.map((input) => input.field_id === 'value-expectation'
      ? { ...input, value: { kind: 'text', text: 'x'.repeat(64 * 1024 - baseDescriptionBytes + 1), text_encoding: 'unicode-scalar-v1' } }
      : input);
    expect(freezeExportSnapshot(makeExportSource({ inputs: overTextLimit }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-resource-limit-exceeded' }),
    });

    const overSnapshotBuild = {
      ...baseline.application_build,
      app_version: `0.1.0-${'x'.repeat(512 * 1024)}`,
    };
    expect(freezeExportSnapshot(makeExportSource({ application_build: overSnapshotBuild }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-resource-limit-exceeded' }),
    });
  });

  it('does not parse over-precise raw work-hours with Number', () => {
    const baseline = makeExportSource();
    const inputs = baseline.inputs.map((input) => input.field_id === 'work-hours' ? { ...input, value: '1.2345' } : input);
    expect(freezeExportSnapshot(makeExportSource({ inputs }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
  });

  it('rejects unknown source fields instead of dropping them', () => {
    expect(freezeExportSnapshot(makeExportSource({ unknown_export_field: 'unexpected' }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
  });

  it('rejects unknown nested source fields before normalization', () => {
    const baseline = makeExportSource();
    const cases = [
      makeExportSource({
        snapshot_captured_at: { ...FIXTURE_TIME, unknown_nested_field: 'unexpected' },
      }),
      makeExportSource({
        comparison_context: {
          ...baseline.comparison_context,
          period_ref: { ...(baseline.comparison_context.period_ref ?? {}), unknown_nested_field: 'unexpected' },
        },
      }),
      makeExportSource({
        inputs: baseline.inputs.map((input) => input.field_id === 'income'
          ? { ...input, period_ref: { ...(input.period_ref ?? {}), unknown_nested_field: 'unexpected' } }
          : input),
      }),
      makeExportSource({
        results: baseline.results.map((result, index) => index === 0
          ? { ...result, period_ref: { ...(result.period_ref ?? {}), unknown_nested_field: 'unexpected' } }
          : result),
      }),
      makeExportSource({
        decision: {
          availability: 'available',
          decision_code: 'wait',
          evidence_status: 'user-confirmed',
          rationale: { kind: 'text', text: '合成条件', text_encoding: 'unicode-scalar-v1', unknown_nested_field: 'unexpected' },
          confirmed_at: FIXTURE_TIME.recorded_at_utc,
        },
      }),
      makeExportSource({
        review: {
          availability: 'available',
          kind: 'local-date',
          local_date: { kind: 'local-date', value: '2026-02-01', unknown_nested_field: 'unexpected' },
          condition_text: null,
          evidence_status: 'user-confirmed',
          confirmed_at: FIXTURE_TIME.recorded_at_utc,
        },
      }),
      makeExportSource({
        dictionaries: {
          ...baseline.dictionaries,
          notice_codes: baseline.dictionaries?.notice_codes.map((entry, index) => index === 0
            ? { ...entry, unknown_nested_field: 'unexpected' }
            : entry),
        },
      }),
    ];
    for (const source of cases) {
      expect(freezeExportSnapshot(source)).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'export-schema-mismatch' }),
      });
    }
  });

  it('rejects duplicate or unknown input records before mapping', () => {
    const baseline = makeExportSource();
    const duplicateInputs = [...baseline.inputs, baseline.inputs[0]];
    expect(freezeExportSnapshot(makeExportSource({ inputs: duplicateInputs }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
    expect(freezeExportSnapshot(makeExportSource({ inputs: [...baseline.inputs, { field_id: 'unknown-field' }] }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'export-schema-mismatch' }),
    });
  });
});
