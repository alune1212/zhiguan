import type { DictionaryEntry, Dictionaries, Notice, Ruleset } from './types';

export const SCHEMA_NAME = 'zhiguan.purchase-decision.session-snapshot' as const;
export const SCHEMA_VERSION = '1.0.0' as const;
export const JSON_FORMAT_VERSION = '1.0.0' as const;
export const MARKDOWN_FORMAT_NAME = 'markdown-gfm' as const;
export const MARKDOWN_FORMAT_VERSION = '1.0.0' as const;
export const CONFIG_VERSION = 'research-static-config@1.0.0' as const;
export const SNAPSHOT_SCOPE = 'current-session-current-snapshot' as const;
export const HISTORY_SCOPE = 'current-session-confirmed-revisions' as const;
export const RULESET: Ruleset = {
  ruleset_id: 'purchase-decision-rules',
  ruleset_version: '1.0.0',
  ruleset_ref: 'purchase-decision-rules@1.0.0',
};
export const CURRENCY_TABLE_SNAPSHOT_ID =
  'iso4217-list-one@2026-01-01#sha256:838dfb991648cf36df939edd5fe3811737962b75a32252847d239cedd1e291c9';
export const CURRENCY_TABLE_SHA256 = '838dfb991648cf36df939edd5fe3811737962b75a32252847d239cedd1e291c9';
export const CURRENCY_TABLE_BYTES = 47463;
export const CURRENCY_TABLE_PUBLISHED_ON = '2026-01-01';
export const CURRENCY_TABLE_READ_ON = '2026-08-21';

export const TOP_LEVEL_KEYS = [
  'schema_name',
  'schema_version',
  'format_name',
  'format_version',
  'snapshot_scope',
  'history_scope',
  'snapshot_revision',
  'snapshot_captured_at',
  'file_generated_at',
  'application_build',
  'ruleset',
  'currency_table',
  'dictionaries',
  'comparison_context',
  'inputs',
  'results',
  'decision',
  'review',
  'confirmed_revisions',
  'notices',
] as const;

export const INPUT_FIELD_IDS = [
  'comparison-period',
  'currency',
  'income',
  'income-tax-basis',
  'work-hours',
  'purchase-price',
  'purchase-period-inclusion',
  'fixed-cost-total',
  'fixed-cost-coverage',
  'fixed-cost-coverage-description',
  'value-expectation',
] as const;

export const RESULT_FORMULA_IDS = [
  'income-rate',
  'work-time-equivalent',
  'coverage-available-margin',
  'purchase-after-margin',
  'purchase-impact',
] as const;

/**
 * Assumption and limitation text is rule metadata, not an additional user
 * dictionary.  Keep the complete set in one domain-owned table so an
 * adapter cannot smuggle arbitrary prose (or executable-looking text) into
 * either export representation.
 */
export const FIXED_DICTIONARY_TEXTS: Readonly<Record<string, Readonly<{
  assumptions: readonly string[];
  limitations: readonly string[];
}>>> = Object.freeze({
  'comparison-period': Object.freeze({ assumptions: Object.freeze([]), limitations: Object.freeze([]) }),
  currency: Object.freeze({ assumptions: Object.freeze([]), limitations: Object.freeze([]) }),
  income: Object.freeze({ assumptions: Object.freeze([]), limitations: Object.freeze([]) }),
  'income-tax-basis': Object.freeze({ assumptions: Object.freeze([]), limitations: Object.freeze([]) }),
  'work-hours': Object.freeze({ assumptions: Object.freeze([]), limitations: Object.freeze([]) }),
  'purchase-price': Object.freeze({ assumptions: Object.freeze([]), limitations: Object.freeze([]) }),
  'purchase-period-inclusion': Object.freeze({ assumptions: Object.freeze([]), limitations: Object.freeze([]) }),
  'fixed-cost-total': Object.freeze({ assumptions: Object.freeze([]), limitations: Object.freeze([]) }),
  'fixed-cost-coverage': Object.freeze({ assumptions: Object.freeze([]), limitations: Object.freeze([]) }),
  'fixed-cost-coverage-description': Object.freeze({ assumptions: Object.freeze([]), limitations: Object.freeze([]) }),
  'value-expectation': Object.freeze({ assumptions: Object.freeze([]), limitations: Object.freeze([]) }),
  'income-rate': Object.freeze({ assumptions: Object.freeze([]), limitations: Object.freeze([]) }),
  'work-time-equivalent': Object.freeze({
    assumptions: Object.freeze([]),
    limitations: Object.freeze(['这是工作时间比较，不代表体验本身的价值。']),
  }),
  'coverage-available-margin': Object.freeze({ assumptions: Object.freeze([]), limitations: Object.freeze([]) }),
  'purchase-after-margin': Object.freeze({ assumptions: Object.freeze([]), limitations: Object.freeze([]) }),
  'purchase-impact': Object.freeze({ assumptions: Object.freeze([]), limitations: Object.freeze([]) }),
});

