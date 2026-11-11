/** 阶段一的快捷项不是固定词表。天数只作建议，确认前不参与计算。 */
export const CATEGORY_SUGGESTIONS = [
  { label: "家电", holdingDays: 1825 },
  { label: "数码", holdingDays: 1095 },
  { label: "服饰", holdingDays: 730 },
  { label: "家具", holdingDays: 3650 },
  { label: "出行", holdingDays: 1825 },
  { label: "日用", holdingDays: 180 },
  { label: "食品", holdingDays: 30 },
  { label: "爱好", holdingDays: 1095 },
] as const;

export const CATEGORY_MAX = 40;
export const REASON_MAX = 500;

export function holdingSuggestionFor(category: string): number | null {
  const trimmed = category.trim();
  const match = CATEGORY_SUGGESTIONS.find((item) => item.label === trimmed);
  return match ? match.holdingDays : null;
}

export function reasonBlocksPreview(reason: string, itemName: string | null): boolean {
  const trimmed = reason.trim();
  if (!trimmed || [...trimmed].length > REASON_MAX) return true;
  const item = itemName?.trim() ?? "";
  if (!item) return false;
  return trimmed === item || trimmed === `想买：${item}`;
}

export function categoryBlocksPreview(category: string, pending: boolean): boolean {
  const trimmed = category.trim();
  return pending || trimmed.length === 0 || [...trimmed].length > CATEGORY_MAX;
}
