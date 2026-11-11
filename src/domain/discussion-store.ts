import { isFactCard, type FactCard } from "./fact-card";
import { leaningWording, MAX_MODEL_ITEMS, MAX_MODEL_TEXT } from "./model-output";
import { isPersona, type Persona } from "./personas";
import type { PurchaseDecisionCode } from "./purchase-snapshot";

export const DISCUSSIONS_FORMAT = "zhiguan-discussions@1" as const;
export const DISCUSSIONS_STORAGE_KEY = "zhiguan.discussions@1";

const LOCK_NAME = "zhiguan-discussions";
/** 浏览器按 UTF-16 码元×2 计入 localStorage 配额；4_000_000 字节等于改成 UTF-8 之前的 200 万码元。 */
const MAX_STORAGE_BYTES = 4_000_000;
const MAX_RECORDS = 100;
const MAX_SPEECH_SENTENCES = (MAX_MODEL_ITEMS + 1) * MAX_MODEL_TEXT;
const MAX_SYNTHESIS_SENTENCES = MAX_MODEL_ITEMS * MAX_MODEL_TEXT;
const MAX_RATIONALE = 2000;
const DECISION_CODES = ["buy", "wait", "adjust-conditions", "do-not-buy", "undecided"] as const;

export interface StoredSentence {
  readonly text: string;
  readonly numberMismatch: boolean;
  readonly pressure: boolean;
  readonly verdict: boolean;
}

export interface StoredSpeech {
  readonly personaId: string;
  readonly name: string;
  readonly status: "done" | "failed";
  readonly usableText: string;
  readonly sentences: readonly StoredSentence[];
}

export interface StoredSynthesis {
  readonly status: "done" | "failed";
  readonly leaning: string | null;
  readonly reasons: readonly StoredSentence[];
  readonly risks: readonly StoredSentence[];
  readonly changeConditions: readonly StoredSentence[];
  readonly disagreements: readonly StoredSentence[];
  readonly pushbackMissing: boolean;
}

export interface DiscussionRound {
  readonly speeches: readonly StoredSpeech[];
  readonly synthesis: StoredSynthesis | null;
}

export interface DiscussionDecision {
  readonly code: PurchaseDecisionCode;
  readonly rationale: string;
}

export interface DiscussionRecord {
  readonly id: string;
  readonly completedAt: string;
  readonly updatedAt: string;
  readonly factCard: FactCard;
  readonly category: string;
  readonly reason: string;
  readonly personas: readonly Persona[];
  readonly round1: DiscussionRound;
  readonly round2: DiscussionRound | null;
  readonly decision: DiscussionDecision | null;
}

export interface DiscussionsDocument {
  readonly format: typeof DISCUSSIONS_FORMAT;
  readonly revision: string;
  readonly personas: readonly Persona[];
  readonly records: readonly DiscussionRecord[];
}

export type DiscussionsReadResult =
  | { readonly status: "ready"; readonly document: DiscussionsDocument; readonly raw: string }
  | { readonly status: "empty" }
  | { readonly status: "invalid"; readonly raw: string; readonly reason: "malformed" | "unsupported-version" }
  | { readonly status: "unavailable"; readonly reason: "storage-unavailable" };

export type DiscussionsWriteResult =
  | { readonly status: "saved"; readonly document: DiscussionsDocument; readonly raw: string }
  | { readonly status: "conflict"; readonly currentRevision: string | null }
  | { readonly status: "not-found" }
  | { readonly status: "invalid"; readonly reason: "malformed" | "unsupported-version" | "invalid-document" }
  | { readonly status: "unavailable"; readonly reason: "storage-unavailable" | "locks-unavailable" | "write-failed" | "too-many" }
  | { readonly status: "unavailable"; readonly reason: "storage-full"; readonly records: number; readonly bytes: number };

export function storageFullNotice(records: number, bytes: number): string {
  const size = bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 0 : 1)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `本地讨论空间已满，这次没能写入（${records} 条，约 ${size}）。可以删除旧讨论，或到收入资料页导出备份后再清除，腾出空间。页面上的内容还在，刷新后可能丢失。`;
}