export const FIXED_COST_COVERAGE_CODES = ['complete', 'partial', 'unknown'] as const;

/** Formula-specific dependency order from ADR-0002, kept separate from the
 * input record order. Formula IDs never enter a field-ID array. */
export const RESULT_DEPENDENCY_FIELD_IDS: Record<(typeof RESULT_FORMULA_IDS)[number], readonly string[]> = {
  'income-rate': ['income', 'work-hours', 'comparison-period', 'currency', 'income-tax-basis'],
  'work-time-equivalent': ['income', 'work-hours', 'purchase-price', 'comparison-period', 'currency', 'income-tax-basis'],
  'coverage-available-margin': ['income', 'fixed-cost-total', 'fixed-cost-coverage', 'fixed-cost-coverage-description', 'comparison-period', 'currency', 'income-tax-basis'],
  'purchase-after-margin': ['income', 'fixed-cost-total', 'fixed-cost-coverage', 'fixed-cost-coverage-description', 'purchase-price', 'purchase-period-inclusion', 'comparison-period', 'currency', 'income-tax-basis'],
  'purchase-impact': ['income', 'fixed-cost-total', 'fixed-cost-coverage', 'fixed-cost-coverage-description', 'purchase-price', 'purchase-period-inclusion', 'comparison-period', 'currency', 'income-tax-basis'],
};

export const DICTIONARY_KEYS = [
  'schema_fields',
  'value_kinds',
  'field_definitions',
  'formula_definitions',
  'evidence_statuses',
  'availability_codes',
  'source_codes',
  'reason_codes',
  'decision_codes',
  'notice_codes',
] as const;

export const NOTICE_CODES = [
  'sensitive-local-file',
  'current-session-only',
  'not-a-backup-or-share',
  'device-time-not-authoritative',
  'not-financial-advice',
  'downloaded-file-user-controlled',
] as const;

export const NOTICE_TEXT: Record<(typeof NOTICE_CODES)[number], string> = {
  'sensitive-local-file': '文件可能包含敏感的当前会话输入，只在你明确请求时生成。',
  'current-session-only': '内容仅覆盖当前会话的当前快照及已确认修订。',
  'not-a-backup-or-share': '这不是备份、同步或分享服务，原型不会召回或恢复文件。',
  'device-time-not-authoritative': '时间来自设备时钟，不是权威时间证明。',
  'not-financial-advice': '结果描述输入下的规则关系，不构成财务建议。',
  'downloaded-file-user-controlled': '下载后文件由你的浏览器、设备和后续选择控制。',
};

export const DEFAULT_NOTICES: Notice[] = NOTICE_CODES.map((code) => ({
  code,
  text: NOTICE_TEXT[code],
}));

const generic = (id: string, label: string, definition: string): DictionaryEntry => ({ id, label, definition });

const SCHEMA_FIELD_DATA: ReadonlyArray<readonly [string, string, string]> = [
  ['schema_name', '模式名称', '固定的值观购买决策会话快照 schema 标识。'],
  ['schema_version', '模式版本', '冻结 wire 合同的语义版本。'],
  ['format_name', '表示格式', '当前文件表示层的格式名称。'],
  ['format_version', '表示版本', '当前文件表示层的版本。'],
  ['snapshot_scope', '快照范围', '仅表示当前会话的当前快照。'],
  ['history_scope', '历史范围', '仅表示当前会话内已确认的修订事件。'],
  ['snapshot_revision', '快照修订号', '冻结时会话修订序号，不是跨会话身份。'],
  ['snapshot_captured_at', '快照冻结时间', '冻结快照时的完整设备时间上下文。'],
  ['file_generated_at', '文件生成时间', '生成该格式文件时的完整设备时间上下文。'],
  ['application_build', '应用构建', '应用版本、构建提交、产物摘要和配置版本。'],
  ['ruleset', '规则集', '固定公式规则集的 ID、版本和引用。'],
  ['currency_table', '货币表快照', '构建内固定 ISO 4217 货币精度及其来源摘要。'],
  ['dictionaries', '语义字典', '离线解释字段、状态、公式和提示所需的固定字典。'],
  ['comparison_context', '比较上下文', '由输入记录引用的周期、币种、税口径和时区信息。'],
  ['inputs', '输入记录', '按领域固定顺序出现的 11 个当前输入记录。'],
  ['results', '结果记录', '按领域固定顺序出现的 5 个公式结果记录。'],
  ['decision', '决定', '用户确认的决定类别与非空依据，或显式未提供。'],
  ['review', '复盘', '用户确认的复盘日期或条件，或显式未提供。'],
  ['confirmed_revisions', '已确认修订', '当前会话内按序号保存的最小确认修订历史。'],
  ['notices', '提示', '敏感性、范围、时间和下载后控制边界提示。'],
] as const;

