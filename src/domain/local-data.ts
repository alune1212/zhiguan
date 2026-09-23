import { validateProfile, type IncomeProfile } from "./income";
import { isPurchaseSnapshotV2, type PurchaseSnapshotV2 } from "./purchase-snapshot";

export const LOCAL_DATA_FORMAT = "zhiguan-local-backup@1" as const;
export const LOCAL_DATA_STORAGE_KEY = "zhiguan.local-data@1";

export interface FavoriteSnapshot {
  readonly id: string;
  readonly savedAt: string;
  readonly snapshot: PurchaseSnapshotV2;
}

export interface LocalDataDocument {
  readonly format: typeof LOCAL_DATA_FORMAT;
  readonly revision: string;
  readonly profile: IncomeProfile | null;
  readonly favorites: readonly FavoriteSnapshot[];
}

export interface LocalDataContent {
  readonly profile: IncomeProfile | null;
  readonly favorites: readonly FavoriteSnapshot[];
}

export type LocalDataReadResult =
  | { readonly status: "ready"; readonly document: LocalDataDocument; readonly raw: string }
  | { readonly status: "empty"; readonly document: null; readonly raw: null }
  | { readonly status: "invalid"; readonly document: null; readonly raw: string; readonly reason: "malformed" | "unsupported-version" }
  | { readonly status: "unavailable"; readonly document: null; readonly raw: null; readonly reason: "storage-unavailable" };

export type LocalDataWriteResult =
  | { readonly status: "saved"; readonly document: LocalDataDocument; readonly raw: string }
  | { readonly status: "conflict"; readonly currentRevision: string | null }
  | { readonly status: "not-found" }
  | { readonly status: "invalid"; readonly reason: "malformed" | "unsupported-version" | "invalid-document" }
  | { readonly status: "unavailable"; readonly reason: "storage-unavailable" | "locks-unavailable" | "write-failed" };

export type LocalDataClearResult =
  | { readonly status: "cleared" }
  | Exclude<LocalDataWriteResult, { readonly status: "saved" } | { readonly status: "not-found" }>;

export type LocalBackupParseResult =
  | { readonly status: "valid"; readonly document: LocalDataDocument }
  | { readonly status: "invalid"; readonly reason: "malformed" | "unsupported-version" };

const LOCK_NAME = "zhiguan-local-data";
const MAX_DOCUMENT_LENGTH = 5_000_000;
const PROFILE_KEYS = ["income", "timeZone", "workDays", "periods", "exceptions", "updatedAt", "scheduleSource"] as const;

export function readLocalData(): LocalDataReadResult {
  try {
    const storage = globalThis.localStorage;
    const raw = storage.getItem(LOCAL_DATA_STORAGE_KEY);
    if (raw === null) return { status: "empty", document: null, raw: null };
    return parseStoredDocument(raw);
  } catch {
    return { status: "unavailable", document: null, raw: null, reason: "storage-unavailable" };
  }
}

export async function commitLocalData(content: LocalDataContent, expectedRevision: string | null): Promise<LocalDataWriteResult> {
  if (!isContent(content)) return { status: "invalid", reason: "invalid-document" };
  return withStorageLock(async () => {
    const current = readLocalData();
    if (current.status === "unavailable") return { status: "unavailable", reason: current.reason };
    if (current.status === "invalid") return { status: "invalid", reason: current.reason };
    const revision = current.status === "ready" ? current.document.revision : null;
    if (revision !== expectedRevision) return { status: "conflict", currentRevision: revision };
    return writeDocument(content);
  });
}

export async function addFavorite(
  snapshot: PurchaseSnapshotV2,
  expectedRevision: string | null,
  savedAt = new Date(),
): Promise<LocalDataWriteResult> {
  if (!isPurchaseSnapshotV2(snapshot) || !Number.isFinite(savedAt.getTime())) return { status: "invalid", reason: "invalid-document" };
  return withStorageLock(async () => {
    const current = readLocalData();
    if (current.status === "unavailable") return { status: "unavailable", reason: current.reason };
    if (current.status === "invalid") return { status: "invalid", reason: current.reason };
    const revision = current.status === "ready" ? current.document.revision : null;
    if (revision !== expectedRevision) return { status: "conflict", currentRevision: revision };
    const content = current.status === "ready"
      ? { profile: current.document.profile, favorites: current.document.favorites }
      : { profile: null, favorites: [] };
    const favorite: FavoriteSnapshot = { id: globalThis.crypto.randomUUID(), savedAt: savedAt.toISOString(), snapshot };
    return writeDocument({ ...content, favorites: [...content.favorites, favorite] });
  });
}