export function createWriteQueue(): { enqueue(task: () => Promise<void>): Promise<void> } {
  let chain = Promise.resolve();
  return {
    enqueue(task) {
      const run = chain.then(task, task);
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}

export function readDiscussions(): DiscussionsReadResult {
  try {
    const raw = globalThis.localStorage.getItem(DISCUSSIONS_STORAGE_KEY);
    if (raw === null) return { status: "empty" };
    return parseStored(raw);
  } catch {
    return { status: "unavailable", reason: "storage-unavailable" };
  }
}

export function isDiscussionsDocument(value: unknown): value is DiscussionsDocument {
  if (!hasExactKeys(value, ["format", "revision", "personas", "records"])) return false;
  if (value.format !== DISCUSSIONS_FORMAT || !isRevision(value.revision) || !Array.isArray(value.personas) || !Array.isArray(value.records)) return false;
  if (value.records.length > MAX_RECORDS || !value.personas.every(isPersona) || !value.records.every(isRecordValue)) return false;
  return new Set(value.records.map((record) => record.id)).size === value.records.length;
}

export function withUpdatedDecision(record: DiscussionRecord, decision: DiscussionDecision, updatedAt: string): DiscussionRecord {
  return {
    ...record,
    updatedAt,
    decision,
  };
}

export async function upsertDiscussion(record: DiscussionRecord, expectedRevision: string | null): Promise<DiscussionsWriteResult> {
  if (!isRecordValue(record)) return { status: "invalid", reason: "invalid-document" };
  return withLock(async () => commitUpsert(record, expectedRevision));
}

export async function deleteDiscussion(id: string, expectedRevision: string | null): Promise<DiscussionsWriteResult> {
  return withLock(async () => {
    const current = readInsideLock();
    if (current.status === "unavailable") return { status: "unavailable", reason: current.reason };
    if (current.status === "invalid") return { status: "invalid", reason: current.reason };
    if (current.status === "empty") return { status: "not-found" };
    if (current.document.revision !== expectedRevision) return { status: "conflict", currentRevision: current.document.revision };
    const records = current.document.records.filter((record) => record.id !== id);
    if (records.length === current.document.records.length) return { status: "not-found" };
    return writeDocument({ personas: [...current.document.personas], records });
  });
}

export async function clearDiscussions(expectedRevision: string | null): Promise<DiscussionsWriteResult | { readonly status: "cleared" }> {
  return withLock(async () => {
    const current = readInsideLock();
    if (current.status === "unavailable") return { status: "unavailable", reason: current.reason };
    if (current.status === "invalid") return { status: "invalid", reason: current.reason };
    const revision = current.status === "ready" ? current.document.revision : null;
    if (revision !== expectedRevision) return { status: "conflict", currentRevision: revision };
    try {
      globalThis.localStorage.removeItem(DISCUSSIONS_STORAGE_KEY);
      return { status: "cleared" };
    } catch {
      return { status: "unavailable", reason: "write-failed" };
    }
  });
}

export async function clearInvalidDiscussions(expectedRaw: string): Promise<DiscussionsWriteResult | { readonly status: "cleared" }> {
  return withLock(async () => {
    const current = readInsideLock();
    if (current.status === "unavailable") return { status: "unavailable", reason: current.reason };
    if (current.status !== "invalid" || current.raw !== expectedRaw) {
      return { status: "conflict", currentRevision: current.status === "ready" ? current.document.revision : null };
    }
    try {
      globalThis.localStorage.removeItem(DISCUSSIONS_STORAGE_KEY);
      return { status: "cleared" };
    } catch {
      return { status: "unavailable", reason: "write-failed" };
    }
  });
}

export async function replaceDiscussions(document: DiscussionsDocument | null, expectedRevision: string | null): Promise<DiscussionsWriteResult | { readonly status: "cleared" }> {
  if (document !== null && !isDiscussionsDocument(document)) return { status: "invalid", reason: "invalid-document" };
  return withLock(async () => {
    const current = readInsideLock();
    if (current.status === "unavailable") return { status: "unavailable", reason: current.reason };
    if (current.status === "invalid") return { status: "invalid", reason: current.reason };
    const revision = current.status === "ready" ? current.document.revision : null;
    if (revision !== expectedRevision) return { status: "conflict", currentRevision: revision };
    if (document === null) {
      try {
        globalThis.localStorage.removeItem(DISCUSSIONS_STORAGE_KEY);
        return { status: "cleared" };
      } catch {
        return { status: "unavailable", reason: "write-failed" };
      }
    }
    return writeDocument({ personas: [...document.personas], records: [...document.records] });
  });
}

function parseStored(raw: string): DiscussionsReadResult {
  if (storageBytes(raw) > MAX_STORAGE_BYTES) return { status: "invalid", raw, reason: "malformed" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "invalid", raw, reason: "malformed" };
  }
  if (isRecord(value) && typeof value.format === "string" && value.format !== DISCUSSIONS_FORMAT) {
    return { status: "invalid", raw, reason: "unsupported-version" };
  }
  return isDiscussionsDocument(value) ? { status: "ready", document: value, raw } : { status: "invalid", raw, reason: "malformed" };
}

function readInsideLock(): DiscussionsReadResult {
  try {
    const raw = globalThis.localStorage.getItem(DISCUSSIONS_STORAGE_KEY);
    return raw === null ? { status: "empty" } : parseStored(raw);
  } catch {
    return { status: "unavailable", reason: "storage-unavailable" };
  }
}

function commitUpsert(record: DiscussionRecord, expectedRevision: string | null): DiscussionsWriteResult {
  const current = readInsideLock();
  if (current.status === "unavailable") return { status: "unavailable", reason: current.reason };
  if (current.status === "invalid") return { status: "invalid", reason: current.reason };
  const revision = current.status === "ready" ? current.document.revision : null;
  if (revision !== expectedRevision) return { status: "conflict", currentRevision: revision };
  const existing = current.status === "ready" ? current.document : null;
  const records = existing ? [...existing.records] : [];
  const index = records.findIndex((item) => item.id === record.id);
  if (index >= 0) records[index] = record;
  else if (records.length >= MAX_RECORDS) return { status: "unavailable", reason: "too-many" };
  else records.push(record);
  return writeDocument({ personas: [...record.personas], records });
}

function writeDocument(content: { personas: readonly Persona[]; records: readonly DiscussionRecord[] }): DiscussionsWriteResult {
  try {
    const document: DiscussionsDocument = {
      format: DISCUSSIONS_FORMAT,
      revision: globalThis.crypto.randomUUID(),
      personas: content.personas,
      records: content.records,
    };
    if (!isDiscussionsDocument(document)) return { status: "invalid", reason: "invalid-document" };
    const raw = `${JSON.stringify(document)}\n`;
    const bytes = storageBytes(raw);
    if (bytes > MAX_STORAGE_BYTES) return storageFull(document.records.length, bytes);
    try {
      globalThis.localStorage.setItem(DISCUSSIONS_STORAGE_KEY, raw);
    } catch (error) {
      if (isQuotaExceeded(error)) return storageFull(document.records.length, bytes);
      return { status: "unavailable", reason: "write-failed" };
    }
    return { status: "saved", document, raw };
  } catch {
    return { status: "unavailable", reason: "write-failed" };
  }
}

function storageBytes(value: string): number {
  return value.length * 2;
}

function storageFull(records: number, bytes: number): DiscussionsWriteResult {
  return { status: "unavailable", reason: "storage-full", records, bytes };
}

function isQuotaExceeded(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = "name" in error ? error.name : "";
  const code = "code" in error ? error.code : undefined;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014;
}

async function withLock<T extends DiscussionsWriteResult | { readonly status: "cleared" }>(operation: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return { status: "unavailable", reason: "locks-unavailable" } as T;
  try {
    return await locks.request(LOCK_NAME, { mode: "exclusive" }, async () => {
      try {
        return await operation();
      } catch {
        return { status: "unavailable", reason: "write-failed" } as T;
      }
    });
  } catch {
    return { status: "unavailable", reason: "locks-unavailable" } as T;
  }
}

function isRecordValue(value: unknown): value is DiscussionRecord {
  if (!hasExactKeys(value, ["id", "completedAt", "updatedAt", "factCard", "category", "reason", "personas", "round1", "round2", "decision"])) return false;
  if (!isRevision(value.id) || !isIsoDate(value.completedAt) || !isIsoDate(value.updatedAt)) return false;
  if (!isFactCard(value.factCard) || typeof value.category !== "string" || typeof value.reason !== "string") return false;
  if ([...value.category].length > 40 || [...value.reason].length > 500) return false;
  if (!Array.isArray(value.personas) || value.personas.length > 5 || !value.personas.every(isPersona)) return false;
  if (!isRound(value.round1) || !(value.round2 === null || isRound(value.round2))) return false;
  return value.decision === null || isDecision(value.decision);
}

function isRound(value: unknown): value is DiscussionRound {
  if (!hasExactKeys(value, ["speeches", "synthesis"])) return false;
  if (!Array.isArray(value.speeches) || value.speeches.length > 5 || !value.speeches.every(isSpeech)) return false;
  return value.synthesis === null || isSynthesis(value.synthesis);
}

function isSpeech(value: unknown): value is StoredSpeech {
  if (!hasExactKeys(value, ["personaId", "name", "status", "usableText", "sentences"])) return false;
  if (typeof value.personaId !== "string" || typeof value.name !== "string" || typeof value.usableText !== "string") return false;
  if (value.status !== "done" && value.status !== "failed") return false;
  return Array.isArray(value.sentences) && value.sentences.length <= MAX_SPEECH_SENTENCES && value.sentences.every(isSentence);
}

function isSynthesis(value: unknown): value is StoredSynthesis {
  if (!hasExactKeys(value, ["status", "leaning", "reasons", "risks", "changeConditions", "disagreements", "pushbackMissing"])) return false;
  if (value.status !== "done" && value.status !== "failed") return false;
  if (!(value.leaning === null || (typeof value.leaning === "string" && leaningWording(value.leaning) !== null))) return false;
  if (typeof value.pushbackMissing !== "boolean") return false;
  return [value.reasons, value.risks, value.changeConditions, value.disagreements].every((list) =>
    Array.isArray(list) && list.length <= MAX_SYNTHESIS_SENTENCES && list.every(isSentence));
}

function isSentence(value: unknown): value is StoredSentence {
  return hasExactKeys(value, ["text", "numberMismatch", "pressure", "verdict"])
    && typeof value.text === "string" && [...value.text].length <= 400
    && typeof value.numberMismatch === "boolean"
    && typeof value.pressure === "boolean"
    && typeof value.verdict === "boolean";
}

function isDecision(value: unknown): value is DiscussionDecision {
  return hasExactKeys(value, ["code", "rationale"])
    && typeof value.code === "string" && (DECISION_CODES as readonly string[]).includes(value.code)
    && typeof value.rationale === "string" && [...value.rationale].length <= MAX_RATIONALE;
}

function isRevision(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys<const K extends string>(value: unknown, keys: readonly K[]): value is Record<K, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