const FIELD_DEFINITION_DATA = [
  ['comparison-period', '比较周期', '用户确认收入与成本比较所对应的周期引用。', 'period-ref', 'required', '周、月、年或自定义周期；不做跨期换算。', true],
  ['currency', '币种', '本次会话统一使用的 ISO 4217 三字母币种代码。', 'enum', 'required', 'ISO 4217 代码及构建内固定 minor unit。', true],
  ['income', '收入', '用户确认的比较周期收入，以该币种最小货币单位表示。', 'money', 'required', '同一比较周期的最小货币单位金额。', true],
  ['income-tax-basis', '收入税口径', '收入金额的用户确认税口径，不由系统推断。', 'enum', 'required', 'before-tax 或 after-tax；不适用时为空。', true],
  ['work-hours', '工作小时', '用户确认的比较周期工作小时数。', 'rational', 'required', '正的约分有理数，主单位为小时。', true],
  ['purchase-price', '购买价格', '用户确认的单次购买价格，以同一币种最小货币单位表示。', 'money', 'required', '同一币种的最小货币单位金额。', true],
  ['purchase-period-inclusion', '购买计入本周期', '用户是否确认把购买计入当前比较周期。', 'boolean', 'required', '布尔确认值，不表示支付成功或实际购买。', true],
  ['fixed-cost-total', '固定成本汇总', '用户确认的比较周期固定成本汇总。', 'money', 'optional', '同一周期、同一币种的最小货币单位金额。', true],
  ['fixed-cost-coverage', '固定成本覆盖状态', '用户确认固定成本汇总覆盖范围的状态。', 'enum', 'optional', 'complete、partial 或 unknown；不把缺失当作零。', true],
  ['fixed-cost-coverage-description', '固定成本覆盖说明', '对固定成本覆盖范围的用户确认说明。', 'text', 'optional', '构建内规则使用的文本说明，不替代金额。', true],
  ['value-expectation', '价值期待', '用户对本次购买价值的自由文本期待。', 'text', 'required', '仅用于解释用户期待，不参与财务公式。', true],
] as const;

export const FIELD_VALUE_KINDS: Record<(typeof INPUT_FIELD_IDS)[number], string> = Object.fromEntries(
  FIELD_DEFINITION_DATA.map(([id, , , value_kind]) => [id, value_kind]),
) as Record<(typeof INPUT_FIELD_IDS)[number], string>;

const FORMULA_DEFINITION_DATA = [
  ['income-rate', '收入时薪率', '以收入和工作小时计算每小时收入；展示前保留精确有理数。', '(I × Hd) / (S × Hn)', '货币主单位/小时'],
  ['work-time-equivalent', '购买工时等价', '以购买价格和原始收入、工时计算购买所对应的工作小时。', '(P × Hn) / (I × Hd)', '小时'],
  ['coverage-available-margin', '覆盖后可用余量', '以税后收入减去完整且有说明的固定成本覆盖汇总。', 'I - F', '最小货币单位'],
  ['purchase-after-margin', '购买后余量', '以覆盖后可用余量减去用户确认计入本周期的购买价格。', '(I - F) - P', '最小货币单位'],
  ['purchase-impact', '购买影响', '购买后余量与覆盖后可用余量之差，等于负的购买价格。', 'purchase-after-margin - coverage-available-margin = -P', '最小货币单位'],
] as const;

const EVIDENCE_DATA: ReadonlyArray<readonly [string, string, string]> = [
  ['actual', '实际', '仅用于独立系统修订事件，不用于产品财务输入或结果。'],
  ['user-confirmed', '用户确认', '用户明确确认的当前输入或派生结果证据。'],
  ['estimated', '估算', '用户或规则明确标记为估算的输入或结果证据。'],
  ['forecast', '预测', '依赖购买情景的未来结果证据。'],
  ['insufficient-data', '数据不足', '依赖缺失、无效或不满足规则门禁，不能生成精确值。'],
] as const;