export async function deleteFavorite(id: string, expectedRevision: string | null): Promise<LocalDataWriteResult> {
  return withStorageLock(async () => {
    const current = readLocalData();
    if (current.status === "unavailable") return { status: "unavailable", reason: current.reason };
    if (current.status === "invalid") return { status: "invalid", reason: current.reason };
    if (current.status === "empty") return { status: "not-found" };
    if (current.document.revision !== expectedRevision) return { status: "conflict", currentRevision: current.document.revision };
    const favorites = current.document.favorites.filter((favorite) => favorite.id !== id);
    if (favorites.length === current.document.favorites.length) return { status: "not-found" };
    return writeDocument({ profile: current.document.profile, favorites });
  });
}

export async function clearLocalData(expectedRevision: string | null): Promise<LocalDataClearResult> {
  return withStorageLock(async () => {
    const current = await readWithinLock();
    if (current.status !== "ready" && current.status !== "empty") return current;
    const revision = current.status === "ready" ? current.document.revision : null;
    if (revision !== expectedRevision) return { status: "conflict", currentRevision: revision };
    try {
      globalThis.localStorage.removeItem(LOCAL_DATA_STORAGE_KEY);
      return { status: "cleared" };
    } catch {
      return { status: "unavailable", reason: "write-failed" };
    }
  });
}

export async function restoreLocalData(source: LocalDataContent | LocalDataDocument, expectedRevision: string | null): Promise<LocalDataWriteResult> {
  const content = contentForRestore(source);
  if (!content) return { status: "invalid", reason: "invalid-document" };
  return withStorageLock(async () => {
    const current = await readWithinLock();
    if (current.status !== "ready" && current.status !== "empty") return current;
    const revision = current.status === "ready" ? current.document.revision : null;
    if (revision !== expectedRevision) return { status: "conflict", currentRevision: revision };
    return writeDocument(content);
  });
}

export async function restoreInvalidLocalData(source: LocalDataContent | LocalDataDocument, expectedRaw: string): Promise<LocalDataWriteResult> {
  const content = contentForRestore(source);
  if (!content) return { status: "invalid", reason: "invalid-document" };
  return withStorageLock(async () => {
    const current = await readWithinLock();
    if (current.status === "unavailable") return { status: "unavailable", reason: current.reason };
    if (current.status !== "invalid" || current.raw !== expectedRaw) {
      return { status: "conflict", currentRevision: current.status === "ready" ? current.document.revision : null };
    }
    return writeDocument(content);
  });
}

export async function clearInvalidLocalData(expectedRaw: string): Promise<LocalDataClearResult> {
  return withStorageLock(async () => {
    const current = await readWithinLock();
    if (current.status === "unavailable") return { status: "unavailable", reason: current.reason };
    if (current.status !== "invalid" || current.raw !== expectedRaw) {
      return { status: "conflict", currentRevision: current.status === "ready" ? current.document.revision : null };
    }
    try {
      globalThis.localStorage.removeItem(LOCAL_DATA_STORAGE_KEY);
      return { status: "cleared" };
    } catch {
      return { status: "unavailable", reason: "write-failed" };
    }
  });
}

export function createLocalBackup(document: LocalDataDocument, exportedAt = new Date()): string {
  if (!isLocalDataDocument(document) || !Number.isFinite(exportedAt.getTime())) throw new RangeError("invalid-local-data");
  return `${JSON.stringify({ ...document, exported_at: exportedAt.toISOString() }, null, 2)}\n`;
}