const AVAILABILITY_DATA: ReadonlyArray<readonly [string, string, string]> = [
  ['available', '可用', '记录具有合同要求的值与适用证据。'],
  ['not-provided', '未提供', '输入或决定未提供，值与相关状态显式为 null。'],
  ['unavailable', '不可用', '结果因数据不足或规则边界不能生成精确值。'],
] as const;

const SOURCE_DATA: ReadonlyArray<readonly [string, string, string]> = [
  ['user-input', '用户输入', '值来自当前会话中用户提交并确认的输入。'],
  ['ruleset-derived', '规则派生', '值由固定规则集从当前快照输入计算得到。'],
  ['system-event', '系统事件', '值描述当前会话中的系统确认事件，不是财务事实。'],
] as const;

const REASON_DEFINITIONS: Record<string, readonly [string, string]> = {
  'missing-income': ['缺少收入', '收入输入未提供或不可用。'],
  'missing-work-hours': ['缺少工作小时', '工作小时输入未提供或不可用。'],
  'missing-purchase-price': ['缺少购买价格', '购买价格输入未提供或不可用。'],
  'missing-fixed-cost': ['缺少固定成本', '固定成本汇总未提供或不可用。'],
  'comparison-period-unconfirmed': ['比较周期未确认', '比较周期尚未由用户确认。'],
  'currency-unconfirmed': ['币种未确认', '统一币种尚未由用户确认。'],
  'tax-basis-unconfirmed': ['税口径未确认', '收入税口径尚未由用户确认。'],
  'input-unconfirmed': ['输入未确认', '依赖输入没有满足当前确认门禁。'],
  'invalid-decimal': ['十进制无效', '原始数值不是允许的规范十进制。'],
  'zero-not-allowed': ['不允许为零', '该原始输入必须是正数而不能为零。'],
  'negative-not-allowed': ['不允许为负', '该原始输入不能为负数。'],
  'fraction-exceeds-currency-minor-unit': ['超过货币小数位', '金额小数位超过固定货币表的 minor unit。'],
  'numeric-limit-exceeded': ['超过数值范围', '原始数值超过 ADR-0002 固定的长度或范围。'],
  'unsupported-currency': ['币种不支持', '币种不存在于构建内固定货币快照。'],
  'currency-mismatch': ['币种不一致', '依赖输入使用了不一致的币种或快照。'],
  'period-mismatch': ['周期不一致', '依赖输入没有引用同一确认周期。'],
  'input-reconfirmation-required': ['需要重新确认输入', '输入已经修改但尚未重新确认。'],
  'tax-basis-not-after-tax': ['不是税后口径', '该结果只允许在税后收入口径下生成。'],
  'fixed-cost-coverage-incomplete': ['固定成本覆盖不完整', '固定成本覆盖状态不是 complete。'],
  'fixed-cost-coverage-description-missing': ['缺少固定成本覆盖说明', '完整覆盖状态缺少非空覆盖说明。'],
  'purchase-period-unconfirmed': ['购买周期未确认', '尚未确认把购买计入当前比较周期。'],
  'division-by-zero': ['除数为零', '精确公式的除数为零，不能生成结果。'],
  'rule-execution-failed': ['规则执行失败', '固定规则执行遇到未分类故障，结果保持不可用。'],
} as const;

const DECISION_DATA: ReadonlyArray<readonly [string, string, string]> = [
  ['buy', '购买', '用户确认的购买决定类别，不由规则自动推断。'],
  ['wait', '等待', '用户确认暂不做购买决定。'],
  ['adjust-conditions', '调整条件', '用户确认先调整输入或条件再复盘。'],
  ['do-not-buy', '不购买', '用户确认不做本次购买决定。'],
  ['undecided', '尚未决定', '用户确认目前仍不作决定。'],
] as const;

const NOTICE_LABELS: Record<(typeof NOTICE_CODES)[number], string> = {
  'sensitive-local-file': '敏感本地文件',
  'current-session-only': '仅当前会话',
  'not-a-backup-or-share': '不是备份或分享',
  'device-time-not-authoritative': '设备时间不具权威性',
  'not-financial-advice': '不是财务建议',
  'downloaded-file-user-controlled': '下载后由用户控制',
};