export function parseLocalBackup(raw: string): LocalBackupParseResult {
  if (raw.length > MAX_DOCUMENT_LENGTH) return { status: "invalid", reason: "malformed" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "invalid", reason: "malformed" };
  }
  if (!isRecord(value)) return { status: "invalid", reason: "malformed" };
  if (typeof value.format === "string" && value.format !== LOCAL_DATA_FORMAT) return { status: "invalid", reason: "unsupported-version" };
  const allowedKeys = Object.hasOwn(value, "exported_at")
    ? ["format", "revision", "profile", "favorites", "exported_at"]
    : ["format", "revision", "profile", "favorites"];
  if (!hasExactKeys(value, allowedKeys) || value.format !== LOCAL_DATA_FORMAT || !isRevision(value.revision)) return { status: "invalid", reason: "malformed" };
  if (Object.hasOwn(value, "exported_at") && !isIsoDate(value.exported_at)) return { status: "invalid", reason: "malformed" };
  const document = { format: LOCAL_DATA_FORMAT, revision: value.revision, profile: value.profile, favorites: value.favorites };
  return isLocalDataDocument(document)
    ? { status: "valid", document }
    : { status: "invalid", reason: "malformed" };
}

function parseStoredDocument(raw: string): LocalDataReadResult {
  if (raw.length > MAX_DOCUMENT_LENGTH) return { status: "invalid", document: null, raw, reason: "malformed" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "invalid", document: null, raw, reason: "malformed" };
  }
  if (!isRecord(value)) return { status: "invalid", document: null, raw, reason: "malformed" };
  if (typeof value.format === "string" && value.format !== LOCAL_DATA_FORMAT) {
    return { status: "invalid", document: null, raw, reason: "unsupported-version" };
  }
  if (!isLocalDataDocument(value)) return { status: "invalid", document: null, raw, reason: "malformed" };
  return { status: "ready", document: value, raw };
}

async function withStorageLock<T extends LocalDataWriteResult | LocalDataClearResult>(operation: () => Promise<T>): Promise<T> {
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
  } catch (error) {
    console.error("local-data lock acquisition failed", error);
    return { status: "unavailable", reason: "locks-unavailable" } as T;
  }
}

async function readWithinLock(): Promise<LocalDataReadResult> {
  try {
    const raw = globalThis.localStorage.getItem(LOCAL_DATA_STORAGE_KEY);
    return raw === null ? { status: "empty", document: null, raw: null } : parseStoredDocument(raw);
  } catch {
    return { status: "unavailable", document: null, raw: null, reason: "storage-unavailable" };
  }
}

function writeDocument(content: LocalDataContent): LocalDataWriteResult {
  try {
    const document: LocalDataDocument = {
      format: LOCAL_DATA_FORMAT,
      revision: globalThis.crypto.randomUUID(),
      profile: content.profile,
      favorites: content.favorites,
    };
    const raw = `${JSON.stringify(document)}\n`;
    if (raw.length > MAX_DOCUMENT_LENGTH) return { status: "unavailable", reason: "write-failed" };
    globalThis.localStorage.setItem(LOCAL_DATA_STORAGE_KEY, raw);
    return { status: "saved", document, raw };
  } catch {
    return { status: "unavailable", reason: "write-failed" };
  }
}

function isLocalDataDocument(value: unknown): value is LocalDataDocument {
  return hasExactKeys(value, ["format", "revision", "profile", "favorites"])
    && value.format === LOCAL_DATA_FORMAT && isRevision(value.revision)
    && isContent({ profile: value.profile, favorites: value.favorites });
}

function contentForRestore(source: LocalDataContent | LocalDataDocument): LocalDataContent | null {
  if (isLocalDataDocument(source)) return { profile: source.profile, favorites: source.favorites };
  return isContent(source) ? source : null;
}

function isContent(value: unknown): value is LocalDataContent {
  if (!hasExactKeys(value, ["profile", "favorites"])) return false;
  if (value.profile !== null && !isProfile(value.profile)) return false;
  return Array.isArray(value.favorites)
    && value.favorites.every(isFavorite)
    && new Set(value.favorites.map((favorite) => favorite.id)).size === value.favorites.length;
}

function isProfile(value: unknown): value is IncomeProfile {
  if (!hasExactKeys(value, PROFILE_KEYS)) return false;
  if (!Array.isArray(value.periods) || !value.periods.every((period) => hasExactKeys(period, ["start", "end", "endDayOffset"]))) return false;
  const validation = validateProfile(value);
  return validation.ok;
}

function isFavorite(value: unknown): value is FavoriteSnapshot {
  return hasExactKeys(value, ["id", "savedAt", "snapshot"])
    && typeof value.id === "string" && value.id.length > 0
    && isIsoDate(value.savedAt) && isPurchaseSnapshotV2(value.snapshot);
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