export const DEFAULT_DICTIONARIES: Dictionaries = {
  schema_fields: SCHEMA_FIELD_DATA.map(([id, label, definition]) => generic(id, label, definition)),
  value_kinds: [
    ['money', '金额', '以最小货币单位字符串和 ISO 代码表示的精确金额。'],
    ['rational', '有理数', '以正分母分子/分母字符串表示的精确工时或派生比率。'],
    ['text', '文本', '使用 Unicode scalar v1 编码的自由文本。'],
    ['enum', '枚举', '来自构建内固定代码字典的封闭选项。'],
    ['boolean', '布尔值', '明确的 true 或 false 确认值。'],
    ['local-date', '本地日期', '不含时区的 YYYY-MM-DD 复盘日期。'],
    ['period-ref', '周期引用', '带周期类型、可选自定义标签和修订号的引用。'],
  ].map(([id, label, definition]) => generic(id, label, definition)),
  field_definitions: FIELD_DEFINITION_DATA.map(([id, label, definition, value_kind, product_requirement, unit_semantics, sensitive]) => ({
    id,
    label,
    definition,
    value_kind,
    product_requirement,
    unit_semantics,
    sensitive,
  })),
  formula_definitions: FORMULA_DEFINITION_DATA.map(([id, label, definition, expression, result_unit_semantics]) => ({
    id,
    label,
    definition,
    expression,
    dependency_field_ids: [...RESULT_DEPENDENCY_FIELD_IDS[id]],
    result_unit_semantics,
  })),
  evidence_statuses: EVIDENCE_DATA.map(([id, label, definition]) => generic(id, label, definition)),
  availability_codes: AVAILABILITY_DATA.map(([id, label, definition]) => generic(id, label, definition)),
  source_codes: SOURCE_DATA.map(([id, label, definition]) => generic(id, label, definition)),
  reason_codes: [
    'missing-income',
    'missing-work-hours',
    'missing-purchase-price',
    'missing-fixed-cost',
    'comparison-period-unconfirmed',
    'currency-unconfirmed',
    'tax-basis-unconfirmed',
    'input-unconfirmed',
    'invalid-decimal',
    'zero-not-allowed',
    'negative-not-allowed',
    'fraction-exceeds-currency-minor-unit',
    'numeric-limit-exceeded',
    'unsupported-currency',
    'currency-mismatch',
    'period-mismatch',
    'input-reconfirmation-required',
    'tax-basis-not-after-tax',
    'fixed-cost-coverage-incomplete',
    'fixed-cost-coverage-description-missing',
    'purchase-period-unconfirmed',
    'division-by-zero',
    'rule-execution-failed',
  ].map((id) => generic(id, REASON_DEFINITIONS[id]?.[0] ?? id, REASON_DEFINITIONS[id]?.[1] ?? '固定规则原因代码。')),
  decision_codes: DECISION_DATA.map(([id, label, definition]) => generic(id, label, definition)),
  notice_codes: NOTICE_CODES.map((id) => generic(id, NOTICE_LABELS[id], NOTICE_TEXT[id])),
};

export const REASON_CODES = DEFAULT_DICTIONARIES.reason_codes.map((entry) => entry.id) as readonly string[];

export const ERROR_MESSAGES = {
  'export-no-input': '至少需要一项已提交且可用的当前输入后才能导出。',
  'export-pending-edit': '当前有尚未重新确认的修改，请先完成确认或取消编辑。',
  'export-snapshot-stale': '预览已失效，请重新预览并确认当前会话。',
  'export-schema-mismatch': '当前快照不符合固定导出合同，请返回检查后重试。',
  'export-required-metadata-missing': '当前构建缺少必要版本或快照元数据，暂不能导出。',
  'export-invalid-unicode': '文本包含无法安全导出的字符，请修改后重试。',
  'export-resource-limit-exceeded': '当前会话超出本原型的导出范围，请先导出后刷新会话。',
  'export-serialization-failed': '导出内容生成失败，请重新预览或退出当前会话。',
  'export-blob-creation-failed': '浏览器无法准备本地导出，请检查浏览器后重试。',
  'export-download-request-failed': '页面未能发起本地下载请求，请重新确认后重试。',
  'export-resource-cleanup-failed': '导出临时资源未能安全清理，请刷新或关闭当前会话。',
  'export-unsupported-browser': '当前浏览器不支持安全的本地下载方式，请更换受支持浏览器。',
  'export-contract-breach': '导出合同验证失败，当前构建已暂停，请联系研究者处理。',
} as const;
